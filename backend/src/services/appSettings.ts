import type { Pool, PoolClient } from 'pg'

const WO_SETTINGS_KEY = 'wo'
export const GENERAL_SETTINGS_KEY = 'general'
export const SHIFTS_SETTINGS_KEY = 'shifts'

/** Max idle timeout in minutes (7 days). */
export const IDLE_SESSION_TIMEOUT_MAX_MINUTES = 10080

/** Work order status keys allowed in `work_order_status_colours` JSON. */
export const WO_SETTINGS_STATUS_KEYS = [
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
  'done',
  'closed',
] as const

export type WoSettingsStatusKey = (typeof WO_SETTINGS_STATUS_KEYS)[number]

const WO_STATUS_HEX_RE = /^#[0-9A-Fa-f]{6}$/

export type WoAppSettings = {
  start_requires_assignment: boolean
  user_auto_assign_on_start: boolean
  allow_multiple_started_work_orders: boolean
  /**
   * LEDD: when true, plan_end is always plan_start + duration (locked).
   * When false (default), plan_end may be set independently (>= plan_start).
   */
  lock_end_date_by_duration: boolean
  /**
   * PSH: when true, plan_start may be before UTC today; when false (default),
   * plan_start must be on or after UTC today (POST; PATCH unchanged past allowed).
   */
  allow_plan_start_in_history: boolean
  /** TRR: when true (default), Done requires sum(transactions.hours) > 0. */
  require_time_registration_for_done: boolean
  /**
   * PHR: when true (default, user “N”), planned hours per employee/day cannot exceed
   * the SPC shift bucket. When false (“Y”), that cap is not enforced server-side.
   */
  planned_hours_restriction: boolean
  /** WOST: when true, UI uses `work_order_status_colours` overrides. */
  allow_custom_work_order_status_colours: boolean
  work_order_status_colours: Partial<Record<WoSettingsStatusKey, string>>
}

const DEFAULT_WO: WoAppSettings = {
  start_requires_assignment: true,
  user_auto_assign_on_start: true,
  allow_multiple_started_work_orders: false,
  lock_end_date_by_duration: false,
  allow_plan_start_in_history: false,
  require_time_registration_for_done: true,
  planned_hours_restriction: true,
  allow_custom_work_order_status_colours: false,
  work_order_status_colours: {},
}

function parseWorkOrderStatusColours(
  value: unknown,
): Partial<Record<WoSettingsStatusKey, string>> {
  const out: Partial<Record<WoSettingsStatusKey, string>> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return out
  }
  const o = value as Record<string, unknown>
  for (const k of WO_SETTINGS_STATUS_KEYS) {
    const v = o[k]
    if (typeof v === 'string' && WO_STATUS_HEX_RE.test(v.trim())) {
      out[k] = v.trim().toLowerCase()
    }
  }
  return out
}

/**
 * Validates a PATCH object for status colours: only known keys, each value #rrggbb.
 * Returns merged map or an error message.
 */
