import { Router } from 'express'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
import type { AuthUser } from '../middleware/auth.js'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { fieldChanges, redactForAudit, writeAudit } from '../audit/auditLog.js'
import { getGeneralAppSettings } from '../services/appSettings.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WorkgroupTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  costcenter_id: string | null
  hour_rate: string | number | null
  hour_rate_currency: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type WorkgroupRow = WorkgroupTableRow & {
  site_key: string
  site_name: string
  site_colour: string
  costcenter_key: string | null
  costcenter_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type WorkgroupEmployeeRow = {
  employee_id: string
  employee_key: string
  employee_name: string
}

function workingSiteIdOr403(res: Response, auth: AuthUser): string | null {
  const wid = auth.working_site_id
  if (!wid || !UUID_RE.test(wid)) {
    res.status(403).json({
      error:
        'No working site is set. Sign out and sign in again, or pick a site at login.',
    })
    return null
  }
  return wid
}

async function fetchWorkgroupWithJoins(
  client: PoolClient,
  id: string,
): Promise<WorkgroupRow | undefined> {
  const r = await client.query<WorkgroupRow>(
    `SELECT wg.id, wg.site_id, wg.key, wg.name, wg.costcenter_id,
            wg.hour_rate, wg.hour_rate_currency,
            wg.created_at, wg.updated_at, wg.created_by, wg.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            cc.key AS costcenter_key, cc.name AS costcenter_name,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM workgroups wg
     INNER JOIN sites st ON st.id = wg.site_id
     LEFT JOIN costcenters cc ON cc.id = wg.costcenter_id
     LEFT JOIN users cb ON cb.id = wg.created_by
     LEFT JOIN users ub ON ub.id = wg.updated_by
     WHERE wg.id = $1`,
    [id],
  )
  return r.rows[0]
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23503'
  )
}

function rowToAuditRecord(row: WorkgroupTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

function coalescePgNumericHourRate(
  v: string | number | null | undefined,
): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

function normalizeStoredCurrency(
  v: string | null | undefined,
): string | null {
  if (v === null || v === undefined) return null
  const u = String(v).trim().toUpperCase()
  return u.length === 0 ? null : u
}

function parseBodyHourRate(
  value: unknown,
): number | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return 'invalid'
    return value
  }
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t) return null
    const n = Number(t.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return 'invalid'
    return n
  }
  return 'invalid'
}

function parseBodyHourRateCurrency(
  value: unknown,
): string | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const u = value.trim().toUpperCase()
    if (!u) return null
    if (!/^[A-Z]{3}$/.test(u)) return 'invalid'
    return u
  }
  return 'invalid'
}

async function assertHourRateAllowedByCurr(
  client: PoolClient,
  hourRate: number | null,
  currency: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (hourRate === null && currency === null) return { ok: true }
  if (hourRate === null && currency !== null) {
    return {
      ok: false,
      error: 'hour_rate_currency cannot be set without hour_rate.',
    }
  }
  if (hourRate !== null && currency === null) {
    return {
      ok: false,
      error: 'hour_rate_currency is required when hour_rate is set.',
    }
  }
  const g = await getGeneralAppSettings(client)
  const allowed = new Set(g.currencies.map((c) => c.toUpperCase()))
  if (!allowed.has(currency!)) {
    return {
      ok: false,
      error:
        'hour_rate_currency must be one of the currencies configured in app parameters (CURR).',
    }
  }
  return { ok: true }
}

