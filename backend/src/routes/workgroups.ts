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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WorkgroupTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  costcenter_id: string | null
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

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT wg.id, wg.site_id, wg.key, wg.name, wg.costcenter_id,
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

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query<{ id: string }>(
      `INSERT INTO workgroups (key, name, site_id, costcenter_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [key, name, siteId, costcenterId, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<WorkgroupTableRow>(
      `SELECT id, site_id, key, name, costcenter_id, created_at, updated_at, created_by, updated_by
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

  const updates: string[] = []
  const values: unknown[] = []
  let n = 1

  if (req.body?.key !== undefined) {
    const key =
      typeof req.body.key === 'string' ? req.body.key.trim() : ''
    if (!key) {
      res.status(400).json({ error: 'Key cannot be empty.' })
      return
    }
    updates.push(`key = $${n++}`)
    values.push(key)
  }
  if (req.body?.name !== undefined) {
    const name =
      typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      res.status(400).json({ error: 'Name cannot be empty.' })
      return
    }
    updates.push(`name = $${n++}`)
    values.push(name)
  }
  if (req.body?.costcenter_id !== undefined) {
    if (req.body.costcenter_id === null) {
      updates.push(`costcenter_id = $${n++}`)
      values.push(null)
    } else {
      const s = String(req.body.costcenter_id).trim()
      if (!UUID_RE.test(s)) {
        res.status(400).json({ error: 'Invalid costcenter_id.' })
        return
      }
      updates.push(`costcenter_id = $${n++}`)
      values.push(s)
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE workgroups SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, key, name, costcenter_id, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkgroupTableRow>(
      `SELECT id, site_id, key, name, costcenter_id, created_at, updated_at, created_by, updated_by
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

    const r = await client.query<WorkgroupTableRow>(sql, values)
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
      `SELECT id, site_id, key, name, costcenter_id, created_at, updated_at, created_by, updated_by
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
