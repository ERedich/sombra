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
  getShiftAppSettings,
  getWoAppSettings,
  IDLE_SESSION_TIMEOUT_MAX_MINUTES,
  isGeneralDtfId,
  isGeneralFdwId,
  isPgUndefinedRelationError,
  mergeWorkOrderStatusColoursPatch,
  parseWoAppSettingsJson,
  SHIFTS_SETTINGS_KEY,
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
  const shifts = await getShiftAppSettings(pool)
  res.json({
    wo,
    general,
    shifts,
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
  let patchLockEndDateByDuration: boolean | undefined
  let patchAllowPlanStartInHistory: boolean | undefined
  let patchRequireTimeForDone: boolean | undefined
  let patchPlannedHoursRestriction: boolean | undefined
  let patchAllowStatusColours: boolean | undefined
  let patchStatusColours: unknown | undefined
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
    if (w.lock_end_date_by_duration !== undefined) {
      if (typeof w.lock_end_date_by_duration !== 'boolean') {
        res.status(400).json({
          error: 'wo.lock_end_date_by_duration must be a boolean.',
        })
        return
      }
      patchLockEndDateByDuration = w.lock_end_date_by_duration
    }
    if (w.allow_plan_start_in_history !== undefined) {
      if (typeof w.allow_plan_start_in_history !== 'boolean') {
        res.status(400).json({
          error: 'wo.allow_plan_start_in_history must be a boolean.',
        })
        return
      }
      patchAllowPlanStartInHistory = w.allow_plan_start_in_history
    }
    if (w.require_time_registration_for_done !== undefined) {
      if (typeof w.require_time_registration_for_done !== 'boolean') {
        res.status(400).json({
          error: 'wo.require_time_registration_for_done must be a boolean.',
        })
        return
      }
      patchRequireTimeForDone = w.require_time_registration_for_done
    }
    if (w.planned_hours_restriction !== undefined) {
      if (typeof w.planned_hours_restriction !== 'boolean') {
        res.status(400).json({
          error: 'wo.planned_hours_restriction must be a boolean.',
        })
        return
      }
      patchPlannedHoursRestriction = w.planned_hours_restriction
    }
    if (w.allow_custom_work_order_status_colours !== undefined) {
      if (typeof w.allow_custom_work_order_status_colours !== 'boolean') {
        res.status(400).json({
          error: 'wo.allow_custom_work_order_status_colours must be a boolean.',
        })
        return
      }
      patchAllowStatusColours = w.allow_custom_work_order_status_colours
    }
    if (w.work_order_status_colours !== undefined) {
      patchStatusColours = w.work_order_status_colours
    }
  }

  const generalBody = body.general
  let patchIdleMinutes: number | undefined
  let patchDtf: string | undefined
  let patchFdw: string | undefined
  let patchAskForSiteChangeOnLogin: boolean | undefined
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
    if (g.dtf !== undefined) {
      if (!isGeneralDtfId(g.dtf)) {
        res.status(400).json({
          error:
            'general.dtf must be one of: ddmmyyyy_hhmm, ddmmyy_hhmm, mmddyyyy_hhmm, mmddyy_hhmm.',
        })
        return
      }
      patchDtf = g.dtf
    }
    if (g.fdw !== undefined) {
      if (!isGeneralFdwId(g.fdw)) {
        res.status(400).json({
          error: 'general.fdw must be one of: monday, sunday.',
        })
        return
      }
      patchFdw = g.fdw
    }
    if (g.ask_for_site_change_on_login !== undefined) {
      if (typeof g.ask_for_site_change_on_login !== 'boolean') {
        res.status(400).json({
          error: 'general.ask_for_site_change_on_login must be a boolean.',
        })
        return
      }
      patchAskForSiteChangeOnLogin = g.ask_for_site_change_on_login
    }
  }

  const shiftsBody = body.shifts
  let patchShiftLoginRecognition: boolean | undefined
  let patchShiftPlanningCapacityPct: number | undefined
  let patchShiftBoundProjection: boolean | undefined
  if (shiftsBody !== undefined) {
    if (typeof shiftsBody !== 'object' || shiftsBody === null) {
      res.status(400).json({ error: 'shifts must be an object.' })
      return
    }
    const s = shiftsBody as Record<string, unknown>
    if (s.shift_login_recognition !== undefined) {
      if (typeof s.shift_login_recognition !== 'boolean') {
        res.status(400).json({
          error: 'shifts.shift_login_recognition must be a boolean.',
        })
        return
      }
      patchShiftLoginRecognition = s.shift_login_recognition
    }
    if (s.shift_planning_capacity_pct !== undefined) {
      const pct = s.shift_planning_capacity_pct
      if (typeof pct !== 'number' || !Number.isInteger(pct)) {
        res.status(400).json({
          error:
            'shifts.shift_planning_capacity_pct must be an integer between 0 and 100.',
        })
        return
      }
      if (pct < 0 || pct > 100) {
        res.status(400).json({
          error:
            'shifts.shift_planning_capacity_pct must be an integer between 0 and 100.',
        })
        return
      }
      patchShiftPlanningCapacityPct = pct
    }
    if (s.shift_bound_projection !== undefined) {
      if (typeof s.shift_bound_projection !== 'boolean') {
        res.status(400).json({
          error: 'shifts.shift_bound_projection must be a boolean.',
        })
        return
      }
      patchShiftBoundProjection = s.shift_bound_projection
    }
  }

  const hasWoPatch =
    patchStartRequires !== undefined ||
    patchUserAutoAssign !== undefined ||
    patchAllowMultipleStarted !== undefined ||
    patchLockEndDateByDuration !== undefined ||
    patchAllowPlanStartInHistory !== undefined ||
    patchRequireTimeForDone !== undefined ||
    patchPlannedHoursRestriction !== undefined ||
    patchAllowStatusColours !== undefined ||
    patchStatusColours !== undefined
  const hasGeneralPatch =
    patchIdleMinutes !== undefined ||
    patchDtf !== undefined ||
    patchFdw !== undefined ||
    patchAskForSiteChangeOnLogin !== undefined
  const hasShiftsPatch =
    patchShiftLoginRecognition !== undefined ||
    patchShiftPlanningCapacityPct !== undefined ||
    patchShiftBoundProjection !== undefined

  if (!hasWoPatch && !hasGeneralPatch && !hasShiftsPatch) {
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
      if (patchLockEndDateByDuration !== undefined) {
        base.lock_end_date_by_duration = patchLockEndDateByDuration
      }
      if (patchAllowPlanStartInHistory !== undefined) {
        base.allow_plan_start_in_history = patchAllowPlanStartInHistory
      }
      if (patchRequireTimeForDone !== undefined) {
        base.require_time_registration_for_done = patchRequireTimeForDone
      }
      if (patchPlannedHoursRestriction !== undefined) {
        base.planned_hours_restriction = patchPlannedHoursRestriction
      }
      if (patchAllowStatusColours !== undefined) {
        base.allow_custom_work_order_status_colours = patchAllowStatusColours
      }
      if (patchStatusColours !== undefined) {
        const parsedBefore = parseWoAppSettingsJson(base)
        const merged = mergeWorkOrderStatusColoursPatch(
          parsedBefore.work_order_status_colours,
          patchStatusColours,
        )
        if (!merged.ok) {
          await client.query('ROLLBACK')
          res.status(400).json({ error: merged.error })
          return
        }
        base.work_order_status_colours = merged.value
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
      if (patchIdleMinutes !== undefined) {
        baseG.idle_session_timeout_minutes = patchIdleMinutes
      }
      if (patchDtf !== undefined) {
        baseG.dtf = patchDtf
      }
      if (patchFdw !== undefined) {
        baseG.fdw = patchFdw
      }
      if (patchAskForSiteChangeOnLogin !== undefined) {
        baseG.ask_for_site_change_on_login = patchAskForSiteChangeOnLogin
      }
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

    if (hasShiftsPatch) {
      const prevS = await client.query<AppSettingTableRow>(
        `SELECT key, value_json, updated_at, updated_by
         FROM app_settings WHERE key = $1 FOR UPDATE`,
        [SHIFTS_SETTINGS_KEY],
      )
      const beforeRowS = prevS.rows[0]
      if (!beforeRowS) {
        await client.query('ROLLBACK')
        res.status(500).json({ error: 'Shifts app settings row missing.' })
        return
      }
      const beforeStateS = redactForAudit(
        'app_setting',
        rowToAuditRecord(beforeRowS),
      )
      const baseS: Record<string, unknown> =
        typeof beforeRowS.value_json === 'object' &&
        beforeRowS.value_json !== null &&
        !Array.isArray(beforeRowS.value_json)
          ? { ...(beforeRowS.value_json as Record<string, unknown>) }
          : {}
      if (patchShiftLoginRecognition !== undefined) {
        baseS.shift_login_recognition = patchShiftLoginRecognition
      }
      if (patchShiftPlanningCapacityPct !== undefined) {
        baseS.shift_planning_capacity_pct = patchShiftPlanningCapacityPct
      }
      if (patchShiftBoundProjection !== undefined) {
        baseS.shift_bound_projection = patchShiftBoundProjection
      }
      const valueJsonS = JSON.stringify(baseS)
      const updS = await client.query<AppSettingTableRow>(
        `UPDATE app_settings SET
           value_json = $1::jsonb,
           updated_at = now(),
           updated_by = $2
         WHERE key = $3
         RETURNING key, value_json, updated_at, updated_by`,
        [valueJsonS, auth.id, SHIFTS_SETTINGS_KEY],
      )
      const afterRowS = updS.rows[0]
      if (!afterRowS) {
        await client.query('ROLLBACK')
        res.status(500).json({ error: 'Shifts settings update failed.' })
        return
      }
      const afterStateS = redactForAudit(
        'app_setting',
        rowToAuditRecord(afterRowS),
      )
      const changesS =
        beforeStateS && afterStateS
          ? fieldChanges(beforeStateS, afterStateS)
          : null
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'app_setting',
        resourceId: SHIFTS_SETTINGS_KEY,
        beforeState: beforeStateS,
        afterState: afterStateS,
        fieldChanges: changesS,
        httpMethod: req.method,
        path: auditPath,
      })
    }

    await client.query('COMMIT')
    const wo = await getWoAppSettings(pool)
    const general = await getGeneralAppSettings(pool)
    const shifts = await getShiftAppSettings(pool)
    res.json({ wo, general, shifts })
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
