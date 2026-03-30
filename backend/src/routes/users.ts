// TODO: Replace blanket requireAuth with fine-grained permission checks when roles/permissions are implemented.
import { Router } from 'express'
import bcrypt from 'bcrypt'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { fieldChanges, redactForAudit, writeAudit } from '../audit/auditLog.js'
import { parseOptionalEmail } from '../validation/email.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Matches [`migrate.ts`](./migrate.ts) bootstrap admin; cannot be changed or removed via API. */
const BOOTSTRAP_ADMIN_LOGIN_NAME = 'admin'

function isBootstrapAdminLoginName(loginName: string): boolean {
  return loginName === BOOTSTRAP_ADMIN_LOGIN_NAME
}

type AdditionalSiteJson = { id: string; key: string; name: string }

type UserGroupJson = { id: string; key: string; name: string; site_id: string }

type UserTableRow = {
  id: string
  login_name: string
  name: string
  email: string | null
  role: string
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
  working_site_id: string | null
  allow_site_change_on_login: boolean
}

type UserRow = UserTableRow & {
  created_by_login_name: string | null
  updated_by_login_name: string | null
  additional_sites: AdditionalSiteJson[]
  groups: UserGroupJson[]
  working_site_key: string | null
  working_site_name: string | null
  working_site_colour: string | null
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function rowToAuditRecord(
  row: UserTableRow,
  additionalSiteIds: string[],
  userGroupIds?: string[],
): Record<string, unknown> {
  return {
    ...(row as unknown as Record<string, unknown>),
    additional_site_ids: additionalSiteIds,
    user_group_ids: userGroupIds ?? [],
  }
}

async function fetchAdditionalSiteIds(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const r = await client.query<{ site_id: string }>(
    `SELECT site_id FROM user_additional_sites WHERE user_id = $1 ORDER BY site_id`,
    [userId],
  )
  return r.rows.map((x) => x.site_id)
}

async function verifySitesExist(
  client: PoolClient,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true
  const r = await client.query(
    `SELECT count(*)::int AS c FROM sites WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return r.rows[0]?.c === ids.length
}

async function replaceAdditionalSites(
  client: PoolClient,
  userId: string,
  siteIds: string[],
): Promise<void> {
  await client.query(`DELETE FROM user_additional_sites WHERE user_id = $1`, [
    userId,
  ])
  if (siteIds.length === 0) return
  await client.query(
    `INSERT INTO user_additional_sites (user_id, site_id)
     SELECT $1, x::uuid FROM unnest($2::text[]) AS x`,
    [userId, siteIds],
  )
}

async function fetchUserGroupIds(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const r = await client.query<{ user_group_id: string }>(
    `SELECT user_group_id FROM user_user_groups WHERE user_id = $1 ORDER BY user_group_id`,
    [userId],
  )
  return r.rows.map((x) => x.user_group_id)
}

async function replaceUserGroups(
  client: PoolClient,
  userId: string,
  groupIds: string[],
  allowedSiteIds: Set<string>,
): Promise<{ error?: string }> {
  const unique = [...new Set(groupIds.map((x) => x.trim()).filter(Boolean))]
  for (const id of unique) {
    if (!UUID_RE.test(id)) return { error: 'Invalid user_group id.' }
  }
  if (unique.length === 0) {
    await client.query(`DELETE FROM user_user_groups WHERE user_id = $1`, [
      userId,
    ])
    return {}
  }
  const r = await client.query<{ id: string; site_id: string }>(
    `SELECT id, site_id FROM user_groups WHERE id = ANY($1::uuid[])`,
    [unique],
  )
  if (r.rows.length !== unique.length) {
    return { error: 'One or more user groups do not exist.' }
  }
  for (const row of r.rows) {
    if (!allowedSiteIds.has(row.site_id)) {
      return {
        error:
          'User cannot be assigned to a group outside their accessible sites.',
      }
    }
  }
  await client.query(`DELETE FROM user_user_groups WHERE user_id = $1`, [
    userId,
  ])
  await client.query(
    `INSERT INTO user_user_groups (user_id, user_group_id)
     SELECT $1, x::uuid FROM unnest($2::text[]) AS x`,
    [userId, unique],
  )
  return {}
}

type NormalizedSites = {
  working_site_id: string | null
  additional_site_ids: string[]
  allow_site_change_on_login: boolean
}

async function normalizeSiteAssignment(
  client: PoolClient,
  working: string | null,
  additional: string[],
  allow: boolean,
): Promise<NormalizedSites | { error: string }> {
  const addSet = [...new Set(additional.map((x) => x.trim()).filter(Boolean))]
  for (const id of addSet) {
    if (!UUID_RE.test(id)) return { error: 'Invalid site id in additional_site_ids.' }
  }
  let ws = working
  if (ws !== null && ws !== undefined && ws !== '' && !UUID_RE.test(ws)) {
    return { error: 'Invalid working_site_id.' }
  }
  if (ws === '') ws = null
  const additionalFiltered = addSet.filter((id) => id !== ws)
  const allIds = [...(ws ? [ws] : []), ...additionalFiltered]
  if (allIds.length && !(await verifySitesExist(client, [...new Set(allIds)]))) {
    return { error: 'One or more sites do not exist.' }
  }
  let allowFinal = allow
  if (additionalFiltered.length === 0) allowFinal = false
  if (allowFinal && additionalFiltered.length === 0) allowFinal = false
  return {
    working_site_id: ws,
    additional_site_ids: additionalFiltered,
    allow_site_change_on_login: allowFinal,
  }
}

const USER_SELECT = `
  u.id, u.login_name, u.name, u.email, u.role, u.created_at, u.updated_at,
  u.created_by, u.updated_by,
  u.working_site_id, u.allow_site_change_on_login,
  cb.login_name AS created_by_login_name,
  ub.login_name AS updated_by_login_name,
  ws.key AS working_site_key,
  ws.name AS working_site_name,
  ws.colour AS working_site_colour,
  COALESCE(
    (SELECT json_agg(json_build_object('id', s.id, 'key', s.key, 'name', s.name) ORDER BY s.name, s.key)
     FROM user_additional_sites uas
     JOIN sites s ON s.id = uas.site_id
     WHERE uas.user_id = u.id),
    '[]'::json
  ) AS additional_sites,
  COALESCE(
    (SELECT json_agg(json_build_object('id', ug.id, 'key', ug.key, 'name', ug.name, 'site_id', ug.site_id) ORDER BY ug.name, ug.key)
     FROM user_user_groups uug
     JOIN user_groups ug ON ug.id = uug.user_group_id
     WHERE uug.user_id = u.id),
    '[]'::json
  ) AS groups
`

function mapUserRow(raw: UserRow): UserRow {
  const add = raw.additional_sites
  const sites = Array.isArray(add) ? add : JSON.parse(String(add)) as AdditionalSiteJson[]
  const grp = raw.groups
  const groups = Array.isArray(grp)
    ? grp
    : (JSON.parse(String(grp)) as UserGroupJson[])
  return { ...raw, additional_sites: sites, groups }
}

async function fetchUserWithJoins(
  client: PoolClient,
  id: string,
): Promise<UserRow | undefined> {
  const r = await client.query<UserRow>(
    `SELECT ${USER_SELECT}
     FROM users u
     LEFT JOIN users cb ON cb.id = u.created_by
     LEFT JOIN users ub ON ub.id = u.updated_by
     LEFT JOIN sites ws ON ws.id = u.working_site_id
     WHERE u.id = $1`,
    [id],
  )
  const row = r.rows[0]
  return row ? mapUserRow(row) : undefined
}

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  const r = await pool.query<UserRow>(
    `SELECT ${USER_SELECT}
     FROM users u
     LEFT JOIN users cb ON cb.id = u.created_by
     LEFT JOIN users ub ON ub.id = u.updated_by
     LEFT JOIN sites ws ON ws.id = u.working_site_id
     ORDER BY u.login_name ASC`,
  )
  res.json({ users: r.rows.map(mapUserRow) })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid user id.' })
    return
  }
  const r = await pool.query<UserRow>(
    `SELECT ${USER_SELECT}
     FROM users u
     LEFT JOIN users cb ON cb.id = u.created_by
     LEFT JOIN users ub ON ub.id = u.updated_by
     LEFT JOIN sites ws ON ws.id = u.working_site_id
     WHERE u.id = $1`,
    [id],
  )
  const row = r.rows[0]
  if (!row) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  res.json({ user: mapUserRow(row) })
})

router.post('/', async (req, res) => {
  const loginName =
    typeof req.body?.login_name === 'string' ? req.body.login_name.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const password =
    typeof req.body?.password === 'string' ? req.body.password : ''
  const emailParsed = parseOptionalEmail(req.body?.email)
  if (!emailParsed.ok) {
    res.status(400).json({ error: emailParsed.error })
    return
  }
  const email = emailParsed.value
  const roleRaw = req.body?.role
  const role =
    typeof roleRaw === 'string' && roleRaw.trim() !== ''
      ? roleRaw.trim()
      : 'user'

  const workingRaw = req.body?.working_site_id
  const working_site_id: string | null =
    workingRaw === null || workingRaw === undefined
      ? null
      : typeof workingRaw === 'string' && workingRaw.trim() !== ''
        ? workingRaw.trim()
        : null

  const addRaw = req.body?.additional_site_ids
  const additional_site_ids: string[] = Array.isArray(addRaw)
    ? addRaw.filter((x: unknown) => typeof x === 'string') as string[]
    : []

  const userGroupRaw = req.body?.user_group_ids
  const user_group_ids: string[] = Array.isArray(userGroupRaw)
    ? userGroupRaw.filter((x: unknown) => typeof x === 'string') as string[]
    : []

  const allowRaw = req.body?.allow_site_change_on_login
  const allow_site_change_on_login =
    typeof allowRaw === 'boolean' ? allowRaw : false

  if (!loginName || !name || !password) {
    res.status(400).json({
      error: 'login_name, name, and password are required.',
    })
    return
  }

  if (
    working_site_id === null ||
    working_site_id === undefined ||
    !UUID_RE.test(working_site_id)
  ) {
    res.status(400).json({ error: 'working_site_id is required.' })
    return
  }

  if (isBootstrapAdminLoginName(loginName)) {
    res.status(403).json({
      error: 'The bootstrap admin login name is reserved and cannot be assigned to new users.',
    })
    return
  }

  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const norm = await normalizeSiteAssignment(
      client,
      working_site_id,
      additional_site_ids,
      allow_site_change_on_login,
    )
    if ('error' in norm) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: norm.error })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const ins = await client.query<{ id: string }>(
      `INSERT INTO users (
         login_name, name, email, password_hash, role, created_by,
         working_site_id, allow_site_change_on_login
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        loginName,
        name,
        email,
        passwordHash,
        role,
        auth.id,
        norm.working_site_id,
        norm.allow_site_change_on_login,
      ],
    )
    const newId = ins.rows[0]?.id
    if (!newId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    await replaceAdditionalSites(client, newId, norm.additional_site_ids)

    const allowedSites = new Set<string>()
    if (norm.working_site_id) allowedSites.add(norm.working_site_id)
    for (const x of norm.additional_site_ids) allowedSites.add(x)
    const rg = await replaceUserGroups(
      client,
      newId,
      user_group_ids,
      allowedSites,
    )
    if ('error' in rg) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: rg.error })
      return
    }

    const persisted = await client.query<UserTableRow>(
      `SELECT id, login_name, name, email, role, created_at, updated_at, created_by, updated_by,
              working_site_id, allow_site_change_on_login
       FROM users WHERE id = $1`,
      [newId],
    )
    const tableRow = persisted.rows[0]!
    const addIds = await fetchAdditionalSiteIds(client, newId)
    const groupIds = await fetchUserGroupIds(client, newId)
    const afterState = redactForAudit(
      'user',
      rowToAuditRecord(tableRow, addIds, groupIds),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'user',
      resourceId: tableRow.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const user = await fetchUserWithJoins(client, newId)
    await client.query('COMMIT')
    res.status(201).json({ user: user! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res
        .status(409)
        .json({ error: 'A user with this login name or email already exists.' })
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
    res.status(400).json({ error: 'Invalid user id.' })
    return
  }

  const auth = req.authUser!
  const updates: string[] = []
  const values: unknown[] = []
  let n = 1

  if (req.body?.login_name !== undefined) {
    const loginName =
      typeof req.body.login_name === 'string' ? req.body.login_name.trim() : ''
    if (!loginName) {
      res.status(400).json({ error: 'login_name cannot be empty.' })
      return
    }
    updates.push(`login_name = $${n++}`)
    values.push(loginName)
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
  if (req.body?.email !== undefined) {
    const emailParsed = parseOptionalEmail(req.body.email)
    if (!emailParsed.ok) {
      res.status(400).json({ error: emailParsed.error })
      return
    }
    updates.push(`email = $${n++}`)
    values.push(emailParsed.value)
  }
  if (req.body?.role !== undefined) {
    const roleRaw = req.body.role
    const role =
      typeof roleRaw === 'string' && roleRaw.trim() !== ''
        ? roleRaw.trim()
        : 'user'
    updates.push(`role = $${n++}`)
    values.push(role)
  }
  if (
    req.body?.password !== undefined &&
    typeof req.body.password === 'string' &&
    req.body.password !== ''
  ) {
    const hash = await bcrypt.hash(req.body.password, 10)
    updates.push(`password_hash = $${n++}`)
    values.push(hash)
  }

  const hasSitePatch =
    'working_site_id' in req.body ||
    'additional_site_ids' in req.body ||
    'allow_site_change_on_login' in req.body

  const hasGroupPatch = 'user_group_ids' in req.body

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<UserTableRow>(
      `SELECT id, login_name, name, email, role, created_at, updated_at, created_by, updated_by,
              working_site_id, allow_site_change_on_login
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User not found.' })
      return
    }
    if (isBootstrapAdminLoginName(beforeRow.login_name)) {
      await client.query('ROLLBACK')
      res.status(403).json({
        error: 'The bootstrap admin user cannot be modified.',
      })
      return
    }
    const beforeAddIds = await fetchAdditionalSiteIds(client, id)
    const beforeGroupIds = await fetchUserGroupIds(client, id)

    let norm: NormalizedSites | null = null
    if (hasSitePatch) {
      const w =
        'working_site_id' in req.body
          ? req.body.working_site_id === null ||
            req.body.working_site_id === undefined
            ? null
            : typeof req.body.working_site_id === 'string'
              ? req.body.working_site_id.trim() || null
              : null
          : beforeRow.working_site_id

      const add =
        'additional_site_ids' in req.body && Array.isArray(req.body.additional_site_ids)
          ? (req.body.additional_site_ids as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : beforeAddIds

      const al =
        'allow_site_change_on_login' in req.body
          ? Boolean(req.body.allow_site_change_on_login)
          : beforeRow.allow_site_change_on_login

      const nrm = await normalizeSiteAssignment(client, w, add, al)
      if ('error' in nrm) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: nrm.error })
        return
      }
      if (nrm.working_site_id === null) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'working_site_id is required.' })
        return
      }
      norm = nrm
      updates.push(`working_site_id = $${n++}`)
      values.push(norm.working_site_id)
      updates.push(`allow_site_change_on_login = $${n++}`)
      values.push(norm.allow_site_change_on_login)
    }

    if (updates.length === 0 && !hasSitePatch && !hasGroupPatch) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'No fields to update.' })
      return
    }

    let afterTable: UserTableRow
    if (updates.length > 0) {
      updates.push(`updated_at = now()`)
      updates.push(`updated_by = $${n++}`)
      values.push(auth.id)
      values.push(id)
      const sql = `UPDATE users SET ${updates.join(', ')}
                   WHERE id = $${n}
                   RETURNING id, login_name, name, email, role, created_at, updated_at, created_by, updated_by,
                             working_site_id, allow_site_change_on_login`
      const r = await client.query<UserTableRow>(sql, values)
      afterTable = r.rows[0]!
    } else {
      afterTable = beforeRow
    }

    if (norm) {
      await replaceAdditionalSites(client, id, norm.additional_site_ids)
    }

    const afterAddIds = await fetchAdditionalSiteIds(client, id)

    if (hasGroupPatch) {
      const raw = req.body.user_group_ids
      const gids = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === 'string') as string[]
        : []
      const allowedSites = new Set<string>()
      if (afterTable.working_site_id) {
        allowedSites.add(afterTable.working_site_id)
      }
      for (const x of afterAddIds) allowedSites.add(x)
      const rg = await replaceUserGroups(client, id, gids, allowedSites)
      if ('error' in rg) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: rg.error })
        return
      }
    }

    const afterGroupIds = await fetchUserGroupIds(client, id)

    const beforeState = redactForAudit(
      'user',
      rowToAuditRecord(beforeRow, beforeAddIds, beforeGroupIds),
    )
    const afterState = redactForAudit(
      'user',
      rowToAuditRecord(afterTable, afterAddIds, afterGroupIds),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'user',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const user = await fetchUserWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ user: user! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res
        .status(409)
        .json({ error: 'A user with this login name or email already exists.' })
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
    res.status(400).json({ error: 'Invalid user id.' })
    return
  }

  const auth = req.authUser!
  if (id === auth.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<UserTableRow>(
      `SELECT id, login_name, name, email, role, created_at, updated_at, created_by, updated_by,
              working_site_id, allow_site_change_on_login
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User not found.' })
      return
    }
    if (isBootstrapAdminLoginName(beforeRow.login_name)) {
      await client.query('ROLLBACK')
      res.status(403).json({
        error: 'The bootstrap admin user cannot be deleted.',
      })
      return
    }
    const beforeAddIds = await fetchAdditionalSiteIds(client, id)
    const beforeGroupIds = await fetchUserGroupIds(client, id)

    await client.query(`DELETE FROM users WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'user',
      rowToAuditRecord(beforeRow, beforeAddIds, beforeGroupIds),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'user',
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