function mergeHourRateFieldsForPatch(
  before: WorkgroupTableRow,
  body: Record<string, unknown>,
):
  | { ok: false; error: string }
  | {
      ok: true
      hour_rate: number | null
      hour_rate_currency: string | null
      touched: boolean
    } {
  const hasRate = Object.prototype.hasOwnProperty.call(body, 'hour_rate')
  const hasCurr = Object.prototype.hasOwnProperty.call(
    body,
    'hour_rate_currency',
  )
  if (!hasRate && !hasCurr) {
    return {
      ok: true,
      hour_rate: coalescePgNumericHourRate(before.hour_rate),
      hour_rate_currency: normalizeStoredCurrency(before.hour_rate_currency),
      touched: false,
    }
  }

  let nextRate = coalescePgNumericHourRate(before.hour_rate)
  let nextCurr = normalizeStoredCurrency(before.hour_rate_currency)

  if (hasRate) {
    const pr = parseBodyHourRate(body.hour_rate)
    if (pr === 'invalid') {
      return { ok: false, error: 'Invalid hour_rate.' }
    }
    if (pr === null) {
      nextRate = null
      nextCurr = null
    } else {
      nextRate = pr
    }
  }

  if (hasCurr) {
    const pc = parseBodyHourRateCurrency(body.hour_rate_currency)
    if (pc === 'invalid') {
      return { ok: false, error: 'Invalid hour_rate_currency.' }
    }
    if (nextRate === null) {
      if (pc !== null) {
        return {
          ok: false,
          error: 'hour_rate_currency cannot be set without hour_rate.',
        }
      }
      nextCurr = null
    } else if (pc === null) {
      return {
        ok: false,
        error: 'hour_rate_currency cannot be cleared while hour_rate is set.',
      }
    } else {
      nextCurr = pc
    }
  }

  if (nextRate !== null && nextCurr === null) {
    return {
      ok: false,
      error: 'hour_rate_currency is required when hour_rate is set.',
    }
  }

  return {
    ok: true,
    hour_rate: nextRate,
    hour_rate_currency: nextCurr,
    touched: true,
  }
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT wg.id, wg.site_id, wg.key, wg.name, wg.costcenter_id,
       wg.hour_rate, wg.hour_rate_currency,
       wg.created_at, wg.updated_at, wg.created_by, wg.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM workgroups wg
INNER JOIN sites st ON st.id = wg.site_id
LEFT JOIN costcenters cc ON cc.id = wg.costcenter_id
LEFT JOIN users cb ON cb.id = wg.created_by
LEFT JOIN users ub ON ub.id = wg.updated_by
`

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<WorkgroupRow>(
      `${LIST_SQL} ORDER BY st.name ASC, st.key ASC, wg.name ASC, wg.key ASC`,
    )
    res.json({ workgroups: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ workgroups: [] })
    return
  }
  const r = await pool.query<WorkgroupRow>(
    `${LIST_SQL} WHERE wg.site_id = ANY($1::uuid[])
     ORDER BY st.name ASC, st.key ASC, wg.name ASC, wg.key ASC`,
    [allowed],
  )
  res.json({ workgroups: r.rows })
})

router.get('/:id/employees', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid workgroup id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wg = await pool.query<{ site_id: string }>(
    `SELECT site_id FROM workgroups WHERE id = $1`,
    [id],
  )
  const row = wg.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Workgroup not found.' })
    return
  }
  const r = await pool.query<WorkgroupEmployeeRow>(
    `SELECT e.id AS employee_id, e.key AS employee_key, e.name AS employee_name
     FROM workgroup_employees we
     INNER JOIN employees e ON e.id = we.employee_id
     WHERE we.workgroup_id = $1
     ORDER BY e.name ASC, e.key ASC`,
    [id],
  )
  res.json({ employees: r.rows })
})

router.post('/:id/employees', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid workgroup id.' })
    return
  }

  const body = req.body as { employee_id?: unknown; employee_ids?: unknown }

  const bulkRaw = body.employee_ids
  if (Array.isArray(bulkRaw) && bulkRaw.length > 0) {
    const ids: string[] = []
    for (const x of bulkRaw) {
      if (typeof x === 'string' && UUID_RE.test(x.trim())) {
        ids.push(x.trim())
      }
    }
    const unique = [...new Set(ids)]
    if (unique.length === 0) {
      res.status(400).json({
        error: 'employee_ids must contain at least one valid UUID.',
      })
      return
    }

    const auth = req.authUser!
    const scope = await loadUserSiteScope(pool, auth.id, auth.role)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const wgR = await client.query<{ site_id: string }>(
        `SELECT site_id FROM workgroups WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const wg = wgR.rows[0]
      if (!wg || !canAccessSite(scope, wg.site_id)) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Workgroup not found.' })
        return
      }

      const empCheck = await client.query<{ id: string; site_id: string }>(
        `SELECT id, site_id FROM employees WHERE id = ANY($1::uuid[])`,
        [unique],
      )
      const byId = new Map(empCheck.rows.map((r) => [r.id, r.site_id]))
      for (const eid of unique) {
        const sid = byId.get(eid)
        if (!sid || sid !== wg.site_id) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'Each employee must exist and belong to the same site as the workgroup.',
          })
          return
        }
        if (!canAccessSite(scope, sid)) {
          await client.query('ROLLBACK')
          res.status(404).json({ error: 'Employee not found.' })
          return
        }
      }

      const ins = await client.query(
        `INSERT INTO workgroup_employees (workgroup_id, employee_id)
         SELECT $1::uuid, eid::uuid
         FROM unnest($2::uuid[]) AS t(eid)
         ON CONFLICT DO NOTHING`,
        [id, unique],
      )
      const added = ins.rowCount ?? 0
      const skipped = unique.length - added
      await client.query('COMMIT')
      res.status(201).json({ added, skipped })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    return
  }

  const employeeIdRaw =
    typeof body.employee_id === 'string' ? body.employee_id.trim() : ''
  if (!UUID_RE.test(employeeIdRaw)) {
    res.status(400).json({
      error:
        'Provide employee_id (UUID) or employee_ids (non-empty array of UUIDs).',
    })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const wgR = await client.query<{ site_id: string }>(
      `SELECT site_id FROM workgroups WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const wg = wgR.rows[0]
    if (!wg || !canAccessSite(scope, wg.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }

    const empR = await client.query<{ site_id: string }>(
      `SELECT site_id FROM employees WHERE id = $1`,
      [employeeIdRaw],
    )
    const emp = empR.rows[0]
    if (!emp || !canAccessSite(scope, emp.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Employee not found.' })
      return
    }
    if (emp.site_id !== wg.site_id) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error: 'Employee must belong to the same site as the workgroup.',
      })
      return
    }

    await client.query(
      `INSERT INTO workgroup_employees (workgroup_id, employee_id) VALUES ($1, $2)`,
      [id, employeeIdRaw],
    )
    await client.query('COMMIT')
    res.status(201).json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: 'Employee is already in this workgroup.' })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id/employees/:employeeId', async (req, res) => {
  const id = req.params.id
  const employeeId = req.params.employeeId
  if (!UUID_RE.test(id) || !UUID_RE.test(employeeId)) {
    res.status(400).json({ error: 'Invalid id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const wgR = await client.query<{ site_id: string }>(
      `SELECT site_id FROM workgroups WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const wg = wgR.rows[0]
    if (!wg || !canAccessSite(scope, wg.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }

    const del = await client.query(
      `DELETE FROM workgroup_employees we
       WHERE we.workgroup_id = $1 AND we.employee_id = $2`,
      [id, employeeId],
    )
    const n = del.rowCount ?? 0
    await client.query('COMMIT')
    if (n === 0) {
      res.status(404).json({ error: 'Membership not found.' })
      return
    }
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid workgroup id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<WorkgroupRow>(`${LIST_SQL} WHERE wg.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Workgroup not found.' })
    return
  }
  res.json({ workgroup: row })
})

router.post('/', async (req, res) => {
  const key =
    typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
    return
  }

  let costcenterId: string | null = null
  if (req.body?.costcenter_id !== undefined && req.body.costcenter_id !== null) {
    const s = String(req.body.costcenter_id).trim()
    if (!UUID_RE.test(s)) {
      res.status(400).json({ error: 'Invalid costcenter_id.' })
      return
    }
    costcenterId = s
  }

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  if (costcenterId) {
    const cc = await pool.query<{ site_id: string }>(
      `SELECT site_id FROM costcenters WHERE id = $1`,
      [costcenterId],
    )
    const crow = cc.rows[0]
    if (!crow || crow.site_id !== siteId) {
      res.status(400).json({
        error: 'Cost center must exist and belong to the same site.',
      })
      return
    }
  }

  const bodyObj = req.body as Record<string, unknown>
  const hasPostRate = Object.prototype.hasOwnProperty.call(bodyObj, 'hour_rate')
  const hasPostCurr = Object.prototype.hasOwnProperty.call(
    bodyObj,
    'hour_rate_currency',
  )
  let postHourRate: number | null = null
  let postHourCurr: string | null = null
  if (hasPostRate) {
    const pr = parseBodyHourRate(bodyObj.hour_rate)
    if (pr === 'invalid') {
      res.status(400).json({ error: 'Invalid hour_rate.' })
      return
    }
    postHourRate = pr
  }
  if (hasPostCurr) {
    const pc = parseBodyHourRateCurrency(bodyObj.hour_rate_currency)
    if (pc === 'invalid') {
      res.status(400).json({ error: 'Invalid hour_rate_currency.' })
      return
    }
    postHourCurr = pc
  }
  if (postHourRate === null) {
    postHourCurr = null
  } else if (postHourCurr === null) {
    res.status(400).json({
      error: 'hour_rate_currency is required when hour_rate is set.',
    })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pairOk = await assertHourRateAllowedByCurr(
      client,
      postHourRate,
      postHourCurr,
    )
    if (!pairOk.ok) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: pairOk.error })
      return
    }
    const r = await client.query<{ id: string }>(
      `INSERT INTO workgroups (key, name, site_id, costcenter_id, hour_rate, hour_rate_currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        key,
        name,
        siteId,
        costcenterId,
        postHourRate,
        postHourCurr,
        auth.id,
      ],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<WorkgroupTableRow>(
      `SELECT id, site_id, key, name, costcenter_id, hour_rate, hour_rate_currency,
              created_at, updated_at, created_by, updated_by
       FROM workgroups WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'workgroup',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'workgroup',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const workgroup = await fetchWorkgroupWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ workgroup: workgroup! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A workgroup with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid workgroup id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const patchBody = req.body as Record<string, unknown>
  const setClauses: string[] = []
  const setValues: unknown[] = []
  const pushSet = (col: string, v: unknown) => {
    setClauses.push(`${col} = $${setValues.length + 1}`)
    setValues.push(v)
  }

  if (req.body?.key !== undefined) {
    const key =
      typeof req.body.key === 'string' ? req.body.key.trim() : ''
    if (!key) {
      res.status(400).json({ error: 'Key cannot be empty.' })
      return
    }
    pushSet('key', key)
  }
  if (req.body?.name !== undefined) {
    const name =
      typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      res.status(400).json({ error: 'Name cannot be empty.' })
      return
    }
    pushSet('name', name)
  }
  if (req.body?.costcenter_id !== undefined) {
    if (req.body.costcenter_id === null) {
      pushSet('costcenter_id', null)
    } else {
      const s = String(req.body.costcenter_id).trim()
      if (!UUID_RE.test(s)) {
        res.status(400).json({ error: 'Invalid costcenter_id.' })
        return
      }
      pushSet('costcenter_id', s)
    }
  }

  const hasHourPatch =
    Object.prototype.hasOwnProperty.call(patchBody, 'hour_rate') ||
    Object.prototype.hasOwnProperty.call(patchBody, 'hour_rate_currency')

  if (setClauses.length === 0 && !hasHourPatch) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkgroupTableRow>(
      `SELECT id, site_id, key, name, costcenter_id, hour_rate, hour_rate_currency,
              created_at, updated_at, created_by, updated_by
       FROM workgroups
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }

    if (req.body?.costcenter_id !== undefined && req.body.costcenter_id !== null) {
      const cid = String(req.body.costcenter_id).trim()
      if (UUID_RE.test(cid)) {
        const cc = await client.query<{ site_id: string }>(
          `SELECT site_id FROM costcenters WHERE id = $1`,
          [cid],
        )
        const crow = cc.rows[0]
        if (!crow || crow.site_id !== beforeRow.site_id) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'Cost center must exist and belong to the same site.',
          })
          return
        }
      }
    }

    let hourTouched = false
    let hourRate: number | null = coalescePgNumericHourRate(beforeRow.hour_rate)
    let hourCurr = normalizeStoredCurrency(beforeRow.hour_rate_currency)
    if (hasHourPatch) {
      const merged = mergeHourRateFieldsForPatch(beforeRow, patchBody)
      if (!merged.ok) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: merged.error })
        return
      }
      hourTouched = merged.touched
      hourRate = merged.hour_rate
      hourCurr = merged.hour_rate_currency
      if (hourTouched) {
        const pairOk = await assertHourRateAllowedByCurr(
          client,
          hourRate,
          hourCurr,
        )
        if (!pairOk.ok) {
          await client.query('ROLLBACK')
          res.status(400).json({ error: pairOk.error })
          return
        }
      }
    }

    if (setClauses.length === 0 && !hourTouched) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'No fields to update.' })
      return
    }

    const allSets = [...setClauses]
    const allVals = [...setValues]
    if (hourTouched) {
      allSets.push(`hour_rate = $${allVals.length + 1}`)
      allVals.push(hourRate)
      allSets.push(`hour_rate_currency = $${allVals.length + 1}`)
      allVals.push(hourCurr)
    }
    allSets.push('updated_at = now()')
    allSets.push(`updated_by = $${allVals.length + 1}`)
    allVals.push(auth.id)
    const wherePh = `$${allVals.length + 1}`
    allVals.push(id)

    const sql = `UPDATE workgroups SET ${allSets.join(', ')}
               WHERE id = ${wherePh}
               RETURNING id, site_id, key, name, costcenter_id, hour_rate, hour_rate_currency,
                          created_at, updated_at, created_by, updated_by`

    const r = await client.query<WorkgroupTableRow>(sql, allVals)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }

    const beforeState = redactForAudit(
      'workgroup',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'workgroup',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'workgroup',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const workgroup = await fetchWorkgroupWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ workgroup: workgroup! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A workgroup with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid workgroup id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkgroupTableRow>(
      `SELECT id, site_id, key, name, costcenter_id, hour_rate, hour_rate_currency,
              created_at, updated_at, created_by, updated_by
       FROM workgroups
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }

    await client.query(`DELETE FROM workgroups WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'workgroup',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'workgroup',
      resourceId: id,
      beforeState,
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    if (isForeignKeyViolation(e)) {
      res.status(409).json({
        error:
          'This workgroup is assigned to work orders and cannot be deleted.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
