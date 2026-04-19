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

type PcrProblemTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  description: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type PcrProblemRow = PcrProblemTableRow & {
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

async function fetchProblemWithJoins(
  client: PoolClient,
  id: string,
): Promise<PcrProblemRow | undefined> {
  const r = await client.query<PcrProblemRow>(
    `SELECT p.id, p.site_id, p.key, p.name, p.description, p.created_at, p.updated_at,
            p.created_by, p.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM pcr_problems p
     INNER JOIN sites st ON st.id = p.site_id
     LEFT JOIN users cb ON cb.id = p.created_by
     LEFT JOIN users ub ON ub.id = p.updated_by
     WHERE p.id = $1`,
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

function rowToAuditRecord(row: PcrProblemTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT p.id, p.site_id, p.key, p.name, p.description, p.created_at, p.updated_at,
       p.created_by, p.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM pcr_problems p
INNER JOIN sites st ON st.id = p.site_id
LEFT JOIN users cb ON cb.id = p.created_by
LEFT JOIN users ub ON ub.id = p.updated_by
`

router.get('/', async (req, res) => {
  const orderBy = `ORDER BY st.name ASC, st.key ASC, p.key ASC`
  const auth = req.authUser!

  if (auth.role === 'admin') {
    const r = await pool.query<PcrProblemRow>(`${LIST_SQL} ${orderBy}`)
    res.json({ problems: r.rows })
    return
  }

  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(userScope)
  if (allowed === null || allowed.length === 0) {
    res.json({ problems: [] })
    return
  }
  const r = await pool.query<PcrProblemRow>(
    `${LIST_SQL} WHERE p.site_id = ANY($1::uuid[]) ${orderBy}`,
    [allowed],
  )
  res.json({ problems: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid problem id.' })
    return
  }
  const auth = req.authUser!
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<PcrProblemRow>(`${LIST_SQL} WHERE p.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(userScope, row.site_id)) {
    res.status(404).json({ error: 'Problem not found.' })
    return
  }
  res.json({ problem: row })
})

router.post('/', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim() || null
      : null

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
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
      `INSERT INTO pcr_problems (key, name, description, site_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [key, name, description, siteId, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<PcrProblemTableRow>(
      `SELECT id, site_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_problems WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'pcr_problem',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'pcr_problem',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const problem = await fetchProblemWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ problem: problem! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A problem with this key already exists for this site.',
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
    res.status(400).json({ error: 'Invalid problem id.' })
    return
  }

  const auth = req.authUser!
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)

  const updates: string[] = []
  const values: unknown[] = []
  let n = 1

  if (req.body?.key !== undefined) {
    const key = typeof req.body.key === 'string' ? req.body.key.trim() : ''
    if (!key) {
      res.status(400).json({ error: 'Key cannot be empty.' })
      return
    }
    updates.push(`key = $${n++}`)
    values.push(key)
  }
  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      res.status(400).json({ error: 'Name cannot be empty.' })
      return
    }
    updates.push(`name = $${n++}`)
    values.push(name)
  }
  if (req.body?.description !== undefined) {
    const raw = req.body.description
    const description =
      typeof raw === 'string' ? raw.trim() || null : raw === null ? null : null
    updates.push(`description = $${n++}`)
    values.push(description)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE pcr_problems SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, key, name, description, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<PcrProblemTableRow>(
      `SELECT id, site_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_problems
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(userScope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Problem not found.' })
      return
    }

    const r = await client.query<PcrProblemTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Problem not found.' })
      return
    }

    const beforeState = redactForAudit(
      'pcr_problem',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'pcr_problem',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'pcr_problem',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const problem = await fetchProblemWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ problem: problem! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A problem with this key already exists for this site.',
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
    res.status(400).json({ error: 'Invalid problem id.' })
    return
  }

  const auth = req.authUser!
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<PcrProblemTableRow>(
      `SELECT id, site_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_problems
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(userScope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Problem not found.' })
      return
    }

    await client.query(`DELETE FROM pcr_problems WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'pcr_problem',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'pcr_problem',
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
          'This problem is referenced by causes and cannot be deleted.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