export function mergeWorkOrderStatusColoursPatch(
  existing: Partial<Record<WoSettingsStatusKey, string>>,
  patch: unknown,
):
  | { ok: true; value: Partial<Record<WoSettingsStatusKey, string>> }
  | { ok: false; error: string } {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'wo.work_order_status_colours must be an object.' }
  }
  const p = patch as Record<string, unknown>
  const allowed = new Set<string>(WO_SETTINGS_STATUS_KEYS)
  for (const k of Object.keys(p)) {
    if (!allowed.has(k)) {
      return {
        ok: false,
        error: `wo.work_order_status_colours has unknown status key: ${k}.`,
      }
    }
    const v = p[k]
    if (typeof v !== 'string' || !WO_STATUS_HEX_RE.test(v.trim())) {
      return {
        ok: false,
        error: `wo.work_order_status_colours.${k} must be a #RRGGBB colour.`,
      }
    }
  }
  const next: Partial<Record<WoSettingsStatusKey, string>> = {
    ...existing,
  }
  for (const k of WO_SETTINGS_STATUS_KEYS) {
    if (!(k in p)) continue
    const v = p[k]
    if (typeof v === 'string' && WO_STATUS_HEX_RE.test(v.trim())) {
      next[k] = v.trim().toLowerCase()
    }
  }
  return { ok: true, value: next }
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
  if (typeof o.lock_end_date_by_duration === 'boolean') {
    base.lock_end_date_by_duration = o.lock_end_date_by_duration
  }
  if (typeof o.allow_plan_start_in_history === 'boolean') {
    base.allow_plan_start_in_history = o.allow_plan_start_in_history
  }
  if (typeof o.require_time_registration_for_done === 'boolean') {
    base.require_time_registration_for_done =
      o.require_time_registration_for_done
  }
  if (typeof o.planned_hours_restriction === 'boolean') {
    base.planned_hours_restriction = o.planned_hours_restriction
  }
  if (typeof o.allow_custom_work_order_status_colours === 'boolean') {
    base.allow_custom_work_order_status_colours =
      o.allow_custom_work_order_status_colours
  }
  base.work_order_status_colours = parseWorkOrderStatusColours(
    o.work_order_status_colours,
  )
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

export async function getWoRequireTimeRegistrationForDone(
  client: Pool | PoolClient,
): Promise<boolean> {
  const wo = await getWoAppSettings(client)
  return wo.require_time_registration_for_done
}

export function defaultWoAppSettings(): WoAppSettings {
  return {
    ...DEFAULT_WO,
    work_order_status_colours: { ...DEFAULT_WO.work_order_status_colours },
  }
}

/** Date/time display format (general app setting `dtf`). */
export const GENERAL_DTF_VALUES = [
  'ddmmyyyy_hhmm',
  'ddmmyy_hhmm',
  'mmddyyyy_hhmm',
  'mmddyy_hhmm',
] as const

export type GeneralDtfId = (typeof GENERAL_DTF_VALUES)[number]

export const DEFAULT_GENERAL_DTF: GeneralDtfId = 'ddmmyyyy_hhmm'

export function isGeneralDtfId(value: unknown): value is GeneralDtfId {
  return (
    typeof value === 'string' &&
    (GENERAL_DTF_VALUES as readonly string[]).includes(value)
  )
}

/** First day of week (general app setting `fdw`). */
export const GENERAL_FDW_VALUES = ['monday', 'sunday'] as const

export type GeneralFdwId = (typeof GENERAL_FDW_VALUES)[number]

export const DEFAULT_GENERAL_FDW: GeneralFdwId = 'monday'

export function isGeneralFdwId(value: unknown): value is GeneralFdwId {
  return (
    typeof value === 'string' &&
    (GENERAL_FDW_VALUES as readonly string[]).includes(value)
  )
}

/** CURR: selectable ISO-style currency codes (3 letters). First = app default. */
export const DEFAULT_GENERAL_CURRENCIES: readonly string[] = ['EUR']

export const GENERAL_CURRENCIES_MAX = 24

const GENERAL_CURRENCY_CODE_RE = /^[A-Za-z]{3}$/

function normalizeOneCurrencyCode(raw: string): string | null {
  const u = raw.trim().toUpperCase()
  return GENERAL_CURRENCY_CODE_RE.test(u) ? u : null
}

/**
 * Lenient parse from stored JSON: invalid entries dropped, deduped, min one code, max GENERAL_CURRENCIES_MAX.
 */
export function normalizeGeneralCurrenciesList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_GENERAL_CURRENCIES]
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of value) {
    if (typeof x !== 'string') continue
    const c = normalizeOneCurrencyCode(x)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
    if (out.length >= GENERAL_CURRENCIES_MAX) break
  }
  return out.length > 0 ? out : [...DEFAULT_GENERAL_CURRENCIES]
}

/**
 * Strict validation for PATCH `general.currencies`: non-empty, all valid 3-letter codes, deduped, capped.
 */
