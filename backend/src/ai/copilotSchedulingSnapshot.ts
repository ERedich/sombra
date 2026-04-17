import type { Pool } from 'pg'
import { getShiftAppSettings, type ShiftAppSettings } from '../services/appSettings.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** German + English month names / common abbreviations → 1–12 (ASCII-normalized keys). */
const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mrz: 3,
  mar: 3,
  marz: 3,
  maerz: 3,
  march: 3,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dec: 12,
  december: 12,
}

function asciiFold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
}

function preferDMYForLocale(locale: string): boolean {
  const loc = (locale || 'en').toLowerCase()
  if (loc === 'de' || loc.startsWith('de-')) return true
  if (loc === 'en-gb' || loc.startsWith('en-gb')) return true
  return false
}

function utcYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function monthFromToken(tok: string): number | null {
  const k = asciiFold(tok).replace(/\.$/, '').trim()
  if (!k) return null
  if (MONTH_NAME_TO_NUM[k] != null) return MONTH_NAME_TO_NUM[k]
  const p3 = k.slice(0, 3)
  return MONTH_NAME_TO_NUM[p3] ?? null
}

/**
 * Turn user/model date text into `YYYY-MM-DD` for scheduling SQL.
 * Accepts strict ISO date, optional time prefix stripped, `DD.MM.YYYY` / `DD/MM/YYYY` (DMY when locale is de/en-GB),
 * and `17. Apr. 2026` / `17 April 2026` style (DE/EN month names).
 */
export function resolveCopilotSchedulingDateParam(
  raw: string,
  locale: string,
): { ok: true; iso: string } | { ok: false; error: string } {
  let s = raw.trim()
  if (!s) {
    return { ok: false, error: 'empty string' }
  }

  const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (isoPrefix) {
    s = isoPrefix[1]!
  }

  if (DATE_RE.test(s)) {
    return { ok: true, iso: s }
  }

  const dmySlash = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s)
  if (dmySlash) {
    const a = parseInt(dmySlash[1]!, 10)
    const b = parseInt(dmySlash[2]!, 10)
    const y = parseInt(dmySlash[3]!, 10)
    let day: number
    let month: number
    if (preferDMYForLocale(locale)) {
      day = a
      month = b
    } else {
      // en-US style M/D/YYYY when both ≤ 12
      if (a <= 12 && b <= 12 && a !== b) {
        return {
          ok: false,
          error: `ambiguous numeric date ${JSON.stringify(raw)} for locale ${JSON.stringify(locale)}; use YYYY-MM-DD`,
        }
      }
      month = a
      day = b
    }
    const iso = utcYmd(y, month, day)
    if (!iso) {
      return { ok: false, error: `invalid calendar day in ${JSON.stringify(raw)}` }
    }
    return { ok: true, iso }
  }

  const dmyText = /^(\d{1,2})\.\s*([a-zA-ZäöüÄÖÜß]+)\.?\s*(\d{4})$/.exec(s)
  if (dmyText) {
    const day = parseInt(dmyText[1]!, 10)
    const mon = monthFromToken(dmyText[2]!)
    const y = parseInt(dmyText[3]!, 10)
    if (mon == null) {
      return { ok: false, error: `unknown month in ${JSON.stringify(raw)}` }
    }
    const iso = utcYmd(y, mon, day)
    if (!iso) {
      return { ok: false, error: `invalid calendar day in ${JSON.stringify(raw)}` }
    }
    return { ok: true, iso }
  }

  const dmySpace = /^(\d{1,2})\s+([a-zA-ZäöüÄÖÜß]+)\s+(\d{4})$/.exec(s)
  if (dmySpace) {
    const day = parseInt(dmySpace[1]!, 10)
    const mon = monthFromToken(dmySpace[2]!)
    const y = parseInt(dmySpace[3]!, 10)
    if (mon == null) {
      return { ok: false, error: `unknown month in ${JSON.stringify(raw)}` }
    }
    const iso = utcYmd(y, mon, day)
    if (!iso) {
      return { ok: false, error: `invalid calendar day in ${JSON.stringify(raw)}` }
    }
    return { ok: true, iso }
  }

  return {
    ok: false,
    error: `not a recognized date (use YYYY-MM-DD, or e.g. 17.04.2026 / 17. Apr. 2026 for German)`,
  }
}

/** Max inclusive calendar days between date_from and date_to for Kira scheduling tools. */
export const COPILOT_SCHEDULING_MAX_RANGE_DAYS = 31

