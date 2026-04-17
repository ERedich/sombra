import { isKiraUuid } from '@sombra/shared'
import type { Pool } from 'pg'
import type { AiRefItem, AiSuggestContext } from './suggestTypes.js'

function rowToRef(r: { id: string; key: string; name: string }): AiRefItem {
  return { id: r.id, key: r.key, name: r.name }
}

/** Load site-scoped reference lists for AI suggest tools (server-side; no huge client payloads). */
export async function loadAiSuggestContextForSite(
  pool: Pool,
  siteId: string,
): Promise<AiSuggestContext> {
  const [
    assets,
    work_types,
    workgroups,
    categories,
    costcenters,
    asset_classifications,
  ] = await Promise.all([
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM assets WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM work_types WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM workgroups WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM categories WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM costcenters WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM asset_classifications WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
  ])

  return {
    assets: assets.rows.map(rowToRef),
    work_types: work_types.rows.map(rowToRef),
    workgroups: workgroups.rows.map(rowToRef),
    categories: categories.rows.map(rowToRef),
    costcenters: costcenters.rows.map(rowToRef),
    asset_classifications: asset_classifications.rows.map(rowToRef),
  }
}

export async function searchAssetsForSite(
  pool: Pool,
  siteId: string,
  query: string,
  limit: number,
): Promise<{ id: string; key: string; name: string }[]> {
  const q = query.trim()
  if (!q) return []
  const lim = Math.min(Math.max(limit || 15, 1), 50)
  const pat = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
  const r = await pool.query<{ id: string; key: string; name: string }>(
    `SELECT id, key, name FROM assets
     WHERE site_id = $1::uuid AND (key ILIKE $2 ESCAPE '\\' OR name ILIKE $2 ESCAPE '\\')
     ORDER BY name
     LIMIT $3`,
    [siteId, pat, lim],
  )
  return r.rows
}

export type CopilotAssetDetailsRow = {
  id: string
  key: string
  name: string
  asset_type: string
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  created_by_display_name: string | null
  created_by_login_name: string | null
  updated_by: string | null
  updated_by_display_name: string | null
  updated_by_login_name: string | null
}

/**
 * Load one asset on the working site with audit columns and creator/updater names.
 * Returns null if id invalid, not a UUID, or asset not on site.
 */
export async function getAssetDetailsForSite(
  pool: Pool,
  siteId: string,
  assetId: string,
): Promise<CopilotAssetDetailsRow | null> {
  const id = assetId.trim()
  if (!id || !isKiraUuid(id)) return null
  const r = await pool.query<{
    id: string
    key: string
    name: string
    asset_type: string
    created_at: Date | null
    updated_at: Date | null
    created_by: string | null
    created_by_display_name: string | null
    created_by_login_name: string | null
    updated_by: string | null
    updated_by_display_name: string | null
    updated_by_login_name: string | null
  }>(
    `SELECT
       a.id,
       a.key,
       a.name,
       a.asset_type,
       a.created_at,
       a.updated_at,
       a.created_by,
       uc.name AS created_by_display_name,
       uc.login_name AS created_by_login_name,
       a.updated_by,
       uu.name AS updated_by_display_name,
       uu.login_name AS updated_by_login_name
     FROM assets a
     LEFT JOIN users uc ON uc.id = a.created_by
     LEFT JOIN users uu ON uu.id = a.updated_by
     WHERE a.site_id = $1::uuid AND a.id = $2::uuid`,
    [siteId, id],
  )
  const row = r.rows[0]
  if (!row) return null
  const iso = (d: Date | null) =>
    d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    asset_type: row.asset_type,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    created_by: row.created_by,
    created_by_display_name: row.created_by_display_name,
    created_by_login_name: row.created_by_login_name,
    updated_by: row.updated_by,
    updated_by_display_name: row.updated_by_display_name,
    updated_by_login_name: row.updated_by_login_name,
  }
}

export type CopilotUserEmployeeOnSite = {
  id: string
  key: string
  name: string
  site_id: string
  on_working_site: boolean
}

/**
 * The `employees` row linked to this user via `users.employee_id`, if any.
 * `on_working_site` is true only when that employee's site_id matches the current working site.
 * Returns null if the user has no employee_id or the employee row no longer exists.
 */
