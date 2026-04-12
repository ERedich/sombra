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

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

type ShiftTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  time_start: string
  time_end: string
  available_weekdays: number[]
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type ShiftRow = ShiftTableRow & {
  site_key: string
  site_name: string
  site_colour: string
  created_by_login_name: string | null
  updated_by_login_name: string | null
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

function parseTimeToPg(value: string): string | null {
  const t = value.trim()
  const m = TIME_RE.exec(t)
  if (!m) return null
  const hh = m[1]!.padStart(2, '0')
  const mm = m[2]!
  const ss = m[3] ?? '00'
  return `${hh}:${mm}:${ss}`
}

function parseWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: number[] = []
  for (const x of raw) {
    if (typeof x !== 'number' || !Number.isInteger(x)) return null
    if (x < 1 || x > 7) return null
    out.push(x)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

async function fetchShiftWithJoins(
  client: PoolClient,
  id: string,
): Promise<ShiftRow | undefined> {
  const r = await client.query<ShiftRow>(
    `SELECT s.id, s.site_id, s.key, s.name,
            s.time_start::text AS time_start,
            s.time_end::text AS time_end,
            s.available_weekdays,
            s.created_at, s.updated_at, s.created_by, s.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM shifts s
     INNER JOIN sites st ON st.id = s.site_id
     LEFT JOIN users cb ON cb.id = s.created_by
     LEFT JOIN users ub ON ub.id = s.updated_by
     WHERE s.id = $1`,
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

function rowToAuditRecord(row: ShiftTableRow): Record<string, unknown> {
  return {
    ...row,
    time_start: row.time_start,
    time_end: row.time_end,
    available_weekdays: row.available_weekdays,
  }
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT s.id, s.site_id, s.key, s.name,
       s.time_start::text AS time_start,
       s.time_end::text AS time_end,
       s.available_weekdays,
       s.created_at, s.updated_at, s.created_by, s.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM shifts s
INNER JOIN sites st ON st.id = s.site_id
LEFT JOIN users cb ON cb.id = s.created_by
LEFT JOIN users ub ON ub.id = s.updated_by
`

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<ShiftRow>(
      `${LIST_SQL} ORDER BY st.name ASC, st.key ASC, s.key ASC`,
    )
    res.json({ shifts: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ shifts: [] })
    return
  }
  const r = await pool.query<ShiftRow>(
    `${LIST_SQL} WHERE s.site_id = ANY($1::uuid[])
     ORDER BY st.name ASC, st.key ASC, s.key ASC`,
    [allowed],
  )
  res.json({ shifts: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid shift id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<ShiftRow>(`${LIST_SQL} WHERE s.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Shift not found.' })
    return
  }
  res.json({ shift: row })
})

router.post('/', async (req, res) => {
  const key =
    typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const tsRaw =
    typeof req.body?.time_start === 'string' ? req.body.time_start : ''
  const teRaw =
    typeof req.body?.time_end === 'string' ? req.body.time_end : ''
  const weekdays = parseWeekdays(req.body?.available_weekdays)

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
    return
  }
  const time_start = parseTimeToPg(tsRaw)
  const time_end = parseTimeToPg(teRaw)
  if (!time_start || !time_end) {
    res.status(400).json({
      error: 'time_start and time_end are required (HH:mm or HH:mm:ss).',
    })
    return
  }
  if (!weekdays) {
    res.status(400).json({
      error:
        'available_weekdays must be a non-empty array of integers 1–7 (Mon–Sun, ISO).',
    })
    return
  }

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query<{ id: string }>(
      `INSERT INTO shifts (key, name, time_start, time_end, available_weekdays, site_id, created_by)
       VALUES ($1, $2, $3::time, $4::time, $5::smallint[], $6, $7)
       RETURNING id`,
      [key, name, time_start, time_end, weekdays, siteId, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<ShiftTableRow>(
      `SELECT id, site_id, key, name,
              time_start::text AS time_start,
              time_end::text AS time_end,
              available_weekdays,
              created_at, updated_at, created_by, updated_by
       FROM shifts WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit('shift', rowToAuditRecord(persisted))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'shift',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const shift = await fetchShiftWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ shift: shift! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A shift with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid shift id.' })
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
  if (req.body?.time_start !== undefined) {
    const ts =
      typeof req.body.time_start === 'string'
        ? parseTimeToPg(req.body.time_start)
        : null
    if (!ts) {
      res.status(400).json({ error: 'Invalid time_start.' })
      return
    }
    updates.push(`time_start = $${n++}::time`)
    values.push(ts)
  }
  if (req.body?.time_end !== undefined) {
    const te =
      typeof req.body.time_end === 'string'
        ? parseTimeToPg(req.body.time_end)
        : null
    if (!te) {
      res.status(400).json({ error: 'Invalid time_end.' })
      return
    }
    updates.push(`time_end = $${n++}::time`)
    values.push(te)
  }
  if (req.body?.available_weekdays !== undefined) {
    const wd = parseWeekdays(req.body.available_weekdays)
    if (!wd) {
      res.status(400).json({
        error:
          'available_weekdays must be a non-empty array of integers 1–7 (ISO).',
      })
      return
    }
    updates.push(`available_weekdays = $${n++}::smallint[]`)
    values.push(wd)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE shifts SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, key, name,
                 time_start::text AS time_start,
                 time_end::text AS time_end,
                 available_weekdays,
                 created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<ShiftTableRow>(
      `SELECT id, site_id, key, name,
              time_start::text AS time_start,
              time_end::text AS time_end,
              available_weekdays,
              created_at, updated_at, created_by, updated_by
       FROM shifts
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Shift not found.' })
      return
    }

    const r = await client.query<ShiftTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Shift not found.' })
      return
    }

    const beforeState = redactForAudit('shift', rowToAuditRecord(beforeRow))
    const afterState = redactForAudit('shift', rowToAuditRecord(afterTable))
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'shift',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const shift = await fetchShiftWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ shift: shift! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A shift with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid shift id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<ShiftTableRow>(
      `SELECT id, site_id, key, name,
              time_start::text AS time_start,
              time_end::text AS time_end,
              available_weekdays,
              created_at, updated_at, created_by, updated_by
       FROM shifts
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Shift not found.' })
      return
    }

    await client.query(`DELETE FROM shifts WHERE id = $1`, [id])

    const beforeState = redactForAudit('shift', rowToAuditRecord(beforeRow))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'shift',
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
        error: 'This shift has assignments and cannot be deleted.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
