import { Router } from 'express'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
} from '../audit/auditLog.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getWoAppSettings,
  isPgUndefinedRelationError,
  parseWoAppSettingsJson,
  WO_SETTINGS_KEY,
} from '../services/appSettings.js'

const router = Router()

type AppSettingTableRow = {
  key: string
  value_json: unknown
  updated_at: Date
  updated_by: string | null
}

function rowToAuditRecord(row: AppSettingTableRow): Record<string, unknown> {
  return {
    key: row.key,
    value_json: row.value_json,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    updated_by: row.updated_by,
  }
}

router.use(requireAuth)

router.get('/', async (_req, res) => {
  const wo = await getWoAppSettings(pool)
  res.json({
    wo,
  })
})

router.patch('/', requireAdmin, async (req, res) => {
  if (typeof req.body !== 'object' || req.body === null) {
    res.status(400).json({ error: 'Invalid body.' })
    return
  }
  const body = req.body as Record<string, unknown>
  const woBody = body.wo
  let patchStartRequires: boolean | undefined
  let patchUserAutoAssign: boolean | undefined
  if (woBody !== undefined) {
    if (typeof woBody !== 'object' || woBody === null) {
      res.status(400).json({ error: 'wo must be an object.' })
      return
    }
    const w = woBody as Record<string, unknown>
    if (w.start_requires_assignment !== undefined) {
      if (typeof w.start_requires_assignment !== 'boolean') {
        res.status(400).json({
          error: 'wo.start_requires_assignment must be a boolean.',
        })
        return
      }
      patchStartRequires = w.start_requires_assignment
    }
    if (w.user_auto_assign_on_start !== undefined) {
      if (typeof w.user_auto_assign_on_start !== 'boolean') {
        res.status(400).json({
          error: 'wo.user_auto_assign_on_start must be a boolean.',
        })
        return
      }
      patchUserAutoAssign = w.user_auto_assign_on_start
    }
  }
  if (
    patchStartRequires === undefined &&
    patchUserAutoAssign === undefined
  ) {
    res.status(400).json({ error: 'No supported fields to update.' })
    return
  }

  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AppSettingTableRow>(
      `SELECT key, value_json, updated_at, updated_by
       FROM app_settings WHERE key = $1 FOR UPDATE`,
      [WO_SETTINGS_KEY],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'App settings row missing.' })
      return
    }
    const beforeState = redactForAudit(
      'app_setting',
      rowToAuditRecord(beforeRow),
    )
    const base: Record<string, unknown> =
      typeof beforeRow.value_json === 'object' &&
      beforeRow.value_json !== null &&
      !Array.isArray(beforeRow.value_json)
        ? { ...(beforeRow.value_json as Record<string, unknown>) }
        : {}
    if (patchStartRequires !== undefined) {
      base.start_requires_assignment = patchStartRequires
    }
    if (patchUserAutoAssign !== undefined) {
      base.user_auto_assign_on_start = patchUserAutoAssign
    }
    const valueJson = JSON.stringify(base)
    const upd = await client.query<AppSettingTableRow>(
      `UPDATE app_settings SET
         value_json = $1::jsonb,
         updated_at = now(),
         updated_by = $2
       WHERE key = $3
       RETURNING key, value_json, updated_at, updated_by`,
      [valueJson, auth.id, WO_SETTINGS_KEY],
    )
    const afterRow = upd.rows[0]
    if (!afterRow) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Update failed.' })
      return
    }
    const afterState = redactForAudit(
      'app_setting',
      rowToAuditRecord(afterRow),
    )
    const changes =
      beforeState && afterState
        ? fieldChanges(beforeState, afterState)
        : null
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'app_setting',
      resourceId: WO_SETTINGS_KEY,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    res.json({
      wo: parseWoAppSettingsJson(base),
    })
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback errors after failed transaction
    }
    if (isPgUndefinedRelationError(e)) {
      res.status(503).json({
        error:
          'App settings are not available yet. Apply database migrations (e.g. npm run migrate in backend).',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

export default router
