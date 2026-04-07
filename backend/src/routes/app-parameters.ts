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
  GENERAL_SETTINGS_KEY,
  getGeneralAppSettings,
  getWoAppSettings,
  IDLE_SESSION_TIMEOUT_MAX_MINUTES,
  isPgUndefinedRelationError,
  parseGeneralAppSettingsJson,
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
  const general = await getGeneralAppSettings(pool)
  res.json({
    wo,
    general,
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
  let patchAllowMultipleStarted: boolean | undefined
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
    if (w.allow_multiple_started_work_orders !== undefined) {
      if (typeof w.allow_multiple_started_work_orders !== 'boolean') {
        res.status(400).json({
          error: 'wo.allow_multiple_started_work_orders must be a boolean.',
        })
        return
      }
      patchAllowMultipleStarted = w.allow_multiple_started_work_orders
    }
  }

  const generalBody = body.general
  let patchIdleMinutes: number | undefined
  if (generalBody !== undefined) {
    if (typeof generalBody !== 'object' || generalBody === null) {
      res.status(400).json({ error: 'general must be an object.' })
      return
    }
    const g = generalBody as Record<string, unknown>
    if (g.idle_session_timeout_minutes !== undefined) {
      const v = g.idle_session_timeout_minutes
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        res.status(400).json({
          error: 'general.idle_session_timeout_minutes must be an integer.',
        })
        return
      }
      if (v < 0 || v > IDLE_SESSION_TIMEOUT_MAX_MINUTES) {
        res.status(400).json({
          error: `general.idle_session_timeout_minutes must be between 0 and ${IDLE_SESSION_TIMEOUT_MAX_MINUTES}.`,
        })
        return
      }
      patchIdleMinutes = v
    }
  }

  const hasWoPatch =
    patchStartRequires !== undefined ||
    patchUserAutoAssign !== undefined ||
    patchAllowMultipleStarted !== undefined
  const hasGeneralPatch = patchIdleMinutes !== undefined

  if (!hasWoPatch && !hasGeneralPatch) {
    res.status(400).json({ error: 'No supported fields to update.' })
    return
  }

  const auth = req.authUser!
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (hasWoPatch) {
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
      if (patchAllowMultipleStarted !== undefined) {
        base.allow_multiple_started_work_orders = patchAllowMultipleStarted
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
    }

    if (hasGeneralPatch) {
      const prevG = await client.query<AppSettingTableRow>(
        `SELECT key, value_json, updated_at, updated_by
         FROM app_settings WHERE key = $1 FOR UPDATE`,
        [GENERAL_SETTINGS_KEY],
      )
      const beforeRowG = prevG.rows[0]
      if (!beforeRowG) {
        await client.query('ROLLBACK')
        res.status(500).json({ error: 'General app settings row missing.' })
        return
      }
      const beforeStateG = redactForAudit(
        'app_setting',
        rowToAuditRecord(beforeRowG),
      )
      const baseG: Record<string, unknown> =
        typeof beforeRowG.value_json === 'object' &&
        beforeRowG.value_json !== null &&
        !Array.isArray(beforeRowG.value_json)
          ? { ...(beforeRowG.value_json as Record<string, unknown>) }
          : {}
      baseG.idle_session_timeout_minutes = patchIdleMinutes
      const valueJsonG = JSON.stringify(baseG)
      const updG = await client.query<AppSettingTableRow>(
        `UPDATE app_settings SET
           value_json = $1::jsonb,
           updated_at = now(),
           updated_by = $2
         WHERE key = $3
         RETURNING key, value_json, updated_at, updated_by`,
        [valueJsonG, auth.id, GENERAL_SETTINGS_KEY],
      )
      const afterRowG = updG.rows[0]
      if (!afterRowG) {
        await client.query('ROLLBACK')
        res.status(500).json({ error: 'General settings update failed.' })
        return
      }
      const afterStateG = redactForAudit(
        'app_setting',
        rowToAuditRecord(afterRowG),
      )
      const changesG =
        beforeStateG && afterStateG
          ? fieldChanges(beforeStateG, afterStateG)
          : null
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'app_setting',
        resourceId: GENERAL_SETTINGS_KEY,
        beforeState: beforeStateG,
        afterState: afterStateG,
        fieldChanges: changesG,
        httpMethod: req.method,
        path: auditPath,
      })
    }

    await client.query('COMMIT')
    const wo = await getWoAppSettings(pool)
    const general = await getGeneralAppSettings(pool)
    res.json({ wo, general })
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
