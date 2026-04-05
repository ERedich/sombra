import { Router } from 'express'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { fieldChanges, redactForAudit, writeAudit } from '../audit/auditLog.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const APP_PATH_RE = /^\/[a-zA-Z0-9/_-]{0,200}$/
const PRESET_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/

type SearchPresetRow = {
  id: string
  owner_user_id: string
  app_path: string
  preset_key: string
  settings_json: unknown
  created_at: Date
  updated_at: Date
}

function normalizeAppPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!APP_PATH_RE.test(s)) return null
  return s
}

function normalizePresetKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!PRESET_KEY_RE.test(s)) return null
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function rowToAudit(row: SearchPresetRow): Record<string, unknown> {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    app_path: row.app_path,
    preset_key: row.preset_key,
    settings_json: row.settings_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.query.app_path)
  if (!appPath) {
    res.status(400).json({ error: 'Invalid or missing app_path query.' })
    return
  }

  const own = await pool.query<SearchPresetRow & { owner_login_name: string }>(
    `SELECT p.id, p.owner_user_id, p.app_path, p.preset_key, p.settings_json,
            p.created_at, p.updated_at, u.login_name AS owner_login_name
     FROM search_panel_presets p
     INNER JOIN users u ON u.id = p.owner_user_id
     WHERE p.owner_user_id = $1 AND p.app_path = $2
     ORDER BY p.preset_key ASC`,
    [auth.id, appPath],
  )

  const def = await pool.query<{ preset_id: string }>(
    `SELECT preset_id FROM user_search_panel_defaults
     WHERE user_id = $1 AND app_path = $2`,
    [auth.id, appPath],
  )
  const default_preset_id = def.rows[0]?.preset_id ?? null

  res.json({
    presets: own.rows.map((row) => ({
      id: row.id,
      app_path: row.app_path,
      preset_key: row.preset_key,
      settings_json: row.settings_json,
      owner_user_id: row.owner_user_id,
      owner_login_name: row.owner_login_name,
    })),
    default_preset_id,
  })
})

router.put('/', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.body?.app_path)
  const presetKey = normalizePresetKey(req.body?.preset_key)
  const settingsRaw = req.body?.settings_json

  if (!appPath || !presetKey) {
    res.status(400).json({
      error:
        'app_path (must start with /) and preset_key (1-64 chars, letters, digits, _ -) are required.',
    })
    return
  }
  if (!isPlainObject(settingsRaw)) {
    res.status(400).json({ error: 'settings_json must be a JSON object.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<SearchPresetRow>(
      `SELECT id, owner_user_id, app_path, preset_key, settings_json, created_at, updated_at
       FROM search_panel_presets
       WHERE owner_user_id = $1 AND app_path = $2 AND preset_key = $3`,
      [auth.id, appPath, presetKey],
    )
    const before = existing.rows[0]

    let presetId: string
    if (before) {
      const updated = await client.query<SearchPresetRow>(
        `UPDATE search_panel_presets
         SET settings_json = $4::jsonb
         WHERE owner_user_id = $1 AND app_path = $2 AND preset_key = $3
         RETURNING id, owner_user_id, app_path, preset_key, settings_json, created_at, updated_at`,
        [auth.id, appPath, presetKey, JSON.stringify(settingsRaw)],
      )
      const after = updated.rows[0]!
      presetId = after.id
      const fc = fieldChanges(
        redactForAudit('search_panel_preset', rowToAudit(before))!,
        redactForAudit('search_panel_preset', rowToAudit(after))!,
      )
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'search_panel_preset',
        resourceId: after.id,
        beforeState: redactForAudit('search_panel_preset', rowToAudit(before)),
        afterState: redactForAudit('search_panel_preset', rowToAudit(after)),
        fieldChanges: fc,
        httpMethod: req.method,
        path: auditPath,
      })
    } else {
      const inserted = await client.query<SearchPresetRow>(
        `INSERT INTO search_panel_presets (owner_user_id, app_path, preset_key, settings_json)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, owner_user_id, app_path, preset_key, settings_json, created_at, updated_at`,
        [auth.id, appPath, presetKey, JSON.stringify(settingsRaw)],
      )
      const after = inserted.rows[0]!
      presetId = after.id
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'create',
        resourceType: 'search_panel_preset',
        resourceId: after.id,
        beforeState: null,
        afterState: redactForAudit('search_panel_preset', rowToAudit(after)),
        fieldChanges: null,
        httpMethod: req.method,
        path: auditPath,
      })
    }

    await client.query('COMMIT')
    const out = await pool.query<SearchPresetRow & { owner_login_name: string }>(
      `SELECT p.id, p.owner_user_id, p.app_path, p.preset_key, p.settings_json,
              p.created_at, p.updated_at, u.login_name AS owner_login_name
       FROM search_panel_presets p
       INNER JOIN users u ON u.id = p.owner_user_id
       WHERE p.id = $1`,
      [presetId],
    )
    const row = out.rows[0]!
    res.status(before ? 200 : 201).json({
      preset: {
        id: row.id,
        app_path: row.app_path,
        preset_key: row.preset_key,
        settings_json: row.settings_json,
        owner_user_id: row.owner_user_id,
        owner_login_name: row.owner_login_name,
      },
    })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const auth = req.authUser!
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid preset id.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<SearchPresetRow>(
      `SELECT id, owner_user_id, app_path, preset_key, settings_json, created_at, updated_at
       FROM search_panel_presets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const row = found.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Preset not found.' })
      return
    }
    if (row.owner_user_id !== auth.id) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Only the owner can delete this preset.' })
      return
    }

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'search_panel_preset',
      resourceId: row.id,
      beforeState: redactForAudit('search_panel_preset', rowToAudit(row)),
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })

    await client.query(`DELETE FROM search_panel_presets WHERE id = $1`, [id])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.patch('/default', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.body?.app_path)
  const presetIdRaw = req.body?.preset_id
  if (!appPath) {
    res.status(400).json({ error: 'Invalid or missing app_path.' })
    return
  }

  if (presetIdRaw == null) {
    await pool.query(
      `DELETE FROM user_search_panel_defaults WHERE user_id = $1 AND app_path = $2`,
      [auth.id, appPath],
    )
    res.json({ ok: true, default_preset_id: null })
    return
  }

  if (typeof presetIdRaw !== 'string' || !UUID_RE.test(presetIdRaw)) {
    res.status(400).json({ error: 'preset_id must be a UUID or null.' })
    return
  }

  const access = await pool.query<{ c: string }>(
    `SELECT p.id AS c FROM search_panel_presets p
     WHERE p.id = $1 AND p.app_path = $2 AND p.owner_user_id = $3`,
    [presetIdRaw, appPath, auth.id],
  )
  if (!access.rows[0]) {
    res.status(404).json({ error: 'Preset not found or not accessible.' })
    return
  }

  await pool.query(
    `INSERT INTO user_search_panel_defaults (user_id, app_path, preset_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, app_path) DO UPDATE SET
       preset_id = EXCLUDED.preset_id,
       updated_at = now()`,
    [auth.id, appPath, presetIdRaw],
  )

  res.json({ ok: true, default_preset_id: presetIdRaw })
})

export default router