/** Default cap on work orders returned (slim rows). */
export const COPILOT_SCHEDULING_DEFAULT_MAX_WOS = 200

const WO_OVERLAP_SQL = `
    w.plan_start IS NOT NULL
    AND w.plan_end IS NOT NULL
    AND w.plan_start <> w.plan_end
    AND (w.plan_start AT TIME ZONE 'UTC')::date <= $2::date
    AND (w.plan_end AT TIME ZONE 'UTC')::date >= $1::date
`

const COPILOT_WO_SLIM_SQL = `
SELECT w.id, w.wo_key, w.short_text, w.status,
       w.asset_id, a.key AS asset_key, a.name AS asset_name,
       w.workgroup_id, wg.key AS workgroup_key, wg.name AS workgroup_name,
       wt.key AS work_type_key, wt.name AS work_type_name,
       w.plan_start, w.plan_end,
       w.planned_duration::text AS planned_duration_text,
       COALESCE(
         (SELECT array_agg(woe.employee_id::text ORDER BY woe.employee_id::text)
          FROM work_order_employees woe
          WHERE woe.work_order_id = w.id),
         ARRAY[]::text[]
       ) AS assigned_employee_ids
FROM work_orders w
INNER JOIN assets a ON a.id = w.asset_id
INNER JOIN workgroups wg ON wg.id = w.workgroup_id
INNER JOIN work_types wt ON wt.id = w.work_type_id
`

const SHIFT_ASSIGNMENTS_SLIM_SQL = `
SELECT sa.id, sa.shift_id, sa.assignment_date::text AS assignment_date,
       sa.employee_id, sa.presence_status,
       sh.key AS shift_key, sh.name AS shift_name,
       COALESCE(sa.override_time_start, sh.time_start)::text AS time_start,
       COALESCE(sa.override_time_end, sh.time_end)::text AS time_end,
       e.key AS employee_key, e.name AS employee_name
FROM shift_assignments sa
INNER JOIN shifts sh ON sh.id = sa.shift_id
INNER JOIN employees e ON e.id = sa.employee_id
`

export type CopilotSlimWorkOrder = {
  id: string
  wo_key: string
  short_text: string
  status: string
  asset_id: string
  asset_key: string
  asset_name: string
  workgroup_id: string
  workgroup_key: string
  workgroup_name: string
  work_type_key: string
  work_type_name: string
  plan_start: string | null
  plan_end: string | null
  planned_duration: number | null
  assigned_employee_ids: string[]
}

export type CopilotShiftAssignmentSlim = {
  id: string
  shift_id: string
  assignment_date: string
  employee_id: string
  presence_status: string
  shift_key: string
  shift_name: string
  time_start: string
  time_end: string
  employee_key: string
  employee_name: string
}

export type CopilotCapacityAllocationRow = {
  work_order_id: string
  employee_id: string
  allocation_date: string
  planned_hours: number
}

export type CopilotSchedulingPolicyMeta = Pick<
  ShiftAppSettings,
  | 'shift_planning_capacity_pct'
  | 'shift_bound_projection'
  | 'apply_default_shift_plan'
>

export type CopilotSchedulingSnapshotMeta = {
  date_from: string
  date_to: string
  site_id: string
  workgroup_id: string | null
  max_range_days: number
  max_work_orders: number
  work_orders_truncated: boolean
  work_orders_returned: number
  policy: CopilotSchedulingPolicyMeta
  hint: string | null
}

export type CopilotSchedulingSnapshot = {
  work_orders: CopilotSlimWorkOrder[]
  shift_assignments: CopilotShiftAssignmentSlim[]
  capacity_allocations: CopilotCapacityAllocationRow[]
  used_hours_by_employee_date: Record<string, Record<string, number>>
  meta: CopilotSchedulingSnapshotMeta
}

export type CopilotShiftDefinitionRow = {
  id: string
  key: string
  name: string
  time_start: string
  time_end: string
  available_weekdays: number[]
}