export function validateGeneralCurrenciesPatch(
  value: unknown,
):
  | { ok: true; value: string[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'general.currencies must be an array.' }
  }
  if (value.length === 0) {
    return {
      ok: false,
      error: 'general.currencies must contain at least one currency code.',
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    const x = value[i]
    if (typeof x !== 'string') {
      return {
        ok: false,
        error: `general.currencies[${i}] must be a string (3-letter code).`,
      }
    }
    const c = normalizeOneCurrencyCode(x)
    if (!c) {
      return {
        ok: false,
        error: `general.currencies[${i}] must be a 3-letter currency code (A–Z).`,
      }
    }
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
    if (out.length > GENERAL_CURRENCIES_MAX) {
      return {
        ok: false,
        error: `general.currencies must contain at most ${GENERAL_CURRENCIES_MAX} distinct codes.`,
      }
    }
  }
  if (out.length === 0) {
    return {
      ok: false,
      error: 'general.currencies must contain at least one valid currency code.',
    }
  }
  return { ok: true, value: out }
}

export type GeneralAppSettings = {
  idle_session_timeout_minutes: number
  dtf: GeneralDtfId
  /** FDW: first column of week-based calendars (Prime + custom month grid). */
  fdw: GeneralFdwId
  /** When true, users with 2+ assigned plant sites are prompted for working site at login. */
  ask_for_site_change_on_login: boolean
  /** CURR: ordered list of selectable currency codes; first is default. */
  currencies: string[]
}

const DEFAULT_GENERAL: GeneralAppSettings = {
  idle_session_timeout_minutes: 0,
  dtf: DEFAULT_GENERAL_DTF,
  fdw: DEFAULT_GENERAL_FDW,
  ask_for_site_change_on_login: false,
  currencies: [...DEFAULT_GENERAL_CURRENCIES],
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
  if (isGeneralDtfId(o.dtf)) {
    base.dtf = o.dtf
  }
  if (isGeneralFdwId(o.fdw)) {
    base.fdw = o.fdw
  }
  if (typeof o.ask_for_site_change_on_login === 'boolean') {
    base.ask_for_site_change_on_login = o.ask_for_site_change_on_login
  }
  base.currencies = normalizeGeneralCurrenciesList(o.currencies)
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

/** SPC: max share of a shift (%) that may be used for planned work (e.g. work plans). */
export const SHIFT_PLANNING_CAPACITY_PCT_MIN = 0
export const SHIFT_PLANNING_CAPACITY_PCT_MAX = 100

/** System shift row per site when DSP (Apply Default Shift Plan) is enabled. */
export const RESERVED_DSP_SHIFT_KEY = '_dsp_default'
export const RESERVED_DSP_SHIFT_NAME = 'Default shift plan'

const SHIFT_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** Parse HH:mm / HH:mm:ss for shift settings and DB `time` columns. */
export function parseShiftSettingTimeToPg(value: string): string | null {
  const t = value.trim()
  const m = SHIFT_TIME_RE.exec(t)
  if (!m) return null
  const hh = m[1]!.padStart(2, '0')
  const mm = m[2]!
  const ss = m[3] ?? '00'
  return `${hh}:${mm}:${ss}`
}

const DEFAULT_SHIFT_WEEKDAYS: number[] = [1, 2, 3, 4, 5]

function parseDefaultShiftWeekdays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_SHIFT_WEEKDAYS]
  const out: number[] = []
  for (const x of value) {
    if (typeof x !== 'number' || !Number.isInteger(x)) continue
    if (x < 1 || x > 7) continue
    out.push(x)
  }
  if (out.length === 0) return [...DEFAULT_SHIFT_WEEKDAYS]
  return [...new Set(out)].sort((a, b) => a - b)
}

function normalizeShiftSettingTimeString(raw: unknown, fallbackPg: string): string {
  if (typeof raw !== 'string') return fallbackPg
  const pg = parseShiftSettingTimeToPg(raw)
  return pg ?? fallbackPg
}

