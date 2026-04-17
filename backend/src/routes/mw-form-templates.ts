import { Router } from 'express'
import type { RequestHandler } from 'express'
import type { PoolClient } from 'pg'
import {
  defaultMwLayoutJson,
  isMwFormShellKey,
  mergeMwLayoutJson,
  validateMwLayoutJson,
  type MwFormShellKey,
} from '@sombra/shared'
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

const TEMPLATE_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/

type MwTemplateRow = {
  id: string
  site_id: string
  shell_key: string
  key: string
  name: string
  layout_json: unknown
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type MwTemplateListRow = MwTemplateRow & {
  site_key: string
  site_name: string
  site_colour: string
}

function normalizeShellKey(raw: unknown): MwFormShellKey | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return isMwFormShellKey(s) ? s : null
}

function normalizeTemplateKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!TEMPLATE_KEY_RE.test(s)) return null
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function rowToAudit(row: MwTemplateRow): Record<string, unknown> {
  return {
    id: row.id,
    site_id: row.site_id,
    shell_key: row.shell_key,
    key: row.key,
    name: row.name,
    layout_json: row.layout_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
  }
}

const router = Router()
router.use(requireAuth)

/** Template CRUD and group bindings are admin-only; effective layout stays open to all signed-in users. */
const requireMwAdmin: RequestHandler = (req, res, next) => {
  if (req.authUser!.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' })
    return
  }
  next()
}

const LIST_SQL = `
SELECT t.id, t.site_id, t.shell_key, t.key, t.name, t.layout_json,
       t.created_at, t.updated_at, t.created_by, t.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour
FROM mw_form_templates t
INNER JOIN sites st ON st.id = t.site_id
`

/** Effective layout for current user (group bindings by priority). */
router.get('/effective', async (req, res) => {
  const auth = req.authUser!
  const shell = normalizeShellKey(req.query.shell_key)
  if (!shell) {
    res.status(400).json({ error: 'Invalid or missing shell_key.' })
    return
  }

  const r = await pool.query<{ layout_json: unknown }>(
    `SELECT t.layout_json
     FROM user_user_groups uug
     INNER JOIN user_group_mw_form_template_bindings b
       ON b.user_group_id = uug.user_group_id
     INNER JOIN mw_form_templates t ON t.id = b.mw_form_template_id
     WHERE uug.user_id = $1::uuid AND b.shell_key = $2
     ORDER BY b.priority ASC, t.updated_at DESC, t.id ASC
     LIMIT 1`,
    [auth.id, shell],
  )
  const raw = r.rows[0]?.layout_json
  if (raw === undefined) {
    res.json({ shell_key: shell, layout_json: null })
    return
  }
  const merged = mergeMwLayoutJson(shell, raw)
  res.json({ shell_key: shell, layout_json: merged })
})

router.use(requireMwAdmin)

router.get('/bindings', async (req, res) => {
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const siteFilter =
    typeof req.query.site_id === 'string' && UUID_RE.test(req.query.site_id.trim())
      ? req.query.site_id.trim()
      : null
  if (siteFilter && !canAccessSite(scope, siteFilter)) {
    res.status(403).json({ error: 'Site not accessible.' })
    return
  }
  const allowed = accessibleSiteIds(scope)
  let params: unknown[] = []
  let where = ''
  if (siteFilter) {
    where = 'WHERE ug.site_id = $1'
    params = [siteFilter]
  } else if (allowed === null) {
    where = ''
  } else if (allowed.length === 0) {
    res.json({ bindings: [] })
    return
  } else {
    where = 'WHERE ug.site_id = ANY($1::uuid[])'
    params = [allowed]
  }

  const r = await pool.query<{
    user_group_id: string
    shell_key: string
    mw_form_template_id: string
    priority: number
    updated_at: Date
    group_key: string
    group_name: string
    site_id: string
    template_key: string
    template_name: string
  }>(
    `SELECT b.user_group_id, b.shell_key, b.mw_form_template_id, b.priority, b.updated_at,
            ug.key AS group_key, ug.name AS group_name, ug.site_id,
            t.key AS template_key, t.name AS template_name
     FROM user_group_mw_form_template_bindings b
     INNER JOIN user_groups ug ON ug.id = b.user_group_id
     INNER JOIN mw_form_templates t ON t.id = b.mw_form_template_id
     ${where}
     ORDER BY ug.site_id, ug.name, ug.key, b.shell_key`,
    params,
  )
  res.json({ bindings: r.rows })
})

