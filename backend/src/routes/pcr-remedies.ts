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

type PcrRemedyTableRow = {
  id: string
  site_id: string
  cause_id: string
  key: string
  name: string
  description: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type PcrRemedyRow = PcrRemedyTableRow & {
  site_key: string
  site_name: string
  site_colour: string
  cause_key: string
  cause_name: string
  problem_id: string
  problem_key: string
  problem_name: string
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

async function fetchRemedyWithJoins(
  client: PoolClient,
  id: string,
): Promise<PcrRemedyRow | undefined> {
  const r = await client.query<PcrRemedyRow>(
    `SELECT r.id, r.site_id, r.cause_id, r.key, r.name, r.description,
            r.created_at, r.updated_at, r.created_by, r.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            c.key AS cause_key, c.name AS cause_name,
            p.id AS problem_id, p.key AS problem_key, p.name AS problem_name,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM pcr_remedies r
     INNER JOIN sites st ON st.id = r.site_id
     INNER JOIN pcr_causes c ON c.id = r.cause_id
     INNER JOIN pcr_problems p ON p.id = c.problem_id
     LEFT JOIN users cb ON cb.id = r.created_by
     LEFT JOIN users ub ON ub.id = r.updated_by
     WHERE r.id = $1`,
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

function rowToAuditRecord(row: PcrRemedyTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT r.id, r.site_id, r.cause_id, r.key, r.name, r.description,
       r.created_at, r.updated_at, r.created_by, r.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       c.key AS cause_key, c.name AS cause_name,
       p.id AS problem_id, p.key AS problem_key, p.name AS problem_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM pcr_remedies r
INNER JOIN sites st ON st.id = r.site_id
INNER JOIN pcr_causes c ON c.id = r.cause_id
INNER JOIN pcr_problems p ON p.id = c.problem_id
LEFT JOIN users cb ON cb.id = r.created_by
LEFT JOIN users ub ON ub.id = r.updated_by
`

router.get('/', async (req, res) => {
  const orderBy = `ORDER BY st.name ASC, st.key ASC, p.key ASC, c.key ASC, r.key ASC`
  const auth = req.authUser!
  const causeIdRaw = req.query.cause_id
  const causeId =
    typeof causeIdRaw === 'string' && UUID_RE.test(causeIdRaw)
      ? causeIdRaw
      : null
  const problemIdRaw = req.query.problem_id
  const problemId =
    typeof problemIdRaw === 'string' && UUID_RE.test(problemIdRaw)
      ? problemIdRaw
      : null

  const filters: string[] = []
  const params: unknown[] = []

  if (auth.role !== 'admin') {
    const userScope = await loadUserSiteScope(pool, auth.id, auth.role)
    const allowed = accessibleSiteIds(userScope)
    if (allowed === null || allowed.length === 0) {
      res.json({ remedies: [] })
      return
    }
    params.push(allowed)
    filters.push(`r.site_id = ANY($${params.length}::uuid[])`)
  }
  if (causeId) {
    params.push(causeId)
    filters.push(`r.cause_id = $${params.length}`)
  }
  if (problemId) {
    params.push(problemId)
    filters.push(`c.problem_id = $${params.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const q = await pool.query<PcrRemedyRow>(
    `${LIST_SQL} ${where} ${orderBy}`,
    params,
  )
  res.json({ remedies: q.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid remedy id.' })
    return
  }
  const auth = req.authUser!
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)
  const q = await pool.query<PcrRemedyRow>(`${LIST_SQL} WHERE r.id = $1`, [id])
  const row = q.rows[0]
  if (!row || !canAccessSite(userScope, row.site_id)) {
    res.status(404).json({ error: 'Remedy not found.' })
    return
  }
  res.json({ remedy: row })
})

router.post('/', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim() || null
      : null
  const causeId =
    typeof req.body?.cause_id === 'string' ? req.body.cause_id.trim() : ''

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
    return
  }
  if (!UUID_RE.test(causeId)) {
    res.status(400).json({ error: 'A valid cause_id is required.' })
    return
  }

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const parent = await client.query<{ site_id: string }>(
      `SELECT site_id FROM pcr_causes WHERE id = $1`,
      [causeId],
    )
    const parentRow = parent.rows[0]
    if (
      !parentRow ||
      parentRow.site_id !== siteId ||
      !canAccessSite(userScope, parentRow.site_id)
    ) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Parent cause not found for this site.' })
      return
    }

    const insert = await client.query<{ id: string }>(
      `INSERT INTO pcr_remedies (key, name, description, site_id, cause_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [key, name, description, siteId, causeId, auth.id],
    )
    const insertedId = insert.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<PcrRemedyTableRow>(
      `SELECT id, site_id, cause_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_remedies WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'pcr_remedy',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'pcr_remedy',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const remedy = await fetchRemedyWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ remedy: remedy! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A remedy with this key already exists for this site.',
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
    res.status(400).json({ error: 'Invalid remedy id.' })
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
  if (req.body?.cause_id !== undefined) {
    const cid =
      typeof req.body.cause_id === 'string' ? req.body.cause_id.trim() : ''
    if (!UUID_RE.test(cid)) {
      res.status(400).json({ error: 'Invalid cause_id.' })
      return
    }
    updates.push(`cause_id = $${n++}`)
    values.push(cid)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE pcr_remedies SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, cause_id, key, name, description, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<PcrRemedyTableRow>(
      `SELECT id, site_id, cause_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_remedies
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(userScope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Remedy not found.' })
      return
    }

    const r = await client.query<PcrRemedyTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Remedy not found.' })
      return
    }

    const beforeState = redactForAudit(
      'pcr_remedy',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'pcr_remedy',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'pcr_remedy',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const remedy = await fetchRemedyWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ remedy: remedy! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A remedy with this key already exists for this site.',
      })
      return
    }
    if (isForeignKeyViolation(e)) {
      res.status(400).json({ error: 'Referenced cause does not exist.' })
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
    res.status(400).json({ error: 'Invalid remedy id.' })
    return
  }

  const auth = req.authUser!
  const userScope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<PcrRemedyTableRow>(
      `SELECT id, site_id, cause_id, key, name, description, created_at, updated_at, created_by, updated_by
       FROM pcr_remedies
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(userScope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Remedy not found.' })
      return
    }

    await client.query(`DELETE FROM pcr_remedies WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'pcr_remedy',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'pcr_remedy',
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
          'This remedy is referenced by feedback transactions and cannot be deleted.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