export async function loadUserEmployeeOnSite(
  pool: Pool,
  userId: string,
  siteId: string,
): Promise<CopilotUserEmployeeOnSite | null> {
  const r = await pool.query<{
    id: string
    key: string
    name: string
    site_id: string
  }>(
    `SELECT e.id::text AS id, e.key, e.name, e.site_id::text AS site_id
     FROM users u
     INNER JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1::uuid AND u.employee_id IS NOT NULL
     LIMIT 1`,
    [userId],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    site_id: row.site_id,
    on_working_site: row.site_id === siteId,
  }
}

export type UserWorkgroupOnSite = { id: string; key: string; name: string }

/**
 * Workgroups on the working site where the user's linked employee is a member.
 * Empty if the user has no employee_id or no matching rows on this site.
 */
export async function loadUserWorkgroupsOnSite(
  pool: Pool,
  userId: string,
  siteId: string,
): Promise<UserWorkgroupOnSite[]> {
  const r = await pool.query<{ id: string; key: string; name: string }>(
    `SELECT wg.id::text AS id, wg.key, wg.name
     FROM users u
     INNER JOIN workgroup_employees we ON we.employee_id = u.employee_id
     INNER JOIN workgroups wg
       ON wg.id = we.workgroup_id AND wg.site_id = $2::uuid
     WHERE u.id = $1::uuid AND u.employee_id IS NOT NULL
     ORDER BY wg.name ASC, wg.key ASC`,
    [userId, siteId],
  )
  return r.rows
}

/** Current working site row (sites table) for Kira / copilot context. */
export type CopilotWorkingSiteRow = {
  id: string
  key: string
  name: string
  colour: string
  is_plant: boolean
}

/**
 * Load the maintenance site that matches the user's working_site_id (same id passed as siteId to tools).
 */
export async function getWorkingSiteDetailsForCopilot(
  pool: Pool,
  siteId: string,
): Promise<CopilotWorkingSiteRow | null> {
  const r = await pool.query<{
    id: string
    key: string
    name: string
    colour: string
    is_plant: boolean
  }>(
    `SELECT id, key, name, colour, COALESCE(is_plant, false) AS is_plant
     FROM sites WHERE id = $1::uuid`,
    [siteId],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    colour: row.colour,
    is_plant: row.is_plant,
  }
}

/** Row counts for the working site (same scope as Kira tools / WO create). */
export async function getSiteReferenceCounts(
  pool: Pool,
  siteId: string,
): Promise<{
  assets: number
  work_types: number
  workgroups: number
  categories: number
  costcenters: number
  asset_classifications: number
}> {
  const r = await pool.query<{
    assets: string
    work_types: string
    workgroups: string
    categories: string
    costcenters: string
    asset_classifications: string
  }>(
    `SELECT
       (SELECT COUNT(*)::bigint FROM assets WHERE site_id = $1::uuid) AS assets,
       (SELECT COUNT(*)::bigint FROM work_types WHERE site_id = $1::uuid) AS work_types,
       (SELECT COUNT(*)::bigint FROM workgroups WHERE site_id = $1::uuid) AS workgroups,
       (SELECT COUNT(*)::bigint FROM categories WHERE site_id = $1::uuid) AS categories,
       (SELECT COUNT(*)::bigint FROM costcenters WHERE site_id = $1::uuid) AS costcenters,
       (SELECT COUNT(*)::bigint FROM asset_classifications WHERE site_id = $1::uuid) AS asset_classifications`,
    [siteId],
  )
  const row = r.rows[0]
  const n = (v: string | undefined) => Number(v ?? 0)
  return {
    assets: n(row?.assets),
    work_types: n(row?.work_types),
    workgroups: n(row?.workgroups),
    categories: n(row?.categories),
    costcenters: n(row?.costcenters),
    asset_classifications: n(row?.asset_classifications),
  }
}

export type CopilotWorkOrderBriefRow = {
  id: string
  wo_key: number
  short_text: string
  status: string
  asset_id: string
  asset_key: string
  asset_name: string
  work_type_key: string
  workgroup_id: string
  workgroup_key: string
  work_plan_id: string | null
  work_plan_key: string | null
  plan_start: string | null
  plan_end: string | null
  planned_duration_hours: string
}