function daysInclusiveUtc(dateFrom: string, dateTo: string): number {
  const a = Date.parse(`${dateFrom}T00:00:00Z`)
  const b = Date.parse(`${dateTo}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.floor((b - a) / 86_400_000) + 1
}

function toIso(d: unknown): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString()
  if (typeof d === 'string') return d
  return null
}

function numFromText(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export function validateCopilotSchedulingDates(args: {
  date_from: string
  date_to: string
}): { ok: true; date_from: string; date_to: string } | { ok: false; error: string } {
  const dateFrom = args.date_from?.trim() ?? ''
  const dateTo = args.date_to?.trim() ?? ''
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    return {
      ok: false,
      error: `date_from and date_to must be valid calendar dates in YYYY-MM-DD form after normalization (got date_from=${JSON.stringify(dateFrom)}, date_to=${JSON.stringify(dateTo)}).`,
    }
  }
  if (dateFrom > dateTo) {
    return { ok: false, error: 'date_from must be <= date_to.' }
  }
  const days = daysInclusiveUtc(dateFrom, dateTo)
  if (!Number.isFinite(days) || days < 1) {
    return { ok: false, error: 'Invalid date range.' }
  }
  if (days > COPILOT_SCHEDULING_MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Date range too large (${days} days). Maximum is ${COPILOT_SCHEDULING_MAX_RANGE_DAYS} days inclusive; narrow date_from / date_to.`,
    }
  }
  return { ok: true, date_from: dateFrom, date_to: dateTo }
}

export function parseOptionalWorkgroupId(
  raw: unknown,
): { ok: true; workgroup_id: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, workgroup_id: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'workgroup_id must be a string UUID or omitted.' }
  }
  const s = raw.trim()
  if (!s) return { ok: true, workgroup_id: null }
  if (!UUID_RE.test(s)) {
    return { ok: false, error: 'workgroup_id must be a valid UUID when provided.' }
  }
  return { ok: true, workgroup_id: s }
}

