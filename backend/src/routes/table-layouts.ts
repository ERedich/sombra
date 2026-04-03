import { Router } from 'express'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
} from '../audit/auditLog.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const APP_PATH_RE = /^\/[a-zA-Z0-9/_-]{0,200}$/
const LAYOUT_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/

type PresetRow = {
  id: string
  owner_user_id: string
  app_path: string
  layout_key: string
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

function normalizeLayoutKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!LAYOUT_KEY_RE.test(s)) return null
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function rowToAudit(row: PresetRow): Record<string, unknown> {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    app_path: row.app_path,
    layout_key: row.layout_key,
    settings_json: row.settings_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const router = Router()
router.use(requireAuth)

/** List presets visible to the user for an app path + default selection. */
router.get('/', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.query.app_path)
  if (!appPath) {
    res.status(400).json({ error: 'Invalid or missing app_path query.' })
    return
  }

  const own = await pool.query<
    PresetRow & { owner_login_name: string }
  >(
    `SELECT p.id, p.owner_user_id, p.app_path, p.layout_key, p.settings_json,
            p.created_at, p.updated_at, u.login_name AS owner_login_name
     FROM table_layout_presets p
     INNER JOIN users u ON u.id = p.owner_user_id
     WHERE p.owner_user_id = $1 AND p.app_path = $2
     ORDER BY p.layout_key ASC`,
    [auth.id, appPath],
  )

  const shared = await pool.query<
    PresetRow & { owner_login_name: string }
  >(
    `SELECT p.id, p.owner_user_id, p.app_path, p.layout_key, p.settings_json,
            p.created_at, p.updated_at, u.login_name AS owner_login_name
     FROM table_layout_presets p
     INNER JOIN users u ON u.id = p.owner_user_id
     INNER JOIN table_layout_preset_shares s ON s.preset_id = p.id
     WHERE s.user_id = $1 AND p.app_path = $2
     ORDER BY u.login_name ASC, p.layout_key ASC`,
    [auth.id, appPath],
  )

  const def = await pool.query<{ preset_id: string }>(
    `SELECT preset_id FROM user_table_layout_defaults
     WHERE user_id = $1 AND app_path = $2`,
    [auth.id, appPath],
  )
  const default_preset_id = def.rows[0]?.preset_id ?? null

  const presets = [
    ...own.rows.map((r) => ({
      id: r.id,
      app_path: r.app_path,
      layout_key: r.layout_key,
      settings_json: r.settings_json,
      owner_user_id: r.owner_user_id,
      owner_login_name: r.owner_login_name,
      shared: false,
    })),
    ...shared.rows.map((r) => ({
      id: r.id,
      app_path: r.app_path,
      layout_key: r.layout_key,
      settings_json: r.settings_json,
      owner_user_id: r.owner_user_id,
      owner_login_name: r.owner_login_name,
      shared: true,
    })),
  ]

  res.json({
    presets,
    default_preset_id,
  })
})

/** Create or update own preset (keyed by layout_key). */
router.put('/', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.body?.app_path)
  const layoutKey = normalizeLayoutKey(req.body?.layout_key)
  const settingsRaw = req.body?.settings_json

  if (!appPath || !layoutKey) {
    res.status(400).json({
      error:
        'app_path (must start with /) and layout_key (1–64 chars, letters, digits, _ -) are required.',
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

    const existing = await client.query<PresetRow>(
      `SELECT id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at
       FROM table_layout_presets
       WHERE owner_user_id = $1 AND app_path = $2 AND layout_key = $3`,
      [auth.id, appPath, layoutKey],
    )
    const before = existing.rows[0]

    let presetId: string
    if (before) {
      const r = await client.query<PresetRow>(
        `UPDATE table_layout_presets
         SET settings_json = $4::jsonb
         WHERE owner_user_id = $1 AND app_path = $2 AND layout_key = $3
         RETURNING id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at`,
        [auth.id, appPath, layoutKey, JSON.stringify(settingsRaw)],
      )
      const after = r.rows[0]!
      presetId = after.id
      const fc = fieldChanges(
        redactForAudit('table_layout_preset', rowToAudit(before))!,
        redactForAudit('table_layout_preset', rowToAudit(after))!,
      )
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'table_layout_preset',
        resourceId: after.id,
        beforeState: redactForAudit('table_layout_preset', rowToAudit(before)),
        afterState: redactForAudit('table_layout_preset', rowToAudit(after)),
        fieldChanges: fc,
        httpMethod: req.method,
        path: auditPath,
      })
    } else {
      const r = await client.query<PresetRow>(
        `INSERT INTO table_layout_presets (owner_user_id, app_path, layout_key, settings_json)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at`,
        [auth.id, appPath, layoutKey, JSON.stringify(settingsRaw)],
      )
      const after = r.rows[0]!
      presetId = after.id
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'create',
        resourceType: 'table_layout_preset',
        resourceId: after.id,
        beforeState: null,
        afterState: redactForAudit('table_layout_preset', rowToAudit(after)),
        fieldChanges: null,
        httpMethod: req.method,
        path: auditPath,
      })
    }

    await client.query('COMMIT')
    const out = await pool.query<
      PresetRow & { owner_login_name: string }
    >(
      `SELECT p.id, p.owner_user_id, p.app_path, p.layout_key, p.settings_json,
              p.created_at, p.updated_at, u.login_name AS owner_login_name
       FROM table_layout_presets p
       INNER JOIN users u ON u.id = p.owner_user_id
       WHERE p.id = $1`,
      [presetId],
    )
    const row = out.rows[0]!
    res.status(before ? 200 : 201).json({
      preset: {
        id: row.id,
        app_path: row.app_path,
        layout_key: row.layout_key,
        settings_json: row.settings_json,
        owner_user_id: row.owner_user_id,
        owner_login_name: row.owner_login_name,
        shared: false,
      },
    })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