const WO_BRIEF_SELECT = `
  SELECT w.id::text AS id, w.wo_key, w.short_text, w.status,
         w.asset_id::text AS asset_id, a.key AS asset_key, a.name AS asset_name,
         wt.key AS work_type_key,
         w.workgroup_id::text AS workgroup_id, wg.key AS workgroup_key,
         w.work_plan_id::text AS work_plan_id, w.work_plan_key,
         w.plan_start, w.plan_end,
         w.planned_duration::text AS planned_duration_hours
    FROM work_orders w
    INNER JOIN assets a ON a.id = w.asset_id
    INNER JOIN work_types wt ON wt.id = w.work_type_id
    INNER JOIN workgroups wg ON wg.id = w.workgroup_id
`

type WoBriefDbRow = {
  id: string
  wo_key: number
  short_text: string
  status: string
  asset_id: string
  asset_key: string
  asset_name: string
  work_type_key: string
  workgroup_id: string
  workgroup_key: string
  work_plan_id: string | null
  work_plan_key: string | null
  plan_start: Date | null
  plan_end: Date | null
  planned_duration_hours: string
}

function woBriefRowToOut(row: WoBriefDbRow): CopilotWorkOrderBriefRow {
  return {
    id: row.id,
    wo_key: row.wo_key,
    short_text: row.short_text,
    status: row.status,
    asset_id: row.asset_id,
    asset_key: row.asset_key,
    asset_name: row.asset_name,
    work_type_key: row.work_type_key,
    workgroup_id: row.workgroup_id,
    workgroup_key: row.workgroup_key,
    work_plan_id: row.work_plan_id,
    work_plan_key: row.work_plan_key,
    plan_start: toIso(row.plan_start),
    plan_end: toIso(row.plan_end),
    planned_duration_hours: row.planned_duration_hours,
  }
}

export async function listOpenWorkOrdersBrief(
  pool: Pool,
  siteId: string,
  limit: number,
): Promise<CopilotWorkOrderBriefRow[]> {
  const lim = Math.min(Math.max(limit || 15, 1), 50)
  const r = await pool.query<WoBriefDbRow>(
    `${WO_BRIEF_SELECT}
     WHERE w.site_id = $1::uuid AND w.status = 'open'
     ORDER BY w.wo_key DESC
     LIMIT $2`,
    [siteId, lim],
  )
  return r.rows.map(woBriefRowToOut)
}

const WO_STATUSES = [
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
  'done',
  'closed',
] as const
export type CopilotWorkOrderStatus = (typeof WO_STATUSES)[number]

export function isCopilotWorkOrderStatus(
  v: unknown,
): v is CopilotWorkOrderStatus {
  return (
    typeof v === 'string' &&
    (WO_STATUSES as readonly string[]).includes(v)
  )
}

/**
 * Search / filter work orders on the working site.
 * - `query` (optional): ILIKE match on wo_key (as text), short_text, asset key or name.
 * - `status` (optional): filter on one work order status.
 * - `limit`: default 20, max 50. Ordered newest first (wo_key DESC).
 */
export async function searchWorkOrdersForSite(
  pool: Pool,
  siteId: string,
  query: string,
  status: CopilotWorkOrderStatus | null,
  limit: number,
): Promise<CopilotWorkOrderBriefRow[]> {
  const lim = Math.min(Math.max(limit || 20, 1), 50)
  const q = query.trim()
  const pat = q ? `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%` : null
  const r = await pool.query<WoBriefDbRow>(
    `${WO_BRIEF_SELECT}
     WHERE w.site_id = $1::uuid
       AND ( $2::text IS NULL
         OR w.wo_key::text ILIKE $2 ESCAPE '\\'
         OR w.short_text ILIKE $2 ESCAPE '\\'
         OR a.key ILIKE $2 ESCAPE '\\'
         OR a.name ILIKE $2 ESCAPE '\\' )
       AND ( $3::text IS NULL OR w.status = $3 )
     ORDER BY w.wo_key DESC
     LIMIT $4`,
    [siteId, pat, status, lim],
  )
  return r.rows.map(woBriefRowToOut)
}

