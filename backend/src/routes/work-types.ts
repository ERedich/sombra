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

type WorkTypeTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  colour: string
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type WorkTypeRow = WorkTypeTableRow & {
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

async function fetchWorkTypeWithJoins(
  client: PoolClient,
  id: string,
): Promise<WorkTypeRow | undefined> {
  const r = await client.query<WorkTypeRow>(
    `SELECT wt.id, wt.site_id, wt.key, wt.name, wt.colour, wt.created_at, wt.updated_at,
            wt.created_by, wt.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM work_types wt
     INNER JOIN sites st ON st.id = wt.site_id
     LEFT JOIN users cb ON cb.id = wt.created_by
     LEFT JOIN users ub ON ub.id = wt.updated_by
     WHERE wt.id = $1`,
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

function rowToAuditRecord(row: WorkTypeTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT wt.id, wt.site_id, wt.key, wt.name, wt.colour, wt.created_at, wt.updated_at,
       wt.created_by, wt.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM work_types wt
INNER JOIN sites st ON st.id = wt.site_id
LEFT JOIN users cb ON cb.id = wt.created_by
LEFT JOIN users ub ON ub.id = wt.updated_by
`

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<WorkTypeRow>(
      `${LIST_SQL} ORDER BY st.name ASC, st.key ASC, wt.key ASC`,
    )
    res.json({ work_types: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ work_types: [] })
    return
  }
  const r = await pool.query<WorkTypeRow>(
    `${LIST_SQL} WHERE wt.site_id = ANY($1::uuid[])
     ORDER BY st.name ASC, st.key ASC, wt.key ASC`,
    [allowed],
  )
  res.json({ work_types: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work type id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<WorkTypeRow>(`${LIST_SQL} WHERE wt.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Work type not found.' })
    return
  }
  res.json({ work_type: row })
})

router.post('/', async (req, res) => {
  const key =
    typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const colourRaw =
    typeof req.body?.colour === 'string' ? req.body.colour.trim() : ''

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
    return
  }
  const colour = colourRaw || '#94a3b8'

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query<{ id: string }>(
      `INSERT INTO work_types (key, name, colour, site_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [key, name, colour, siteId, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<WorkTypeTableRow>(
      `SELECT id, site_id, key, name, colour, created_at, updated_at, created_by, updated_by
       FROM work_types WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'work_type',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'work_type',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const workType = await fetchWorkTypeWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ work_type: workType! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A work type with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid work type id.' })
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
  if (req.body?.colour !== undefined) {
    const colour =
      typeof req.body.colour === 'string' ? req.body.colour.trim() : ''
    if (!colour) {
      res.status(400).json({ error: 'Colour cannot be empty.' })
      return
    }
    updates.push(`colour = $${n++}`)
    values.push(colour)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE work_types SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, key, name, colour, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkTypeTableRow>(
      `SELECT id, site_id, key, name, colour, created_at, updated_at, created_by, updated_by
       FROM work_types
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work type not found.' })
      return
    }

    const r = await client.query<WorkTypeTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work type not found.' })
      return
    }

    const beforeState = redactForAudit(
      'work_type',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_type',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_type',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const workType = await fetchWorkTypeWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ work_type: workType! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A work type with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid work type id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkTypeTableRow>(
      `SELECT id, site_id, key, name, colour, created_at, updated_at, created_by, updated_by
       FROM work_types
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work type not found.' })
      return
    }

    await client.query(`DELETE FROM work_types WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'work_type',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'work_type',
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
          'This work type is referenced by work orders and cannot be deleted.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