router.put('/bindings', async (req, res) => {
  const auth = req.authUser!
  const userGroupId =
    typeof req.body?.user_group_id === 'string' ? req.body.user_group_id.trim() : ''
  const templateId =
    typeof req.body?.mw_form_template_id === 'string'
      ? req.body.mw_form_template_id.trim()
      : ''
  const shell = normalizeShellKey(req.body?.shell_key)
  const priorityRaw = req.body?.priority
  const priority =
    typeof priorityRaw === 'number' && Number.isInteger(priorityRaw)
      ? priorityRaw
      : typeof priorityRaw === 'string' && /^\d+$/.test(priorityRaw.trim())
        ? Number.parseInt(priorityRaw.trim(), 10)
        : NaN
  if (!UUID_RE.test(userGroupId) || !UUID_RE.test(templateId) || !shell) {
    res.status(400).json({
      error: 'user_group_id, mw_form_template_id (UUIDs), shell_key, and priority are required.',
    })
    return
  }
  if (!Number.isFinite(priority) || priority < 0 || priority > 1_000_000) {
    res.status(400).json({ error: 'priority must be an integer from 0 to 1000000.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const g = await client.query<{ site_id: string }>(
      `SELECT site_id FROM user_groups WHERE id = $1`,
      [userGroupId],
    )
    const groupSite = g.rows[0]?.site_id
    if (!groupSite) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User group not found.' })
      return
    }
    const scope = await loadUserSiteScope(client, auth.id, auth.role)
    if (!canAccessSite(scope, groupSite)) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'User group site not accessible.' })
      return
    }
    const t = await client.query<{ site_id: string; shell_key: string }>(
      `SELECT site_id, shell_key FROM mw_form_templates WHERE id = $1`,
      [templateId],
    )
    const tpl = t.rows[0]
    if (!tpl) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Template not found.' })
      return
    }
    if (tpl.site_id !== groupSite) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error: 'Template and user group must belong to the same site.',
      })
      return
    }
    if (tpl.shell_key !== shell) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'shell_key must match the template shell_key.' })
      return
    }

    const prev = await client.query<{
      mw_form_template_id: string
      priority: number
    }>(
      `SELECT mw_form_template_id, priority
       FROM user_group_mw_form_template_bindings
       WHERE user_group_id = $1 AND shell_key = $2`,
      [userGroupId, shell],
    )
    const before = prev.rows[0]

    await client.query(
      `INSERT INTO user_group_mw_form_template_bindings
         (user_group_id, shell_key, mw_form_template_id, priority, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (user_group_id, shell_key) DO UPDATE SET
         mw_form_template_id = EXCLUDED.mw_form_template_id,
         priority = EXCLUDED.priority,
         updated_by = EXCLUDED.updated_by`,
      [userGroupId, shell, templateId, priority, auth.id],
    )

    const after = await client.query<{
      mw_form_template_id: string
      priority: number
    }>(
      `SELECT mw_form_template_id, priority
       FROM user_group_mw_form_template_bindings
       WHERE user_group_id = $1 AND shell_key = $2`,
      [userGroupId, shell],
    )
    const a = after.rows[0]!
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: before ? 'update' : 'create',
      resourceType: 'user_group_mw_form_template_binding',
      resourceId: `${userGroupId}:${shell}`,
      beforeState: before
        ? redactForAudit('mw_binding', {
            user_group_id: userGroupId,
            shell_key: shell,
            ...before,
          })
        : null,
      afterState: redactForAudit('mw_binding', {
        user_group_id: userGroupId,
        shell_key: shell,
        ...a,
      }),
      fieldChanges:
        before && a
          ? fieldChanges(
              { mw_form_template_id: before.mw_form_template_id, priority: before.priority },
              { mw_form_template_id: a.mw_form_template_id, priority: a.priority },
            )
          : null,
      httpMethod: req.method,
      path: auditPath,
    })

    await client.query('COMMIT')
    res.json({
      binding: {
        user_group_id: userGroupId,
        shell_key: shell,
        mw_form_template_id: a.mw_form_template_id,
        priority: a.priority,
      },
    })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/bindings', async (req, res) => {
  const auth = req.authUser!
  const userGroupId =
    typeof req.query.user_group_id === 'string' ? req.query.user_group_id.trim() : ''
  const shell = normalizeShellKey(req.query.shell_key)
  if (!UUID_RE.test(userGroupId) || !shell) {
    res.status(400).json({ error: 'user_group_id and shell_key query params required.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const g = await client.query<{ site_id: string }>(
      `SELECT site_id FROM user_groups WHERE id = $1`,
      [userGroupId],
    )
    const groupSite = g.rows[0]?.site_id
    if (!groupSite) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'User group not found.' })
      return
    }
    const scope = await loadUserSiteScope(client, auth.id, auth.role)
    if (!canAccessSite(scope, groupSite)) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'User group site not accessible.' })
      return
    }
    const del = await client.query(
      `DELETE FROM user_group_mw_form_template_bindings
       WHERE user_group_id = $1 AND shell_key = $2`,
      [userGroupId, shell],
    )
    await client.query('COMMIT')
    res.json({ deleted: del.rowCount ?? 0 })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.get('/', async (req, res) => {
  const auth = req.authUser!
  const shell = req.query.shell_key
    ? normalizeShellKey(req.query.shell_key)
    : null
  if (req.query.shell_key && !shell) {
    res.status(400).json({ error: 'Invalid shell_key.' })
    return
  }
  const siteFilter =
    typeof req.query.site_id === 'string' && UUID_RE.test(req.query.site_id.trim())
      ? req.query.site_id.trim()
      : null

  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  if (siteFilter && !canAccessSite(scope, siteFilter)) {
    res.status(403).json({ error: 'Site not accessible.' })
    return
  }

  const allowed = accessibleSiteIds(scope)
  const params: unknown[] = []
  const conds: string[] = []
  if (siteFilter) {
    conds.push(`t.site_id = $${params.length + 1}`)
    params.push(siteFilter)
  } else if (allowed !== null) {
    if (allowed.length === 0) {
      res.json({ templates: [] })
      return
    }
    conds.push(`t.site_id = ANY($${params.length + 1}::uuid[])`)
    params.push(allowed)
  }
  if (shell) {
    conds.push(`t.shell_key = $${params.length + 1}`)
    params.push(shell)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await pool.query<MwTemplateListRow>(
    `${LIST_SQL} ${where}
     ORDER BY st.name ASC, st.key ASC, t.shell_key, t.name ASC, t.key ASC`,
    params,
  )
  res.json({ templates: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid template id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<MwTemplateListRow>(`${LIST_SQL} WHERE t.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Template not found.' })
    return
  }
  res.json({ template: row })
})

router.post('/', async (req, res) => {
  const auth = req.authUser!
  const siteId =
    typeof req.body?.site_id === 'string' ? req.body.site_id.trim() : ''
  const shell = normalizeShellKey(req.body?.shell_key)
  const key = normalizeTemplateKey(req.body?.key)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const layoutRaw = req.body?.layout_json

  if (!UUID_RE.test(siteId) || !shell || !key || !name) {
    res.status(400).json({
      error: 'site_id (UUID), shell_key, key (1–64 alnum _ -), and name are required.',
    })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  if (!canAccessSite(scope, siteId)) {
    res.status(403).json({ error: 'Site not accessible.' })
    return
  }
  const validated = validateMwLayoutJson(
    shell,
    layoutRaw === undefined ? defaultMwLayoutJson(shell) : layoutRaw,
  )
  if (!validated.ok) {
    res.status(400).json({ error: validated.error })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ins = await client.query<MwTemplateRow>(
      `INSERT INTO mw_form_templates (site_id, shell_key, key, name, layout_json, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
       RETURNING id, site_id, shell_key, key, name, layout_json, created_at, updated_at, created_by, updated_by`,
      [
        siteId,
        shell,
        key,
        name,
        JSON.stringify(validated.layout),
        auth.id,
      ],
    )
    const row = ins.rows[0]!
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'mw_form_template',
      resourceId: row.id,
      beforeState: null,
      afterState: redactForAudit('mw_form_template', rowToAudit(row)),
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    const full = await pool.query<MwTemplateListRow>(
      `${LIST_SQL} WHERE t.id = $1`,
      [row.id],
    )
    res.status(201).json({ template: full.rows[0]! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniquePg(e)) {
      res.status(409).json({ error: 'A template with this site, shell, and key already exists.' })
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
    res.status(400).json({ error: 'Invalid template id.' })
    return
  }
  const auth = req.authUser!
  const body = req.body
  if (!isPlainObject(body)) {
    res.status(400).json({ error: 'JSON body required.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<MwTemplateRow>(
      `SELECT id, site_id, shell_key, key, name, layout_json, created_at, updated_at, created_by, updated_by
       FROM mw_form_templates WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const before = cur.rows[0]
    if (!before) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Template not found.' })
      return
    }
    const scope = await loadUserSiteScope(client, auth.id, auth.role)
    if (!canAccessSite(scope, before.site_id)) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Template site not accessible.' })
      return
    }

    const shell = before.shell_key as MwFormShellKey
    if (!isMwFormShellKey(shell)) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Invalid shell in database.' })
      return
    }

    let nextName = before.name
    if (typeof body.name === 'string') {
      const n = body.name.trim()
      if (!n) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'name cannot be empty.' })
        return
      }
      nextName = n
    }

    let nextKey = before.key
    if (body.key !== undefined) {
      const k = normalizeTemplateKey(body.key)
      if (!k) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid key.' })
        return
      }
      nextKey = k
    }

    let nextLayout = before.layout_json
    if (body.layout_json !== undefined) {
      const validated = validateMwLayoutJson(shell, body.layout_json)
      if (!validated.ok) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: validated.error })
        return
      }
      nextLayout = validated.layout
    }

    const upd = await client.query<MwTemplateRow>(
      `UPDATE mw_form_templates
       SET name = $2, key = $3, layout_json = $4::jsonb, updated_by = $5
       WHERE id = $1
       RETURNING id, site_id, shell_key, key, name, layout_json, created_at, updated_at, created_by, updated_by`,
      [id, nextName, nextKey, JSON.stringify(nextLayout), auth.id],
    )
    const after = upd.rows[0]!
    const fc = fieldChanges(
      redactForAudit('mw_form_template', rowToAudit(before))!,
      redactForAudit('mw_form_template', rowToAudit(after))!,
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'mw_form_template',
      resourceId: after.id,
      beforeState: redactForAudit('mw_form_template', rowToAudit(before)),
      afterState: redactForAudit('mw_form_template', rowToAudit(after)),
      fieldChanges: fc,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    const full = await pool.query<MwTemplateListRow>(
      `${LIST_SQL} WHERE t.id = $1`,
      [id],
    )
    res.json({ template: full.rows[0]! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniquePg(e)) {
      res.status(409).json({ error: 'Key conflict for this site and shell.' })
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
    res.status(400).json({ error: 'Invalid template id.' })
    return
  }
  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<MwTemplateRow>(
      `SELECT id, site_id, shell_key, key, name, layout_json, created_at, updated_at, created_by, updated_by
       FROM mw_form_templates WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const before = cur.rows[0]
    if (!before) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Template not found.' })
      return
    }
    const scope = await loadUserSiteScope(client, auth.id, auth.role)
    if (!canAccessSite(scope, before.site_id)) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Template site not accessible.' })
      return
    }
    await client.query(`DELETE FROM mw_form_templates WHERE id = $1`, [id])
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'mw_form_template',
      resourceId: id,
      beforeState: redactForAudit('mw_form_template', rowToAudit(before)),
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

function isUniquePg(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

export default router