/** Owner deletes preset (shares cascade). */
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
    const r = await client.query<PresetRow>(
      `SELECT id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at
       FROM table_layout_presets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const row = r.rows[0]
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
      resourceType: 'table_layout_preset',
      resourceId: row.id,
      beforeState: redactForAudit('table_layout_preset', rowToAudit(row)),
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })

    await client.query(`DELETE FROM table_layout_presets WHERE id = $1`, [id])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

/** Set which preset opens by default for this user and app (own or shared). */
router.patch('/default', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.body?.app_path)
  const presetIdRaw = req.body?.preset_id

  if (!appPath) {
    res.status(400).json({ error: 'Invalid or missing app_path.' })
    return
  }

  const currentDef = await pool.query<{ preset_id: string }>(
    `SELECT preset_id FROM user_table_layout_defaults
     WHERE user_id = $1 AND app_path = $2`,
    [auth.id, appPath],
  )
  const currentPresetId = currentDef.rows[0]?.preset_id ?? null

  async function presetOwnerId(presetId: string): Promise<string | null> {
    const r = await pool.query<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM table_layout_presets WHERE id = $1`,
      [presetId],
    )
    return r.rows[0]?.owner_user_id ?? null
  }

  if (currentPresetId) {
    const ownerId = await presetOwnerId(currentPresetId)
    const defaultIsShared = ownerId !== null && ownerId !== auth.id
    if (defaultIsShared) {
      if (presetIdRaw === null || presetIdRaw === undefined) {
        res.status(403).json({
          error:
            'Cannot clear default while your default is a layout shared by another user.',
          code: 'default_locked_shared',
        })
        return
      }
      if (typeof presetIdRaw === 'string' && UUID_RE.test(presetIdRaw)) {
        if (presetIdRaw !== currentPresetId) {
          res.status(403).json({
            error:
              'Cannot change default while your default is a layout shared by another user.',
            code: 'default_locked_shared',
          })
          return
        }
        res.json({ ok: true, default_preset_id: currentPresetId })
        return
      }
    }
  }

  if (presetIdRaw === null || presetIdRaw === undefined) {
    await pool.query(
      `DELETE FROM user_table_layout_defaults WHERE user_id = $1 AND app_path = $2`,
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
    `SELECT p.id AS c FROM table_layout_presets p
     WHERE p.id = $1 AND p.app_path = $2 AND (
       p.owner_user_id = $3 OR EXISTS (
         SELECT 1 FROM table_layout_preset_shares s
         WHERE s.preset_id = p.id AND s.user_id = $3
       )
     )`,
    [presetIdRaw, appPath, auth.id],
  )
  if (!access.rows[0]) {
    res.status(404).json({ error: 'Preset not found or not accessible.' })
    return
  }

  await pool.query(
    `INSERT INTO user_table_layout_defaults (user_id, app_path, preset_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, app_path) DO UPDATE SET
       preset_id = EXCLUDED.preset_id,
       updated_at = now()`,
    [auth.id, appPath, presetIdRaw],
  )

  res.json({ ok: true, default_preset_id: presetIdRaw })
})

