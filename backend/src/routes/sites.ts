import { Router } from 'express'
import type { PoolClient } from 'pg'
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

/** Persisted site columns only (used for audit snapshots). */
type SiteTableRow = {
  id: string
  key: string
  name: string
  colour: string
  is_plant: boolean
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type SiteRow = SiteTableRow & {
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

async function fetchSiteWithJoins(
  client: PoolClient,
  id: string,
): Promise<SiteRow | undefined> {
  const r = await client.query<SiteRow>(
    `SELECT s.id, s.key, s.name, s.colour, s.is_plant, s.created_at, s.updated_at,
            s.created_by, s.updated_by,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM sites s
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

function rowToAuditRecord(row: SiteTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const router = Router()
router.use(requireAuth)

const SITES_LIST_SQL = `
SELECT s.id, s.key, s.name, s.colour, s.is_plant, s.created_at, s.updated_at,
       s.created_by, s.updated_by,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM sites s
LEFT JOIN users cb ON cb.id = s.created_by
LEFT JOIN users ub ON ub.id = s.updated_by
`

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<SiteRow>(
      `${SITES_LIST_SQL} ORDER BY s.name ASC, s.key ASC`,
    )
    res.json({ sites: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed !== null && allowed.length === 0) {
    res.json({ sites: [] })
    return
  }
  const r = await pool.query<SiteRow>(
    `${SITES_LIST_SQL} WHERE s.id = ANY($1::uuid[]) ORDER BY s.name ASC, s.key ASC`,
    [allowed],
  )
  res.json({ sites: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid site id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  if (!canAccessSite(scope, id)) {
    res.status(404).json({ error: 'Site not found.' })
    return
  }
  const r = await pool.query<SiteRow>(
    `${SITES_LIST_SQL} WHERE s.id = $1`,
    [id],
  )
  const site = r.rows[0]
  if (!site) {
    res.status(404).json({ error: 'Site not found.' })
    return
  }
  res.json({ site })
})

router.post('/', async (req, res) => {
  const key =
    typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const colourRaw = req.body?.colour
  const colour =
    typeof colourRaw === 'string' && colourRaw.trim() !== ''
      ? colourRaw.trim()
      : '#94a3b8'
  const is_plant = req.body?.is_plant === true

  if (!key || !name) {
    res.status(400).json({ error: 'Key and name are required.' })
    return
  }

  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query<{ id: string }>(
      `INSERT INTO sites (key, name, colour, is_plant, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [key, name, colour, is_plant, auth.id],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const tableRow = await client.query<SiteTableRow>(
      `SELECT id, key, name, colour, is_plant, created_at, updated_at, created_by, updated_by
       FROM sites WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit('site', rowToAuditRecord(persisted))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'site',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const site = await fetchSiteWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ site: site! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: 'A site with this key already exists.' })
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
    res.status(400).json({ error: 'Invalid site id.' })
    return
  }

  const auth = req.authUser!

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
    const colourRaw = req.body.colour
    const colour =
      typeof colourRaw === 'string' && colourRaw.trim() !== ''
        ? colourRaw.trim()
        : '#94a3b8'
    updates.push(`colour = $${n++}`)
    values.push(colour)
  }
  if (req.body?.is_plant !== undefined) {
    if (typeof req.body.is_plant !== 'boolean') {
      res.status(400).json({ error: 'is_plant must be a boolean.' })
      return
    }
    updates.push(`is_plant = $${n++}`)
    values.push(req.body.is_plant)
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  updates.push(`updated_at = now()`)
  updates.push(`updated_by = $${n++}`)
  values.push(auth.id)
  values.push(id)

  const sql = `UPDATE sites SET ${updates.join(', ')}
               WHERE id = $${n}
               RETURNING id, key, name, colour, is_plant, created_at, updated_at, created_by, updated_by`

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<SiteTableRow>(
      `SELECT id, key, name, colour, is_plant, created_at, updated_at, created_by, updated_by
       FROM sites
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Site not found.' })
      return
    }

    const r = await client.query<SiteTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Site not found.' })
      return
    }

    const beforeState = redactForAudit('site', rowToAuditRecord(beforeRow))
    const afterState = redactForAudit('site', rowToAuditRecord(afterTable))
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'site',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const site = await fetchSiteWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ site: site! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: 'A site with this key already exists.' })
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
    res.status(400).json({ error: 'Invalid site id.' })
    return
  }

  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<SiteTableRow>(
      `SELECT id, key, name, colour, is_plant, created_at, updated_at, created_by, updated_by
       FROM sites
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Site not found.' })
      return
    }

    await client.query(`DELETE FROM sites WHERE id = $1`, [id])

    const beforeState = redactForAudit('site', rowToAuditRecord(beforeRow))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'site',
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