export type CopilotWorkOrderDetail = {
  id: string
  wo_key: number
  short_text: string
  instruction_text: string
  status: string
  hold_reason: string | null
  asset_id: string
  asset_key: string
  asset_name: string
  work_type_id: string
  work_type_key: string
  work_type_name: string
  workgroup_id: string
  workgroup_key: string
  workgroup_name: string
  category_id: string | null
  category_key: string | null
  category_name: string | null
  costcenter_id: string | null
  costcenter_key: string | null
  costcenter_name: string | null
  work_plan_id: string | null
  work_plan_key: string | null
  plan_start: string | null
  plan_end: string | null
  planned_duration_hours: string
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  created_by_login_name: string | null
  created_by_display_name: string | null
  updated_by: string | null
  updated_by_login_name: string | null
  updated_by_display_name: string | null
  assigned_employees: {
    id: string
    key: string
    name: string
  }[]
  work_instructions: {
    sort_nr: number
    instruction_text: string
    done: boolean
  }[]
}

/**
 * Load one work order on the working site, by id (UUID) or numeric wo_key.
 * Returns null if not found on this site.
 */
export async function getWorkOrderDetailsForSite(
  pool: Pool,
  siteId: string,
  ident: { id?: string | null; wo_key?: number | null },
): Promise<CopilotWorkOrderDetail | null> {
  const id =
    typeof ident.id === 'string' && ident.id.trim() && isKiraUuid(ident.id.trim())
      ? ident.id.trim()
      : null
  const woKey =
    typeof ident.wo_key === 'number' && Number.isFinite(ident.wo_key)
      ? Math.trunc(ident.wo_key)
      : null
  if (!id && (woKey === null || woKey <= 0)) return null

  const head = await pool.query<{
    id: string
    wo_key: number
    short_text: string
    instruction_text: string
    status: string
    hold_reason: string | null
    asset_id: string
    asset_key: string
    asset_name: string
    work_type_id: string
    work_type_key: string
    work_type_name: string
    workgroup_id: string
    workgroup_key: string
    workgroup_name: string
    category_id: string | null
    category_key: string | null
    category_name: string | null
    costcenter_id: string | null
    costcenter_key: string | null
    costcenter_name: string | null
    work_plan_id: string | null
    work_plan_key: string | null
    plan_start: Date | null
    plan_end: Date | null
    planned_duration_hours: string
    created_at: Date | null
    updated_at: Date | null
    created_by: string | null
    created_by_login_name: string | null
    created_by_display_name: string | null
    updated_by: string | null
    updated_by_login_name: string | null
    updated_by_display_name: string | null
  }>(
    `SELECT w.id::text AS id, w.wo_key, w.short_text, w.instruction_text,
            w.status, w.hold_reason,
            w.asset_id::text AS asset_id, a.key AS asset_key, a.name AS asset_name,
            w.work_type_id::text AS work_type_id,
            wt.key AS work_type_key, wt.name AS work_type_name,
            w.workgroup_id::text AS workgroup_id,
            wg.key AS workgroup_key, wg.name AS workgroup_name,
            w.category_id::text AS category_id,
            cat.key AS category_key, cat.name AS category_name,
            w.costcenter_id::text AS costcenter_id,
            cc.key AS costcenter_key, cc.name AS costcenter_name,
            w.work_plan_id::text AS work_plan_id, w.work_plan_key,
            w.plan_start, w.plan_end,
            w.planned_duration::text AS planned_duration_hours,
            w.created_at, w.updated_at,
            w.created_by::text AS created_by,
            uc.login_name AS created_by_login_name,
            uc.name AS created_by_display_name,
            w.updated_by::text AS updated_by,
            uu.login_name AS updated_by_login_name,
            uu.name AS updated_by_display_name
       FROM work_orders w
       INNER JOIN assets a ON a.id = w.asset_id
       INNER JOIN work_types wt ON wt.id = w.work_type_id
       INNER JOIN workgroups wg ON wg.id = w.workgroup_id
       LEFT JOIN categories cat ON cat.id = w.category_id
       LEFT JOIN costcenters cc ON cc.id = w.costcenter_id
       LEFT JOIN users uc ON uc.id = w.created_by
       LEFT JOIN users uu ON uu.id = w.updated_by
      WHERE w.site_id = $1::uuid
        AND ( ($2::uuid IS NOT NULL AND w.id = $2::uuid)
              OR ($3::int IS NOT NULL AND w.wo_key = $3::int) )
      LIMIT 1`,
    [siteId, id, woKey],
  )
  const h = head.rows[0]
  if (!h) return null

  const [emps, wins] = await Promise.all([
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT e.id::text AS id, e.key, e.name
         FROM work_order_employees woe
         INNER JOIN employees e ON e.id = woe.employee_id
        WHERE woe.work_order_id = $1::uuid
        ORDER BY e.name ASC, e.key ASC`,
      [h.id],
    ),
    pool.query<{
      sort_nr: number
      instruction_text: string
      done: boolean
    }>(
      `SELECT sort_nr, instruction_text, done
         FROM work_instructions
        WHERE work_order_id = $1::uuid
        ORDER BY sort_nr ASC, id ASC
        LIMIT 120`,
      [h.id],
    ),
  ])

  return {
    id: h.id,
    wo_key: h.wo_key,
    short_text: h.short_text,
    instruction_text: h.instruction_text,
    status: h.status,
    hold_reason: h.hold_reason,
    asset_id: h.asset_id,
    asset_key: h.asset_key,
    asset_name: h.asset_name,
    work_type_id: h.work_type_id,
    work_type_key: h.work_type_key,
    work_type_name: h.work_type_name,
    workgroup_id: h.workgroup_id,
    workgroup_key: h.workgroup_key,
    workgroup_name: h.workgroup_name,
    category_id: h.category_id,
    category_key: h.category_key,
    category_name: h.category_name,
    costcenter_id: h.costcenter_id,
    costcenter_key: h.costcenter_key,
    costcenter_name: h.costcenter_name,
    work_plan_id: h.work_plan_id,
    work_plan_key: h.work_plan_key,
    plan_start: toIso(h.plan_start),
    plan_end: toIso(h.plan_end),
    planned_duration_hours: h.planned_duration_hours,
    created_at: toIso(h.created_at),
    updated_at: toIso(h.updated_at),
    created_by: h.created_by,
    created_by_login_name: h.created_by_login_name,
    created_by_display_name: h.created_by_display_name,
    updated_by: h.updated_by,
    updated_by_login_name: h.updated_by_login_name,
    updated_by_display_name: h.updated_by_display_name,
    assigned_employees: emps.rows,
    work_instructions: wins.rows,
  }
}

export type CopilotWorkTypeRow = {
  id: string
  key: string
  name: string
  colour: string
}

/** Work order types (PM/CM/BD, etc.) on the working site. */
export async function listWorkTypesForSite(
  pool: Pool,
  siteId: string,
): Promise<CopilotWorkTypeRow[]> {
  const r = await pool.query<CopilotWorkTypeRow>(
    `SELECT id::text, key, name, colour
     FROM work_types
     WHERE site_id = $1::uuid
     ORDER BY key ASC`,
    [siteId],
  )
  return r.rows
}

export type CopilotWorkPlanBriefRow = {
  id: string
  plan_key: string
  short_text: string
  asset_id: string
  asset_key: string
  asset_name: string
  interval_count: number
  interval_time_type: string
  next_due_at: string | null
  planned_duration_hours: string
  lead_time_days: number
  category_key: string | null
  category_name: string | null
  work_instruction_count: number
}

function toIso(d: Date | null): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Work plans (maintenance plans / WP) on the working site.
 * Optional query matches plan_key, short_text, asset key or name (ILIKE).
 */
export async function searchWorkPlansForSite(
  pool: Pool,
  siteId: string,
  query: string,
  limit: number,
): Promise<CopilotWorkPlanBriefRow[]> {
  const lim = Math.min(Math.max(limit || 20, 1), 50)
  const q = query.trim()
  const pat = q ? `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%` : null
  const r = await pool.query<{
    id: string
    plan_key: string
    short_text: string
    asset_id: string
    asset_key: string
    asset_name: string
    interval_count: number
    interval_time_type: string
    next_due_at: Date
    planned_duration_hours: string
    lead_time_days: number
    category_key: string | null
    category_name: string | null
    work_instruction_count: number
  }>(
    `SELECT p.id::text, p.plan_key, p.short_text, p.asset_id::text,
            a.key AS asset_key, a.name AS asset_name,
            p.interval_count, p.interval_time_type, p.next_due_at,
            p.planned_duration::text AS planned_duration_hours,
            p.lead_time_days,
            cat.key AS category_key, cat.name AS category_name,
            (SELECT COUNT(*)::int FROM work_instructions wi
             WHERE wi.work_plan_id = p.id) AS work_instruction_count
     FROM work_plans p
     INNER JOIN assets a ON a.id = p.asset_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE p.site_id = $1::uuid
       AND (
         $2::text IS NULL
         OR p.plan_key ILIKE $2 ESCAPE '\\'
         OR p.short_text ILIKE $2 ESCAPE '\\'
         OR a.key ILIKE $2 ESCAPE '\\'
         OR a.name ILIKE $2 ESCAPE '\\'
       )
     ORDER BY p.next_due_at ASC NULLS LAST, p.plan_key ASC
     LIMIT $3`,
    [siteId, pat, lim],
  )
  return r.rows.map((row) => ({
    id: row.id,
    plan_key: row.plan_key,
    short_text: row.short_text,
    asset_id: row.asset_id,
    asset_key: row.asset_key,
    asset_name: row.asset_name,
    interval_count: row.interval_count,
    interval_time_type: row.interval_time_type,
    next_due_at: toIso(row.next_due_at),
    planned_duration_hours: row.planned_duration_hours,
    lead_time_days: row.lead_time_days,
    category_key: row.category_key,
    category_name: row.category_name,
    work_instruction_count: row.work_instruction_count,
  }))
}

export type CopilotWorkPlanDetail = {
  id: string
  plan_key: string
  short_text: string
  instruction_text: string
  asset_id: string
  asset_key: string
  asset_name: string
  interval_count: number
  interval_time_type: string
  next_due_at: string | null
  due_date: string | null
  planned_duration_hours: string
  lead_time_days: number
  category_key: string | null
  category_name: string | null
  created_at: string | null
  updated_at: string | null
  work_instructions: {
    sort_nr: number
    instruction_text: string
    done: boolean
  }[]
}

export async function getWorkPlanDetailsForSite(
  pool: Pool,
  siteId: string,
  workPlanId: string,
): Promise<CopilotWorkPlanDetail | null> {
  const id = workPlanId.trim()
  if (!id || !isKiraUuid(id)) return null
  const head = await pool.query<{
    id: string
    plan_key: string
    short_text: string
    instruction_text: string
    asset_id: string
    asset_key: string
    asset_name: string
    interval_count: number
    interval_time_type: string
    next_due_at: Date
    due_date: Date
    planned_duration_hours: string
    lead_time_days: number
    category_key: string | null
    category_name: string | null
    created_at: Date
    updated_at: Date
  }>(
    `SELECT p.id::text, p.plan_key, p.short_text, p.instruction_text,
            p.asset_id::text, a.key AS asset_key, a.name AS asset_name,
            p.interval_count, p.interval_time_type, p.next_due_at, p.due_date,
            p.planned_duration::text AS planned_duration_hours,
            p.lead_time_days,
            cat.key AS category_key, cat.name AS category_name,
            p.created_at, p.updated_at
     FROM work_plans p
     INNER JOIN assets a ON a.id = p.asset_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE p.site_id = $1::uuid AND p.id = $2::uuid`,
    [siteId, id],
  )
  const h = head.rows[0]
  if (!h) return null
  const wi = await pool.query<{
    sort_nr: number
    instruction_text: string
    done: boolean
  }>(
    `SELECT sort_nr, instruction_text, done
     FROM work_instructions
     WHERE work_plan_id = $1::uuid
     ORDER BY sort_nr ASC, id ASC
     LIMIT 80`,
    [id],
  )
  return {
    id: h.id,
    plan_key: h.plan_key,
    short_text: h.short_text,
    instruction_text: h.instruction_text,
    asset_id: h.asset_id,
    asset_key: h.asset_key,
    asset_name: h.asset_name,
    interval_count: h.interval_count,
    interval_time_type: h.interval_time_type,
    next_due_at: toIso(h.next_due_at),
    due_date: toIso(h.due_date),
    planned_duration_hours: h.planned_duration_hours,
    lead_time_days: h.lead_time_days,
    category_key: h.category_key,
    category_name: h.category_name,
    created_at: toIso(h.created_at),
    updated_at: toIso(h.updated_at),
    work_instructions: wi.rows,
  }
}