/** Owner merges one user into shares for multiple presets (same app_path). */
router.post('/share-batch', async (req, res) => {
  const auth = req.authUser!
  const appPath = normalizeAppPath(req.body?.app_path)
  const presetIdsRaw = req.body?.preset_ids
  const userIdRaw = req.body?.user_id

  if (!appPath) {
    res.status(400).json({ error: 'Invalid or missing app_path.' })
    return
  }
  if (typeof userIdRaw !== 'string' || !UUID_RE.test(userIdRaw)) {
    res.status(400).json({ error: 'user_id must be a valid UUID.' })
    return
  }
  if (userIdRaw === auth.id) {
    res.status(400).json({ error: 'Cannot share with yourself.' })
    return
  }
  if (!Array.isArray(presetIdsRaw) || presetIdsRaw.length === 0) {
    res.status(400).json({
      error: 'preset_ids must be a non-empty array of UUIDs.',
    })
    return
  }
  const presetIds = [...new Set(presetIdsRaw)].filter(
    (x): x is string => typeof x === 'string' && UUID_RE.test(x),
  )
  if (presetIds.length !== presetIdsRaw.length) {
    res.status(400).json({
      error: 'Every preset_ids entry must be a valid UUID.',
    })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const id of presetIds) {
      const pr = await client.query<PresetRow>(
        `SELECT id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at
         FROM table_layout_presets WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const preset = pr.rows[0]
      if (!preset) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: `Preset not found: ${id}.` })
        return
      }
      if (preset.owner_user_id !== auth.id) {
        await client.query('ROLLBACK')
        res.status(403).json({
          error: 'Only the owner can share this preset.',
          code: 'not_owner',
        })
        return
      }
      if (preset.app_path !== appPath) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Preset app_path does not match request app_path.',
        })
        return
      }
      await client.query(
        `INSERT INTO table_layout_preset_shares (preset_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, userIdRaw],
      )
    }
    await client.query('COMMIT')
    res.json({ ok: true, preset_count: presetIds.length })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

/** Owner replaces share list for a preset. */
router.put('/:id/shares', async (req, res) => {
  const auth = req.authUser!
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid preset id.' })
    return
  }

  const userIdsRaw = req.body?.user_ids
  if (!Array.isArray(userIdsRaw)) {
    res.status(400).json({ error: 'user_ids must be an array of UUIDs.' })
    return
  }
  const userIds = userIdsRaw.filter(
    (x): x is string => typeof x === 'string' && UUID_RE.test(x),
  )
  if (userIds.length !== userIdsRaw.length) {
    res.status(400).json({ error: 'Every user_ids entry must be a valid UUID.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pr = await client.query<PresetRow>(
      `SELECT id, owner_user_id, app_path, layout_key, settings_json, created_at, updated_at
       FROM table_layout_presets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const preset = pr.rows[0]
    if (!preset) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Preset not found.' })
      return
    }
    if (preset.owner_user_id !== auth.id) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Only the owner can change shares.' })
      return
    }

    const recipients = [...new Set(userIds)].filter((uid) => uid !== auth.id)

    await client.query(`DELETE FROM table_layout_preset_shares WHERE preset_id = $1`, [
      id,
    ])
    for (const uid of recipients) {
      await client.query(
        `INSERT INTO table_layout_preset_shares (preset_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, uid],
      )
    }

    await client.query('COMMIT')
    const list = await pool.query<{ user_id: string; login_name: string }>(
      `SELECT s.user_id, u.login_name
       FROM table_layout_preset_shares s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.preset_id = $1
       ORDER BY u.login_name ASC`,
      [id],
    )
    res.json({ shares: list.rows })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

/** Owner reads current shares (for wizard UI). */
router.get('/:id/shares', async (req, res) => {
  const auth = req.authUser!
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid preset id.' })
    return
  }

  const pr = await pool.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM table_layout_presets WHERE id = $1`,
    [id],
  )
  const preset = pr.rows[0]
  if (!preset) {
    res.status(404).json({ error: 'Preset not found.' })
    return
  }
  if (preset.owner_user_id !== auth.id) {
    res.status(403).json({ error: 'Only the owner can list shares.' })
    return
  }

  const list = await pool.query<{ user_id: string; login_name: string }>(
    `SELECT s.user_id, u.login_name
     FROM table_layout_preset_shares s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.preset_id = $1
     ORDER BY u.login_name ASC`,
    [id],
  )
  res.json({ shares: list.rows })
})

export default router
