import type { Pool, PoolClient } from 'pg'

const WO_SETTINGS_KEY = 'wo'
export const GENERAL_SETTINGS_KEY = 'general'

/** Max idle timeout in minutes (7 days). */
export const IDLE_SESSION_TIMEOUT_MAX_MINUTES = 10080

export type WoAppSettings = {
  start_requires_assignment: boolean
  user_auto_assign_on_start: boolean
  allow_multiple_started_work_orders: boolean
}

const DEFAULT_WO: WoAppSettings = {
  start_requires_assignment: true,
  user_auto_assign_on_start: true,
  allow_multiple_started_work_orders: false,
}

export function parseWoAppSettingsJson(value: unknown): WoAppSettings {
  const base: WoAppSettings = { ...DEFAULT_WO }
  if (typeof value !== 'object' || value === null) return base
  const o = value as Record<string, unknown>
  if (typeof o.start_requires_assignment === 'boolean') {
    base.start_requires_assignment = o.start_requires_assignment
  }
  if (typeof o.user_auto_assign_on_start === 'boolean') {
    base.user_auto_assign_on_start = o.user_auto_assign_on_start
  }
  if (typeof o.allow_multiple_started_work_orders === 'boolean') {
    base.allow_multiple_started_work_orders =
      o.allow_multiple_started_work_orders
  }
  return base
}

/** PostgreSQL undefined_table / undefined relation (e.g. migration not applied). */
export function isPgUndefinedRelationError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === '42P01'
  )
}

type AppSettingRow = {
  key: string
  value_json: unknown
  updated_at: Date
  updated_by: string | null
}

export async function getWoAppSettings(
  client: Pool | PoolClient,
): Promise<WoAppSettings> {
  try {
    const r = await client.query<Pick<AppSettingRow, 'value_json'>>(
      `SELECT value_json FROM app_settings WHERE key = $1`,
      [WO_SETTINGS_KEY],
    )
    const raw = r.rows[0]?.value_json
    return parseWoAppSettingsJson(raw)
  } catch (e) {
    if (isPgUndefinedRelationError(e)) return { ...DEFAULT_WO }
    throw e
  }
}

/**
 * true = user must be assigned on the WO to start.
 * When the caller already has an open transaction on a `PoolClient`, pass `pool`
 * here so a missing `app_settings` table does not abort that transaction (25P02).
 */
export async function getWoStartRequiresAssignment(
  client: Pool | PoolClient,
): Promise<boolean> {
  const wo = await getWoAppSettings(client)
  return wo.start_requires_assignment
}

/** When SWB is false: if true, insert actor into work_order_employees on start. */
export async function getWoUserAutoAssignOnStart(
  client: Pool | PoolClient,
): Promise<boolean> {
  const wo = await getWoAppSettings(client)
  return wo.user_auto_assign_on_start
}

/** When false (default), user may not start if another assigned WO is started/continued. */
export async function getWoAllowMultipleStartedWorkOrders(
  client: Pool | PoolClient,
): Promise<boolean> {
  const wo = await getWoAppSettings(client)
  return wo.allow_multiple_started_work_orders
}

export function defaultWoAppSettings(): WoAppSettings {
  return { ...DEFAULT_WO }
}

export type GeneralAppSettings = {
  idle_session_timeout_minutes: number
}

const DEFAULT_GENERAL: GeneralAppSettings = {
  idle_session_timeout_minutes: 0,
}

export function parseGeneralAppSettingsJson(
  value: unknown,
): GeneralAppSettings {
  const base: GeneralAppSettings = { ...DEFAULT_GENERAL }
  if (typeof value !== 'object' || value === null) return base
  const o = value as Record<string, unknown>
  const idle = o.idle_session_timeout_minutes
  if (typeof idle === 'number' && Number.isInteger(idle)) {
    base.idle_session_timeout_minutes = Math.min(
      Math.max(0, idle),
      IDLE_SESSION_TIMEOUT_MAX_MINUTES,
    )
  }
  return base
}

export async function getGeneralAppSettings(
  client: Pool | PoolClient,
): Promise<GeneralAppSettings> {
  try {
    const r = await client.query<Pick<AppSettingRow, 'value_json'>>(
      `SELECT value_json FROM app_settings WHERE key = $1`,
      [GENERAL_SETTINGS_KEY],
    )
    const raw = r.rows[0]?.value_json
    return parseGeneralAppSettingsJson(raw)
  } catch (e) {
    if (isPgUndefinedRelationError(e)) return { ...DEFAULT_GENERAL }
    throw e
  }
}

export { WO_SETTINGS_KEY }
