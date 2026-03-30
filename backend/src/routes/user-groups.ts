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

type UserGroupTableRow = {
  id: string
  site_id: string
  key: string
  name: string
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type UserGroupRow = UserGroupTableRow & {
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

async function fetchUserGroupWithJoins(
  client: PoolClient,
  id: string,
): Promise<UserGroupRow | undefined> {
  const r = await client.query<UserGroupRow>(
    `SELECT g.id, g.site_id, g.key, g.name, g.created_at, g.updated_at,
            g.created_by, g.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM user_groups g
     INNER JOIN sites st ON st.id = g.site_id
     LEFT JOIN users cb ON cb.id = g.created_by
     LEFT JOIN users ub ON ub.id = g.updated_by
     WHERE g.id = $1`,
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

function rowToAuditRecord(row: UserGroupTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const LIST_SQL = `
SELECT g.id, g.site_id, g.key, g.name, g.created_at, g.updated_at,
       g.created_by, g.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM user_groups g
INNER JOIN sites st ON st.id = g.site_id
LEFT JOIN users cb ON cb.id = g.created_by
LEFT JOIN users ub ON ub.id = g.updated_by
`

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<UserGroupRow>(
      `${LIST_SQL} ORDER BY st.name ASC, st.key ASC, g.name ASC, g.key ASC`,
    )
    res.json({ user_groups: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ user_groups: [] })
    return
  }
  const r = await pool.query<UserGroupRow>(
    `${LIST_SQL} WHERE g.site_id = ANY($1::uuid[])
     ORDER BY st.name ASC, st.key ASC, g.name ASC, g.key ASC`,
    [allowed],
  )
  res.json({ user_groups: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid user group id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<UserGroupRow>(`${LIST_SQL} WHERE g.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'User group not found.' })
    return
  }
  res.json({ user_group: row })
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

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query<{ id: string }>(
      `INSERT INTO user_groups (key, name, site_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [key, name, siteId, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<UserGroupTableRow>(
      `SELECT id, site_id, key, name, created_at, updated_at, created_by, updated_by
       FROM user_groups WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'user_group',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'user_group',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const userGroup = await fetchUserGroupWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ user_group: userGroup! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A user group with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid user group id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const updates: string[] = []
  const values: unknown[] = []
  let n = 1

  if (req.body?.key !== undefined) {
    const k =
      typeof req.body.key === 'string' ? req.body.key.trim() : ''
    if (!k) {
      res.status(400).json({ error: 'Key cannot be empty.' })
      return
    }
    updates.push(`key = $${n++}`)
    values.push(k)
  }
  if (req.body?.name !== undefined) {
    const nm =
      typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!nm) {
      res.status(400).json({ error: 'Name cannot be empty.' })
      return
    }
    updates.push(`name = $${n++}`)
    values.push(nm)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE user_groups SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, site_id, key, name, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<UserGroupTableRow>(
      `SELECT id, site_id, key, name, created_at, updated_at, created_by, updated_by
       FROM user_groups
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User group not found.' })
      return
    }

    const r = await client.query<UserGroupTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User group not found.' })
      return
    }

    const beforeState = redactForAudit(
      'user_group',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'user_group',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'user_group',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const userGroup = await fetchUserGroupWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ user_group: userGroup! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A user group with this key already exists at this site.',
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
    res.status(400).json({ error: 'Invalid user group id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<UserGroupTableRow>(
      `SELECT id, site_id, key, name, created_at, updated_at, created_by, updated_by
       FROM user_groups
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User group not found.' })
      return
    }

    await client.query(`DELETE FROM user_groups WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'user_group',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'user_group',
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
    throw e
  } finally {
    client.release()
  }
})

export default router