async function assertWorkgroupOnSite(
  pool: Pool,
  workgroupId: string,
  siteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM workgroups WHERE id = $1::uuid AND site_id = $2::uuid`,
    [workgroupId, siteId],
  )
  if (!r.rows[0]) {
    return {
      ok: false,
      error: 'workgroup_id not found on this working site.',
    }
  }
  return { ok: true }
}

/**
 * Read-only scheduling snapshot for Kira: always scoped to `siteId` (working site),
 * same overlap rules as GET /api/capacity-planner/snapshot.
 */
export async function fetchCopilotSchedulingSnapshot(args: {
  pool: Pool
  siteId: string
  dateFrom: string
  dateTo: string
  workgroupId: string | null
  maxWorkOrders?: number
}): Promise<CopilotSchedulingSnapshot> {
  const maxWo = Math.min(
    Math.max(args.maxWorkOrders ?? COPILOT_SCHEDULING_DEFAULT_MAX_WOS, 1),
    500,
  )
  const policyFull = await getShiftAppSettings(args.pool)
  const policy: CopilotSchedulingPolicyMeta = {
    shift_planning_capacity_pct: policyFull.shift_planning_capacity_pct,
    shift_bound_projection: policyFull.shift_bound_projection,
    apply_default_shift_plan: policyFull.apply_default_shift_plan,
  }

  if (args.workgroupId) {
    const wgOk = await assertWorkgroupOnSite(
      args.pool,
      args.workgroupId,
      args.siteId,
    )
    if (!wgOk.ok) {
      throw new Error(wgOk.error)
    }
  }

  const woParams: unknown[] = [args.dateFrom, args.dateTo, args.siteId]
  let woFilter = `WHERE ${WO_OVERLAP_SQL} AND w.site_id = $3::uuid`
  if (args.workgroupId) {
    woFilter += ` AND w.workgroup_id = $4::uuid`
    woParams.push(args.workgroupId)
  }
  woParams.push(maxWo + 1)

  const woSql = `${COPILOT_WO_SLIM_SQL}
     ${woFilter}
     ORDER BY w.wo_key DESC
     LIMIT $${woParams.length}::int`

  const woR = await args.pool.query<{
    id: string
    wo_key: string
    short_text: string
    status: string
    asset_id: string
    asset_key: string
    asset_name: string
    workgroup_id: string
    workgroup_key: string
    workgroup_name: string
    work_type_key: string
    work_type_name: string
    plan_start: Date | string | null
    plan_end: Date | string | null
    planned_duration_text: string | null
    assigned_employee_ids: string[] | null
  }>(woSql, woParams)

  const truncated = woR.rows.length > maxWo
  const woRows = truncated ? woR.rows.slice(0, maxWo) : woR.rows

  const work_orders: CopilotSlimWorkOrder[] = woRows.map((row) => ({
    id: row.id,
    wo_key: String(row.wo_key),
    short_text: row.short_text,
    status: row.status,
    asset_id: row.asset_id,
    asset_key: row.asset_key,
    asset_name: row.asset_name,
    workgroup_id: row.workgroup_id,
    workgroup_key: row.workgroup_key,
    workgroup_name: row.workgroup_name,
    work_type_key: row.work_type_key,
    work_type_name: row.work_type_name,
    plan_start: toIso(row.plan_start),
    plan_end: toIso(row.plan_end),
    planned_duration: numFromText(row.planned_duration_text),
    assigned_employee_ids: Array.isArray(row.assigned_employee_ids)
      ? row.assigned_employee_ids
      : [],
  }))

  const saParams: unknown[] = [args.dateFrom, args.dateTo, args.siteId]
  let saFilter =
    'WHERE sa.assignment_date >= $1::date AND sa.assignment_date <= $2::date AND sh.site_id = $3::uuid'
  if (args.workgroupId) {
    saFilter += ` AND EXISTS (
      SELECT 1 FROM workgroup_employees we
      WHERE we.employee_id = sa.employee_id
        AND we.workgroup_id = $4::uuid
    )`
    saParams.push(args.workgroupId)
  }

  const saR = await args.pool.query<CopilotShiftAssignmentSlim>(
    `${SHIFT_ASSIGNMENTS_SLIM_SQL}
     ${saFilter}
     ORDER BY sa.assignment_date ASC, sh.key ASC, e.name ASC`,
    saParams,
  )

  const allocParams: unknown[] = [args.dateFrom, args.dateTo, args.siteId]
  let allocFilter = `WHERE woca.allocation_date >= $1::date
       AND woca.allocation_date <= $2::date
       AND w.site_id = $3::uuid`
  if (args.workgroupId) {
    allocFilter += ` AND w.workgroup_id = $4::uuid`
    allocParams.push(args.workgroupId)
  }

  const allocR = await args.pool.query<{
    work_order_id: string
    employee_id: string
    allocation_date: string
    planned_hours: string
  }>(
    `SELECT woca.work_order_id::text AS work_order_id,
            woca.employee_id::text AS employee_id,
            woca.allocation_date::text AS allocation_date,
            woca.planned_hours::text AS planned_hours
     FROM work_order_capacity_allocations woca
     INNER JOIN work_orders w ON w.id = woca.work_order_id
     ${allocFilter}`,
    allocParams,
  )

  const capacity_allocations: CopilotCapacityAllocationRow[] =
    allocR.rows.map((r) => ({
      work_order_id: r.work_order_id,
      employee_id: r.employee_id,
      allocation_date: r.allocation_date,
      planned_hours: Number(r.planned_hours),
    }))

  const used_hours_by_employee_date: Record<string, Record<string, number>> = {}
  for (const row of capacity_allocations) {
    const h = row.planned_hours
    if (!Number.isFinite(h)) continue
    if (!used_hours_by_employee_date[row.employee_id]) {
      used_hours_by_employee_date[row.employee_id] = {}
    }
    const byDate = used_hours_by_employee_date[row.employee_id]!
    byDate[row.allocation_date] = (byDate[row.allocation_date] ?? 0) + h
  }

  let hint: string | null = null
  if (truncated) {
    hint = `Work order list truncated to ${maxWo} rows (newest by wo_key). Narrow date_from/date_to or pass workgroup_id.`
  }

  const meta: CopilotSchedulingSnapshotMeta = {
    date_from: args.dateFrom,
    date_to: args.dateTo,
    site_id: args.siteId,
    workgroup_id: args.workgroupId,
    max_range_days: COPILOT_SCHEDULING_MAX_RANGE_DAYS,
    max_work_orders: maxWo,
    work_orders_truncated: truncated,
    work_orders_returned: work_orders.length,
    policy,
    hint,
  }

  return {
    work_orders,
    shift_assignments: saR.rows,
    capacity_allocations,
    used_hours_by_employee_date,
    meta,
  }
}

/** Shift definitions for the working site (template rows, not dated assignments). */
export async function listShiftDefinitionsForSite(
  pool: Pool,
  siteId: string,
): Promise<CopilotShiftDefinitionRow[]> {
  const r = await pool.query<{
    id: string
    key: string
    name: string
    time_start: string
    time_end: string
    available_weekdays: number[]
  }>(
    `SELECT id, key, name,
            time_start::text AS time_start,
            time_end::text AS time_end,
            available_weekdays
     FROM shifts
     WHERE site_id = $1::uuid
     ORDER BY key ASC`,
    [siteId],
  )
  return r.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    time_start: row.time_start,
    time_end: row.time_end,
    available_weekdays: Array.isArray(row.available_weekdays)
      ? row.available_weekdays
      : [],
  }))
}