export type ShiftAppSettings = {
  /** SLR: auto-mark present on login when time matches assigned shift. */
  shift_login_recognition: boolean
  /** SPC: 0–100, default 100. */
  shift_planning_capacity_pct: number
  /**
   * SBPR (shift bound projection): when true (default), planner times follow shift
   * definitions; when false, scheduled assignments may use custom wall times.
   */
  shift_bound_projection: boolean
  /**
   * DSP: when true, capacities use default times/weekdays (one `_dsp_default` shift per site).
   */
  apply_default_shift_plan: boolean
  /** Wall times as HH:MM:SS (Postgres time). */
  default_shift_time_start: string
  default_shift_time_end: string
  /** ISO weekdays 1–7 (Mon–Sun). */
  default_shift_weekdays: number[]
}

const DEFAULT_SHIFTS: ShiftAppSettings = {
  shift_login_recognition: true,
  shift_planning_capacity_pct: SHIFT_PLANNING_CAPACITY_PCT_MAX,
  shift_bound_projection: true,
  apply_default_shift_plan: false,
  default_shift_time_start: '08:00:00',
  default_shift_time_end: '17:00:00',
  default_shift_weekdays: [...DEFAULT_SHIFT_WEEKDAYS],
}

export function dspShiftScheduleIsValid(s: ShiftAppSettings): boolean {
  if (!s.apply_default_shift_plan) return true
  if (!parseShiftSettingTimeToPg(s.default_shift_time_start)) return false
  if (!parseShiftSettingTimeToPg(s.default_shift_time_end)) return false
  if (!Array.isArray(s.default_shift_weekdays) || s.default_shift_weekdays.length === 0) {
    return false
  }
  return true
}

export function isReservedDspShiftKey(key: string): boolean {
  return key === RESERVED_DSP_SHIFT_KEY || key.startsWith('_dsp')
}

export function parseShiftAppSettingsJson(value: unknown): ShiftAppSettings {
  const base: ShiftAppSettings = { ...DEFAULT_SHIFTS }
  if (typeof value !== 'object' || value === null) return base
  const o = value as Record<string, unknown>
  if (typeof o.shift_login_recognition === 'boolean') {
    base.shift_login_recognition = o.shift_login_recognition
  }
  const pct = o.shift_planning_capacity_pct
  if (typeof pct === 'number' && Number.isInteger(pct)) {
    base.shift_planning_capacity_pct = Math.min(
      SHIFT_PLANNING_CAPACITY_PCT_MAX,
      Math.max(SHIFT_PLANNING_CAPACITY_PCT_MIN, pct),
    )
  }
  if (typeof o.shift_bound_projection === 'boolean') {
    base.shift_bound_projection = o.shift_bound_projection
  }
  if (typeof o.apply_default_shift_plan === 'boolean') {
    base.apply_default_shift_plan = o.apply_default_shift_plan
  }
  base.default_shift_time_start = normalizeShiftSettingTimeString(
    o.default_shift_time_start,
    base.default_shift_time_start,
  )
  base.default_shift_time_end = normalizeShiftSettingTimeString(
    o.default_shift_time_end,
    base.default_shift_time_end,
  )
  base.default_shift_weekdays = parseDefaultShiftWeekdays(o.default_shift_weekdays)
  return base
}

export async function getShiftAppSettings(
  client: Pool | PoolClient,
): Promise<ShiftAppSettings> {
  try {
    const r = await client.query<Pick<AppSettingRow, 'value_json'>>(
      `SELECT value_json FROM app_settings WHERE key = $1`,
      [SHIFTS_SETTINGS_KEY],
    )
    const raw = r.rows[0]?.value_json
    return parseShiftAppSettingsJson(raw)
  } catch (e) {
    if (isPgUndefinedRelationError(e)) return { ...DEFAULT_SHIFTS }
    throw e
  }
}

export { WO_SETTINGS_KEY }
