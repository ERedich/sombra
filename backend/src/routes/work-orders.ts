import { Router } from 'express'
import type { Response } from 'express'
import type { Pool, PoolClient } from 'pg'
import type { AuthUser } from '../middleware/auth.js'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import {
  broadcastWorkOrderCreated,
  broadcastWorkOrderDeleted,
  broadcastWorkOrderNotifications,
  broadcastWorkOrderUpdated,
} from '../realtime/workOrderSocket.js'
import { requireAuth } from '../middleware/auth.js'
import {
  fieldChanges,
  redactForAudit,
  serializeRowForAudit,
  writeAudit,
} from '../audit/auditLog.js'
import { planEndFromStartAndDurationHours } from '../services/intervalUtc.js'
import {
  getWoStartRequiresAssignment,
  getWoUserAutoAssignOnStart,
} from '../services/appSettings.js'
import {
  buildWorkOrderEmployeeAssignedNotifications,
  buildWorkOrderEmployeeDeassignedNotifications,
  buildWorkInstructionCreatedNotification,
  buildWorkInstructionDeletedNotification,
  buildWorkInstructionUpdatedNotifications,
  buildWorkOrderFieldChangeNotifications,
  buildWorkOrderPutOnHoldNotification,
  buildWorkOrderStartedNotification,
  createNotificationsForSubscribers,
} from '../notifications/workOrderNotifications.js'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WorkOrderTableRow = {
  id: string
  site_id: string
  wo_key: number
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  plan_start: Date | null
  plan_end: Date | null
  worktime: string
  work_type_id: string
  status: string
  work_plan_id: string | null
  work_plan_key: string | null
  duration: string
  category_id: string | null
  workgroup_id: string
  hold_reason: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type WorkOrderRow = WorkOrderTableRow & {
  site_key: string
  site_name: string
  site_colour: string
  asset_key: string
  asset_name: string
  costcenter_key: string | null
  costcenter_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
  work_plan_interval_count: number | null
  work_plan_interval_time_type: string | null
  work_plan_next_due_at: Date | null
  work_type_key: string
  work_type_name: string
  work_type_colour: string
  category_key: string | null
  category_name: string | null
  workgroup_key: string
  workgroup_name: string
  has_material_assignment: boolean
  has_employee_assignment: boolean
  assigned_employee_ids: string[]
  work_instruction_count: number
  work_instruction_done_count: number
}

type WorkOrderEmployeeRow = {
  employee_id: string
  employee_key: string
  employee_name: string
}

type EmployeeSiteRow = {
  id: string
  site_id: string
  key: string
  name: string
}

function workingSiteIdOr403(res: Response, auth: AuthUser): string | null {
  const wid = auth.working_site_id
  if (!wid || !UUID_RE.test(wid)) {
    res.status(403).json({
      error:
        'No working site is set. Sign out and sign in again, or pick a site at login.',
    })
    return null
  }
  return wid
}

function rowToAuditRecord(row: WorkOrderTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

async function fetchWorkOrderWithJoins(
  client: PoolClient,
  id: string,
): Promise<WorkOrderRow | undefined> {
  const r = await client.query<WorkOrderRow>(
    `${LIST_SQL} WHERE w.id = $1`,
    [id],
  )
  return r.rows[0]
}

const LIST_SQL = `
SELECT w.id, w.site_id, w.wo_key, w.short_text, w.asset_id, w.costcenter_id,
       w.instruction_text, w.plan_start, w.plan_end, w.worktime, w.work_type_id, w.status,
       w.hold_reason,
       w.work_plan_id, w.work_plan_key, w.duration, w.workgroup_id,
       w.created_at, w.updated_at, w.created_by, w.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       a.key AS asset_key, a.name AS asset_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name,
       wp.interval_count AS work_plan_interval_count,
       wp.interval_time_type AS work_plan_interval_time_type,
       wp.next_due_at AS work_plan_next_due_at,
       wt.key AS work_type_key, wt.name AS work_type_name, wt.colour AS work_type_colour,
       cat.key AS category_key, cat.name AS category_name,
       wg.key AS workgroup_key, wg.name AS workgroup_name,
       false AS has_material_assignment,
       EXISTS(
         SELECT 1
         FROM work_order_employees woe
         WHERE woe.work_order_id = w.id
       ) AS has_employee_assignment,
       COALESCE(
         (
           SELECT array_agg(woe.employee_id::text ORDER BY woe.employee_id::text)
           FROM work_order_employees woe
           WHERE woe.work_order_id = w.id
         ),
         ARRAY[]::text[]
       ) AS assigned_employee_ids,
       (SELECT COUNT(*)::int FROM work_instructions wi WHERE wi.work_order_id = w.id)
         AS work_instruction_count,
       (SELECT COUNT(*)::int FROM work_instructions wi
         WHERE wi.work_order_id = w.id AND wi.done = true)
         AS work_instruction_done_count
FROM work_orders w
INNER JOIN sites st ON st.id = w.site_id
INNER JOIN assets a ON a.id = w.asset_id
INNER JOIN work_types wt ON wt.id = w.work_type_id
INNER JOIN workgroups wg ON wg.id = w.workgroup_id
LEFT JOIN categories cat ON cat.id = w.category_id
LEFT JOIN costcenters cc ON cc.id = w.costcenter_id
LEFT JOIN users cb ON cb.id = w.created_by
LEFT JOIN users ub ON ub.id = w.updated_by
LEFT JOIN work_plans wp ON wp.id = w.work_plan_id
`

function parseInstructionText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { instruction_text?: unknown }).instruction_text
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function parseShortText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { short_text?: unknown }).short_text
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function parseAssetId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { asset_id?: unknown }).asset_id
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function parseWorktime(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  return (body as { worktime?: unknown }).worktime
}

const WORK_ORDER_STATUS_VALUES = [
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
  'done',
  'closed',
] as const
const WORK_ORDER_STATUSES = new Set<string>(WORK_ORDER_STATUS_VALUES)

/** Omitted field -> undefined; invalid status -> 'invalid'. */
function parseStatus(body: unknown): string | undefined | 'invalid' {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { status?: unknown }).status
  if (v === undefined) return undefined
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!WORK_ORDER_STATUSES.has(s)) {
    return 'invalid'
  }
  return s
}

async function loadUserEmployeeId(
  client: Pool | PoolClient,
  userId: string,
): Promise<string | null> {
  const r = await client.query<{ employee_id: string | null }>(
    `SELECT employee_id FROM users WHERE id = $1`,
    [userId],
  )
  return r.rows[0]?.employee_id ?? null
}

async function isEmployeeAssignedToWorkOrder(
  client: PoolClient,
  workOrderId: string,
  employeeId: string,
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM work_order_employees WHERE work_order_id = $1 AND employee_id = $2`,
    [workOrderId, employeeId],
  )
  return (r.rowCount ?? 0) > 0
}

async function isEmployeeMemberOfWorkgroup(
  client: PoolClient,
  workgroupId: string,
  employeeId: string,
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM workgroup_employees WHERE workgroup_id = $1 AND employee_id = $2`,
    [workgroupId, employeeId],
  )
  return (r.rowCount ?? 0) > 0
}

/**
 * Ensures feedback row employee is on the WO: already assigned, or SWB off and (self only, or UAA on with site/WG rules + insert).
 */
async function ensureEmployeeAllowedForFeedbackEntry(
  client: PoolClient,
  args: {
    workOrderId: string
    woSiteId: string
    woWorkgroupId: string | null
    entryEmployeeId: string
    startRequiresAssignment: boolean
    userAutoAssignOnStart: boolean
    actorEmployeeId: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    workOrderId,
    woSiteId,
    woWorkgroupId,
    entryEmployeeId,
    startRequiresAssignment,
    userAutoAssignOnStart,
    actorEmployeeId,
  } = args

  if (
    await isEmployeeAssignedToWorkOrder(
      client,
      workOrderId,
      entryEmployeeId,
    )
  ) {
    return { ok: true }
  }

  if (startRequiresAssignment) {
    return {
      ok: false,
      error:
        'Each feedback entry must use an employee assigned to this work order.',
    }
  }

  if (!userAutoAssignOnStart) {
    if (actorEmployeeId && entryEmployeeId === actorEmployeeId) {
      return { ok: true }
    }
    return {
      ok: false,
      error:
        'Each feedback entry must use an employee assigned to this work order.',
    }
  }

  const empR = await client.query<{ site_id: string }>(
    `SELECT site_id FROM employees WHERE id = $1`,
    [entryEmployeeId],
  )
  const emp = empR.rows[0]
  if (!emp || emp.site_id !== woSiteId) {
    return {
      ok: false,
      error:
        'Feedback employees must exist and belong to the same site as the work order.',
    }
  }

  const wgId =
    typeof woWorkgroupId === 'string' && UUID_RE.test(woWorkgroupId.trim())
      ? woWorkgroupId.trim()
      : null
  if (wgId !== null) {
    const inWg = await isEmployeeMemberOfWorkgroup(client, wgId, entryEmployeeId)
    if (!inWg) {
      return {
        ok: false,
        error:
          'When a workgroup is set, feedback can only reference employees in that workgroup.',
      }
    }
  }

  await client.query(
    `INSERT INTO work_order_employees (work_order_id, employee_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [workOrderId, entryEmployeeId],
  )
  return { ok: true }
}

type FeedbackEntryInput = {
  employee_id: string
  feedback_text: string
  hours: number
}

function parseFeedbackActionBody(body: unknown):
  | {
      ok: true
      entries: FeedbackEntryInput[]
      target_status: 'on_hold' | 'done' | null
      hold_reason: string | null
    }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid body.' }
  }
  const o = body as Record<string, unknown>
  const rawEntries = o.entries
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return { ok: false, error: 'entries must be a non-empty array.' }
  }
  const entries: FeedbackEntryInput[] = []
  for (const el of rawEntries) {
    if (typeof el !== 'object' || el === null) {
      return { ok: false, error: 'Each entry must be an object.' }
    }
    const e = el as Record<string, unknown>
    const eid = typeof e.employee_id === 'string' ? e.employee_id.trim() : ''
    if (!UUID_RE.test(eid)) {
      return { ok: false, error: 'Each entry needs a valid employee_id.' }
    }
    const ft = typeof e.feedback_text === 'string' ? e.feedback_text.trim() : ''
    const hRaw = e.hours
    const hours =
      typeof hRaw === 'number'
        ? hRaw
        : typeof hRaw === 'string'
          ? Number(hRaw)
          : NaN
    if (!Number.isFinite(hours) || hours < 0) {
      return { ok: false, error: 'Each entry needs a non-negative hours value.' }
    }
    if (ft === '' && hours <= 0) {
      return { ok: false, error: 'Each entry needs feedback text or hours > 0.' }
    }
    if (ft.length > 10000) {
      return { ok: false, error: 'Feedback text is too long.' }
    }
    entries.push({ employee_id: eid, feedback_text: ft, hours })
  }
  const ts = o.target_status
  let target_status: 'on_hold' | 'done' | null = null
  if (ts === undefined || ts === null || ts === '') {
    target_status = null
  } else if (ts === 'on_hold' || ts === 'done') {
    target_status = ts
  } else {
    return { ok: false, error: 'target_status must be on_hold, done, or omitted.' }
  }
  let hold_reason: string | null = null
  if (typeof o.hold_reason === 'string') {
    const hr = o.hold_reason.trim()
    hold_reason = hr === '' ? null : hr
  } else if (o.hold_reason !== undefined && o.hold_reason !== null) {
    return { ok: false, error: 'hold_reason must be a string.' }
  }
  if (target_status === 'on_hold') {
    if (!hold_reason) {
      return {
        ok: false,
        error: 'hold_reason is required when target_status is on_hold.',
      }
    }
    if (hold_reason.length > 2000) {
      return { ok: false, error: 'hold_reason is too long.' }
    }
  }
  return { ok: true, entries, target_status, hold_reason }
}

/** Omitted field → undefined; invalid → 'invalid'. */
function parseWorkTypeId(body: unknown): string | undefined | 'invalid' {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { work_type_id?: unknown }).work_type_id
  if (v === undefined) return undefined
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!UUID_RE.test(s)) return 'invalid'
  return s
}

/** Omitted field → undefined; invalid → 'invalid'. */
function parseWorkgroupId(body: unknown): string | undefined | 'invalid' {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { workgroup_id?: unknown }).workgroup_id
  if (v === undefined) return undefined
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!UUID_RE.test(s)) return 'invalid'
  return s
}

/** Omitted → undefined; null → clear; invalid UUID → 'invalid'. */
function parseCategoryId(body: unknown): string | null | undefined | 'invalid' {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { category_id?: unknown }).category_id
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!UUID_RE.test(s)) return 'invalid'
  return s
}

/** Duration in hours; omitted → undefined; invalid → undefined (caller validates). */
function parseDurationHours(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as { duration?: unknown }).duration
  if (v === undefined) return undefined
  if (v === null) return 0
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function parseOptionalInstant(
  body: unknown,
  key: 'plan_start' | 'plan_end',
): Date | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const v = (body as Record<string, unknown>)[key]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '') return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

async function resolveAssetForWrite(
  client: PoolClient,
  assetId: string,
  expectedSiteId: string,
): Promise<{ costcenter_id: string | null } | undefined> {
  const r = await client.query<{ site_id: string; costcenter_id: string | null }>(
    `SELECT site_id, costcenter_id FROM assets WHERE id = $1`,
    [assetId],
  )
  const row = r.rows[0]
  if (!row || row.site_id !== expectedSiteId) return undefined
  return { costcenter_id: row.costcenter_id }
}

async function getWorkTypeForSite(
  client: PoolClient,
  workTypeId: string,
  siteId: string,
): Promise<{ id: string; key: string } | undefined> {
  const r = await client.query<{ id: string; key: string }>(
    `SELECT id, key FROM work_types WHERE id = $1 AND site_id = $2`,
    [workTypeId, siteId],
  )
  return r.rows[0]
}

async function getWorkgroupForSite(
  client: PoolClient,
  workgroupId: string,
  siteId: string,
): Promise<{ id: string; key: string } | undefined> {
  const r = await client.query<{ id: string; key: string }>(
    `SELECT id, key FROM workgroups WHERE id = $1 AND site_id = $2`,
    [workgroupId, siteId],
  )
  return r.rows[0]
}

async function getPmWorkTypeIdForSite(
  client: PoolClient,
  siteId: string,
): Promise<string | undefined> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM work_types WHERE site_id = $1 AND key = 'PM' LIMIT 1`,
    [siteId],
  )
  return r.rows[0]?.id
}

async function categoryBelongsToSite(
  client: PoolClient,
  categoryId: string,
  siteId: string,
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM categories WHERE id = $1 AND site_id = $2`,
    [categoryId, siteId],
  )
  return r.rows.length > 0
}

async function fetchWorkOrderEmployees(
  client: Pool | PoolClient,
  workOrderId: string,
): Promise<WorkOrderEmployeeRow[]> {
  const r = await client.query<WorkOrderEmployeeRow>(
    `SELECT e.id AS employee_id, e.key AS employee_key, e.name AS employee_name
     FROM work_order_employees woe
     INNER JOIN employees e ON e.id = woe.employee_id
     WHERE woe.work_order_id = $1
     ORDER BY e.name ASC, e.key ASC`,
    [workOrderId],
  )
  return r.rows
}

export type WorkInstructionDto = {
  id: string
  sort_nr: number
  instruction_text: string
  done: boolean
}

async function fetchWorkInstructionsForWorkOrder(
  client: Pool | PoolClient,
  workOrderId: string,
): Promise<WorkInstructionDto[]> {
  const r = await client.query<WorkInstructionDto>(
    `SELECT id, sort_nr, instruction_text, done
     FROM work_instructions
     WHERE work_order_id = $1
     ORDER BY sort_nr ASC, id ASC`,
    [workOrderId],
  )
  return r.rows
}

async function fetchWorkOrderDetailForResponse(
  client: PoolClient,
  id: string,
): Promise<(WorkOrderRow & { work_instructions: WorkInstructionDto[] }) | undefined> {
  const wo = await fetchWorkOrderWithJoins(client, id)
  if (!wo) return undefined
  const work_instructions = await fetchWorkInstructionsForWorkOrder(client, id)
  return { ...wo, work_instructions }
}

async function fetchWorkOrderMetaForAccess(
  client: Pool | PoolClient,
  id: string,
): Promise<
  | {
      id: string
      site_id: string
      wo_key: number
      workgroup_id: string | null
      status: string
    }
  | undefined
> {
  const r = await client.query<{
    id: string
    site_id: string
    wo_key: number
    workgroup_id: string | null
    status: string
  }>(
    `SELECT id, site_id, wo_key, workgroup_id, status
     FROM work_orders
     WHERE id = $1`,
    [id],
  )
  return r.rows[0]
}

async function insertWorkInstructionsForOrder(
  client: PoolClient,
  workOrderId: string,
  items: { sort_nr: number; instruction_text: string }[],
): Promise<void> {
  for (const it of items) {
    await client.query(
      `INSERT INTO work_instructions (work_order_id, sort_nr, instruction_text, done)
       VALUES ($1, $2, $3, false)`,
      [workOrderId, it.sort_nr, it.instruction_text],
    )
  }
}

export function parseWorkInstructionsInput(body: unknown):
  | { ok: true; items: { sort_nr: number; instruction_text: string }[] }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: true, items: [] }
  const raw = (body as { work_instructions?: unknown }).work_instructions
  if (raw === undefined) return { ok: true, items: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'work_instructions must be an array.' }
  }
  const items: { sort_nr: number; instruction_text: string }[] = []
  for (const el of raw) {
    if (typeof el !== 'object' || el === null) {
      return { ok: false, error: 'Invalid work_instructions entry.' }
    }
    const sortNr = (el as { sort_nr?: unknown }).sort_nr
    const text = (el as { instruction_text?: unknown }).instruction_text
    if (typeof sortNr !== 'number' || !Number.isInteger(sortNr)) {
      return {
        ok: false,
        error: 'Each work instruction needs an integer sort_nr.',
      }
    }
    if (typeof text !== 'string') {
      return { ok: false, error: 'Each work instruction needs instruction_text.' }
    }
    const t = text.trim()
    if (!t) {
      return { ok: false, error: 'Instruction text cannot be empty.' }
    }
    if (t.length > 200) {
      return {
        ok: false,
        error: 'Instruction must be at most 200 characters.',
      }
    }
    items.push({ sort_nr: sortNr, instruction_text: t })
  }
  return { ok: true, items }
}

const router = Router()
router.use(requireAuth)

router.get('/subscriptions', async (req, res) => {
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  if (auth.role === 'admin') {
    const r = await pool.query<{ work_order_id: string }>(
      `SELECT work_order_id
       FROM work_order_subscriptions
       WHERE user_id = $1::uuid`,
      [auth.id],
    )
    res.json({ work_order_ids: r.rows.map((row) => row.work_order_id) })
    return
  }
  const allowed = accessibleSiteIds(scope)
  if (!allowed || allowed.length === 0) {
    res.json({ work_order_ids: [] })
    return
  }
  const r = await pool.query<{ work_order_id: string }>(
    `SELECT s.work_order_id
     FROM work_order_subscriptions s
     INNER JOIN work_orders w ON w.id = s.work_order_id
     WHERE s.user_id = $1::uuid
       AND w.site_id = ANY($2::uuid[])`,
    [auth.id, allowed],
  )
  res.json({ work_order_ids: r.rows.map((row) => row.work_order_id) })
})

router.post('/subscriptions/bulk', async (req, res) => {
  const action =
    typeof req.body?.action === 'string' ? req.body.action.trim() : ''
  if (action !== 'subscribe' && action !== 'unsubscribe') {
    res.status(400).json({ error: 'action must be subscribe or unsubscribe.' })
    return
  }
  const rawIds = Array.isArray(req.body?.work_order_ids)
    ? req.body.work_order_ids
    : []
  if (rawIds.length === 0) {
    res.status(400).json({ error: 'work_order_ids must not be empty.' })
    return
  }
  const uniqueIds = [...new Set(rawIds)]
  if (
    uniqueIds.some(
      (id) => typeof id !== 'string' || !UUID_RE.test((id as string).trim()),
    )
  ) {
    res.status(400).json({ error: 'All work_order_ids must be UUIDs.' })
    return
  }
  const ids = uniqueIds.map((id) => (id as string).trim())
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const existing = await pool.query<{ id: string; site_id: string }>(
    `SELECT id, site_id FROM work_orders WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  const allowedIds = existing.rows
    .filter((row) => canAccessSite(scope, row.site_id))
    .map((row) => row.id)
  if (allowedIds.length !== ids.length) {
    res.status(404).json({ error: 'One or more work orders were not found.' })
    return
  }
  if (action === 'subscribe') {
    const ins = await pool.query(
      `INSERT INTO work_order_subscriptions (work_order_id, user_id)
       SELECT unnest($1::uuid[]), $2::uuid
       ON CONFLICT (work_order_id, user_id) DO NOTHING`,
      [allowedIds, auth.id],
    )
    res.json({
      ok: true,
      action,
      changed_count: ins.rowCount ?? 0,
      requested_count: ids.length,
    })
    return
  }
  const del = await pool.query(
    `DELETE FROM work_order_subscriptions
     WHERE user_id = $1::uuid
       AND work_order_id = ANY($2::uuid[])`,
    [auth.id, allowedIds],
  )
  res.json({
    ok: true,
    action,
    changed_count: del.rowCount ?? 0,
    requested_count: ids.length,
  })
})

router.post('/:id/subscribe', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wo = await fetchWorkOrderMetaForAccess(pool, id)
  if (!wo || !canAccessSite(scope, wo.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  await pool.query(
    `INSERT INTO work_order_subscriptions (work_order_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (work_order_id, user_id) DO NOTHING`,
    [id, auth.id],
  )
  res.status(201).json({ ok: true, work_order_id: id, subscribed: true })
})

router.delete('/:id/subscribe', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wo = await fetchWorkOrderMetaForAccess(pool, id)
  if (!wo || !canAccessSite(scope, wo.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  await pool.query(
    `DELETE FROM work_order_subscriptions
     WHERE work_order_id = $1 AND user_id = $2`,
    [id, auth.id],
  )
  res.json({ ok: true, work_order_id: id, subscribed: false })
})

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<WorkOrderRow>(
      `${LIST_SQL} ORDER BY w.wo_key ASC`,
    )
    res.json({ work_orders: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ work_orders: [] })
    return
  }
  const r = await pool.query<WorkOrderRow>(
    `${LIST_SQL} WHERE w.site_id = ANY($1::uuid[])
     ORDER BY w.wo_key ASC`,
    [allowed],
  )
  res.json({ work_orders: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<WorkOrderRow>(`${LIST_SQL} WHERE w.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  const work_instructions = await fetchWorkInstructionsForWorkOrder(pool, id)
  res.json({
    work_order: {
      ...row,
      work_instructions,
    },
  })
})

router.get('/:id/employees', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wo = await fetchWorkOrderMetaForAccess(pool, id)
  if (!wo || !canAccessSite(scope, wo.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  const employees = await fetchWorkOrderEmployees(pool, id)
  res.json({ employees })
})

router.get('/:id/employees/pool', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wo = await fetchWorkOrderMetaForAccess(pool, id)
  if (!wo || !canAccessSite(scope, wo.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  const assigned = await fetchWorkOrderEmployees(pool, id)
  const assignedIds = assigned.map((row) => row.employee_id)

  const availableSql =
    wo.workgroup_id === null
      ? `SELECT e.id AS employee_id, e.key AS employee_key, e.name AS employee_name
         FROM employees e
         WHERE e.site_id = $1
           AND NOT (e.id = ANY($2::uuid[]))
         ORDER BY e.name ASC, e.key ASC`
      : `SELECT e.id AS employee_id, e.key AS employee_key, e.name AS employee_name
         FROM workgroup_employees we
         INNER JOIN employees e ON e.id = we.employee_id
         WHERE we.workgroup_id = $1
           AND e.site_id = $2
           AND NOT (e.id = ANY($3::uuid[]))
         ORDER BY e.name ASC, e.key ASC`

  const available = wo.workgroup_id === null
    ? (
        await pool.query<WorkOrderEmployeeRow>(availableSql, [
          wo.site_id,
          assignedIds,
        ])
      ).rows
    : (
        await pool.query<WorkOrderEmployeeRow>(availableSql, [
          wo.workgroup_id,
          wo.site_id,
          assignedIds,
        ])
      ).rows

  res.json({ available, assigned })
})

router.put('/:id/employees', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }

  const raw = (req.body as { employee_ids?: unknown })?.employee_ids
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: 'employee_ids must be an array of UUIDs.' })
    return
  }
  const employeeIds: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') {
      res.status(400).json({ error: 'employee_ids must be an array of UUIDs.' })
      return
    }
    const v = x.trim()
    if (!UUID_RE.test(v)) {
      res.status(400).json({ error: 'employee_ids must contain valid UUIDs.' })
      return
    }
    employeeIds.push(v)
  }
  const uniqueIds = [...new Set(employeeIds)]

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')

    const woR = await client.query<{
      id: string
      site_id: string
      wo_key: number
      workgroup_id: string | null
      status: string
    }>(
      `SELECT id, site_id, wo_key, workgroup_id, status
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const wo = woR.rows[0]
    if (!wo || !canAccessSite(scope, wo.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    const beforeAssignedR = await client.query<{ employee_id: string }>(
      `SELECT employee_id
       FROM work_order_employees
       WHERE work_order_id = $1`,
      [id],
    )
    const beforeAssignedIds = new Set(
      beforeAssignedR.rows.map((row) => row.employee_id),
    )

    const beforeRowR = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = beforeRowR.rows[0]
    if (!beforeRow) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    if (uniqueIds.length > 0) {
      const empR = await client.query<EmployeeSiteRow>(
        `SELECT id, site_id, key, name
         FROM employees
         WHERE id = ANY($1::uuid[])`,
        [uniqueIds],
      )
      const byId = new Map(empR.rows.map((row) => [row.id, row]))
      for (const eid of uniqueIds) {
        const employee = byId.get(eid)
        if (!employee || employee.site_id !== wo.site_id) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'Each employee must exist and belong to the same site as the work order.',
          })
          return
        }
      }
    }

    if (wo.workgroup_id !== null && uniqueIds.length > 0) {
      const memberR = await client.query<{ employee_id: string }>(
        `SELECT employee_id
         FROM workgroup_employees
         WHERE workgroup_id = $1
           AND employee_id = ANY($2::uuid[])`,
        [wo.workgroup_id, uniqueIds],
      )
      if (memberR.rows.length !== uniqueIds.length) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'When a workgroup is set, only employees assigned to that workgroup can be assigned.',
        })
        return
      }
    }

    if (uniqueIds.length === 0) {
      await client.query(
        `DELETE FROM work_order_employees
         WHERE work_order_id = $1`,
        [id],
      )
    } else {
      await client.query(
        `DELETE FROM work_order_employees
         WHERE work_order_id = $1
           AND employee_id <> ALL($2::uuid[])`,
        [id, uniqueIds],
      )
      await client.query(
        `INSERT INTO work_order_employees (work_order_id, employee_id)
         SELECT $1::uuid, x::uuid
         FROM unnest($2::uuid[]) AS t(x)
         ON CONFLICT DO NOTHING`,
        [id, uniqueIds],
      )
    }

    const nextStatus =
      beforeRow.status === 'open' && uniqueIds.length > 0
        ? 'assigned'
        : beforeRow.status

    const afterR = await client.query<WorkOrderTableRow>(
      `UPDATE work_orders
       SET status = $1,
           updated_at = now(),
           updated_by = $2
       WHERE id = $3
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, work_type_id, status,
                 hold_reason,
                 work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                 created_at, updated_at, created_by, updated_by`,
      [nextStatus, auth.id, id],
    )
    const afterTable = afterR.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    const beforeState = redactForAudit(
      'work_order',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_order',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_order',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const notificationDrafts = buildWorkOrderFieldChangeNotifications({
      actorUserId: auth.id,
      actorName: auth.name,
      workOrderId: afterTable.id,
      workOrderKey: afterTable.wo_key,
      changes,
    })
    const addedEmployeeIds = uniqueIds.filter((employeeId) => !beforeAssignedIds.has(employeeId))
    const removedEmployeeIds = [...beforeAssignedIds].filter(
      (employeeId) => !uniqueIds.includes(employeeId),
    )
    if (addedEmployeeIds.length > 0) {
      const addedEmployeesR = await client.query<EmployeeSiteRow>(
        `SELECT id, site_id, key, name
         FROM employees
         WHERE id = ANY($1::uuid[])`,
        [addedEmployeeIds],
      )
      notificationDrafts.push(
        ...buildWorkOrderEmployeeAssignedNotifications({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: afterTable.id,
          workOrderKey: afterTable.wo_key,
          employees: addedEmployeesR.rows.map((row) => ({
            id: row.id,
            key: row.key,
            name: row.name,
          })),
        }),
      )
    }
    if (removedEmployeeIds.length > 0) {
      const removedEmployeesR = await client.query<EmployeeSiteRow>(
        `SELECT id, site_id, key, name
         FROM employees
         WHERE id = ANY($1::uuid[])`,
        [removedEmployeeIds],
      )
      notificationDrafts.push(
        ...buildWorkOrderEmployeeDeassignedNotifications({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: afterTable.id,
          workOrderKey: afterTable.wo_key,
          employees: removedEmployeesR.rows.map((row) => ({
            id: row.id,
            key: row.key,
            name: row.name,
          })),
        }),
      )
    }
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: afterTable.id,
      drafts: notificationDrafts,
    })

    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    const employees = await fetchWorkOrderEmployees(client, afterTable.id)
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    broadcastWorkOrderUpdated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderUpdated>[0],
    )
    res.json({ work_order: workOrder!, employees })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.get('/:id/transactions', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const wo = await fetchWorkOrderMetaForAccess(pool, id)
  if (!wo || !canAccessSite(scope, wo.site_id)) {
    res.status(404).json({ error: 'Work order not found.' })
    return
  }
  const r = await pool.query<{
    id: string
    work_order_id: string
    type: string
    employee_id: string
    created_by_user_id: string
    hours: string
    feedback_text: string
    created_at: Date
    employee_key: string
    employee_name: string
    created_by_login_name: string | null
  }>(
    `SELECT t.id, t.work_order_id, t.type, t.employee_id, t.created_by_user_id,
            t.hours, t.feedback_text, t.created_at,
            e.key AS employee_key, e.name AS employee_name,
            u.login_name AS created_by_login_name
     FROM transactions t
     INNER JOIN employees e ON e.id = t.employee_id
     INNER JOIN users u ON u.id = t.created_by_user_id
     WHERE t.work_order_id = $1 AND t.type = 'INT'
     ORDER BY t.created_at DESC, t.id DESC`,
    [id],
  )
  res.json({ transactions: r.rows })
})

router.post('/:id/actions/start', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    const allowedFrom = new Set(['open', 'assigned', 'on_hold'])
    if (!allowedFrom.has(beforeRow.status)) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Start is only allowed when the work order is open, assigned, or on hold.',
      })
      return
    }
    const startRequiresAssignment =
      await getWoStartRequiresAssignment(pool)
    const actorEmployeeId = await loadUserEmployeeId(client, auth.id)
    if (!actorEmployeeId) {
      await client.query('ROLLBACK')
      res.status(403).json({
        error:
          'Your user account must be linked to an employee to start a work order.',
      })
      return
    }
    if (beforeRow.workgroup_id !== null) {
      const inWorkgroup = await isEmployeeMemberOfWorkgroup(
        client,
        beforeRow.workgroup_id,
        actorEmployeeId,
      )
      if (!inWorkgroup) {
        await client.query('ROLLBACK')
        res.status(403).json({
          error:
            'Your linked employee must be a member of this work order\'s workgroup to start work.',
        })
        return
      }
    }
    if (startRequiresAssignment) {
      const assigned = await isEmployeeAssignedToWorkOrder(
        client,
        id,
        actorEmployeeId,
      )
      if (!assigned) {
        await client.query('ROLLBACK')
        res.status(403).json({
          error:
            'You must be linked to an employee assigned to this work order to start it.',
        })
        return
      }
    }
    if (!startRequiresAssignment) {
      const userAutoAssignOnStart = await getWoUserAutoAssignOnStart(pool)
      if (userAutoAssignOnStart) {
        const alreadyAssigned = await isEmployeeAssignedToWorkOrder(
          client,
          id,
          actorEmployeeId,
        )
        if (!alreadyAssigned) {
          await client.query(
            `INSERT INTO work_order_employees (work_order_id, employee_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [id, actorEmployeeId],
          )
        }
      }
    }
    const afterStatus =
      beforeRow.status === 'on_hold' ? 'continued' : 'started'
    const nextHoldReason =
      beforeRow.status === 'on_hold' ? null : beforeRow.hold_reason
    const r = await client.query<WorkOrderTableRow>(
      `UPDATE work_orders SET
         status = $1,
         hold_reason = $2,
         updated_at = now(),
         updated_by = $3
       WHERE id = $4
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, work_type_id, status,
                 hold_reason,
                 work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                 created_at, updated_at, created_by, updated_by`,
      [afterStatus, nextHoldReason, auth.id, id],
    )
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    const beforeState = redactForAudit(
      'work_order',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_order',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_order',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: afterTable.id,
      drafts: [
        buildWorkOrderStartedNotification({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: afterTable.id,
          workOrderKey: afterTable.wo_key,
          beforeStatus: beforeRow.status,
          afterStatus,
        }),
      ],
    })
    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    broadcastWorkOrderUpdated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderUpdated>[0],
    )
    res.json({ work_order: workOrder! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.post('/:id/actions/hold', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const reasonRaw = (req.body as { reason?: unknown })?.reason
  if (typeof reasonRaw !== 'string' || !reasonRaw.trim()) {
    res.status(400).json({ error: 'reason is required.' })
    return
  }
  const reason = reasonRaw.trim()
  if (reason.length > 2000) {
    res.status(400).json({ error: 'reason is too long.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    if (beforeRow.status !== 'started' && beforeRow.status !== 'continued') {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Hold is only allowed when the work order is started or continued.',
      })
      return
    }
    const r = await client.query<WorkOrderTableRow>(
      `UPDATE work_orders SET
         status = 'on_hold',
         hold_reason = $1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $3
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, work_type_id, status,
                 hold_reason,
                 work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                 created_at, updated_at, created_by, updated_by`,
      [reason, auth.id, id],
    )
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    const beforeState = redactForAudit(
      'work_order',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_order',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_order',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: afterTable.id,
      drafts: [
        buildWorkOrderPutOnHoldNotification({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: afterTable.id,
          workOrderKey: afterTable.wo_key,
          reason,
        }),
      ],
    })
    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    broadcastWorkOrderUpdated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderUpdated>[0],
    )
    res.json({ work_order: workOrder! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.post('/:id/actions/feedback', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const parsed = parseFeedbackActionBody(req.body)
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { entries, target_status, hold_reason } = parsed
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    if (beforeRow.status !== 'started' && beforeRow.status !== 'continued') {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Feedback is only allowed when the work order is started or continued.',
      })
      return
    }
    const startRequiresAssignment =
      await getWoStartRequiresAssignment(client)
    const userAutoAssignOnStart = await getWoUserAutoAssignOnStart(client)
    const actorEmployeeId = await loadUserEmployeeId(client, auth.id)
    const woWgRaw = beforeRow.workgroup_id
    const woWorkgroupId =
      typeof woWgRaw === 'string' && UUID_RE.test(woWgRaw.trim())
        ? woWgRaw.trim()
        : null
    for (const ent of entries) {
      const ensured = await ensureEmployeeAllowedForFeedbackEntry(client, {
        workOrderId: id,
        woSiteId: beforeRow.site_id,
        woWorkgroupId,
        entryEmployeeId: ent.employee_id,
        startRequiresAssignment,
        userAutoAssignOnStart,
        actorEmployeeId,
      })
      if (!ensured.ok) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: ensured.error })
        return
      }
    }
    for (const ent of entries) {
      await client.query(
        `INSERT INTO transactions (
           work_order_id, type, employee_id, created_by_user_id, hours, feedback_text
         ) VALUES ($1, 'INT', $2, $3, $4, $5)`,
        [id, ent.employee_id, auth.id, ent.hours, ent.feedback_text],
      )
    }
    let afterTable = beforeRow
    if (target_status === 'on_hold') {
      const r = await client.query<WorkOrderTableRow>(
        `UPDATE work_orders SET
           status = 'on_hold',
           hold_reason = $1,
           updated_at = now(),
           updated_by = $2
         WHERE id = $3
         RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                   plan_start, plan_end, worktime, work_type_id, status,
                   hold_reason,
                   work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                   created_at, updated_at, created_by, updated_by`,
        [hold_reason!, auth.id, id],
      )
      afterTable = r.rows[0]!
      const beforeState = redactForAudit(
        'work_order',
        rowToAuditRecord(beforeRow),
      )
      const afterState = redactForAudit(
        'work_order',
        rowToAuditRecord(afterTable),
      )
      const changes =
        beforeState && afterState ? fieldChanges(beforeState, afterState) : null
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'work_order',
        resourceId: afterTable.id,
        beforeState,
        afterState,
        fieldChanges: changes,
        httpMethod: req.method,
        path: auditPath,
      })
      notificationsToBroadcast = await createNotificationsForSubscribers(client, {
        workOrderId: afterTable.id,
        drafts: [
          buildWorkOrderPutOnHoldNotification({
            actorUserId: auth.id,
            actorName: auth.name,
            workOrderId: afterTable.id,
            workOrderKey: afterTable.wo_key,
            reason: hold_reason!,
          }),
        ],
      })
    } else if (target_status === 'done') {
      const r = await client.query<WorkOrderTableRow>(
        `UPDATE work_orders SET
           status = 'done',
           hold_reason = NULL,
           updated_at = now(),
           updated_by = $1
         WHERE id = $2
         RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                   plan_start, plan_end, worktime, work_type_id, status,
                   hold_reason,
                   work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                   created_at, updated_at, created_by, updated_by`,
        [auth.id, id],
      )
      afterTable = r.rows[0]!
      const beforeState = redactForAudit(
        'work_order',
        rowToAuditRecord(beforeRow),
      )
      const afterState = redactForAudit(
        'work_order',
        rowToAuditRecord(afterTable),
      )
      const changes =
        beforeState && afterState ? fieldChanges(beforeState, afterState) : null
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'update',
        resourceType: 'work_order',
        resourceId: afterTable.id,
        beforeState,
        afterState,
        fieldChanges: changes,
        httpMethod: req.method,
        path: auditPath,
      })
      const notificationDrafts = buildWorkOrderFieldChangeNotifications({
        actorUserId: auth.id,
        actorName: auth.name,
        workOrderId: afterTable.id,
        workOrderKey: afterTable.wo_key,
        changes,
      })
      notificationsToBroadcast = await createNotificationsForSubscribers(client, {
        workOrderId: afterTable.id,
        drafts: notificationDrafts,
      })
    }
    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    broadcastWorkOrderUpdated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderUpdated>[0],
    )
    res.json({ work_order: workOrder! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.post('/', async (req, res) => {
  const shortText =
    typeof req.body?.short_text === 'string' ? req.body.short_text.trim() : ''
  const instructionText = parseInstructionText(req.body)
  const assetIdRaw = parseAssetId(req.body)
  const worktimeRaw = parseWorktime(req.body)

  if (!shortText) {
    res.status(400).json({ error: 'Short text is required.' })
    return
  }
  if (instructionText === undefined || typeof instructionText !== 'string') {
    res.status(400).json({ error: 'Instruction text is required.' })
    return
  }
  const instructionTrimmed = instructionText.trim()
  if (!instructionTrimmed) {
    res.status(400).json({ error: 'Instruction text cannot be empty.' })
    return
  }
  if (instructionTrimmed.length > 2000) {
    res.status(400).json({ error: 'Instruction text must be at most 2000 characters.' })
    return
  }
  if (!assetIdRaw || !UUID_RE.test(assetIdRaw)) {
    res.status(400).json({ error: 'A valid asset_id is required.' })
    return
  }
  if (worktimeRaw === undefined || worktimeRaw === null) {
    res.status(400).json({ error: 'Worktime is required.' })
    return
  }
  const worktimeNum =
    typeof worktimeRaw === 'number'
      ? worktimeRaw
      : typeof worktimeRaw === 'string'
        ? Number(worktimeRaw)
        : NaN
  if (!Number.isFinite(worktimeNum) || worktimeNum < 0) {
    res.status(400).json({ error: 'Worktime must be a non-negative number.' })
    return
  }

  const planStart = parseOptionalInstant(req.body, 'plan_start')
  if (planStart === undefined && req.body?.plan_start !== undefined) {
    res.status(400).json({ error: 'Invalid plan_start.' })
    return
  }
  const durParsed = parseDurationHours(req.body)
  if (durParsed === undefined && req.body?.duration !== undefined) {
    res.status(400).json({ error: 'duration must be a non-negative number (hours).' })
    return
  }
  const durationHours = durParsed ?? 0

  const ps = planStart === undefined ? null : planStart
  const pe =
    ps === null
      ? null
      : planEndFromStartAndDurationHours(ps, durationHours)

  const workTypeIdParsed = parseWorkTypeId(req.body)
  if (workTypeIdParsed === 'invalid' || workTypeIdParsed === undefined) {
    res.status(400).json({ error: 'work_type_id is required (a valid UUID).' })
    return
  }

  const workgroupIdParsed = parseWorkgroupId(req.body)
  if (workgroupIdParsed === 'invalid' || workgroupIdParsed === undefined) {
    res.status(400).json({ error: 'workgroup_id is required (a valid UUID).' })
    return
  }

  const categoryIdParsed = parseCategoryId(req.body)
  if (categoryIdParsed === 'invalid') {
    res.status(400).json({ error: 'category_id must be a valid UUID or null.' })
    return
  }

  const wiParsed = parseWorkInstructionsInput(req.body)
  if (!wiParsed.ok) {
    res.status(400).json({ error: wiParsed.error })
    return
  }

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const asset = await resolveAssetForWrite(client, assetIdRaw, siteId)
    if (!asset) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Asset not found or not in your working site.',
      })
      return
    }

    const wtRow = await getWorkTypeForSite(client, workTypeIdParsed, siteId)
    if (!wtRow) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'work_type_id must reference a work type for your working site.',
      })
      return
    }

    const wgRow = await getWorkgroupForSite(client, workgroupIdParsed, siteId)
    if (!wgRow) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'workgroup_id must reference a workgroup for your working site.',
      })
      return
    }

    let nextCategoryId: string | null = null
    if (categoryIdParsed !== undefined && categoryIdParsed !== null) {
      const ok = await categoryBelongsToSite(client, categoryIdParsed, siteId)
      if (!ok) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'category_id must reference a category for your working site.',
        })
        return
      }
      nextCategoryId = categoryIdParsed
    }

    const r = await client.query<{ id: string }>(
      `INSERT INTO work_orders (
         site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
         plan_start, plan_end, worktime, work_type_id, status,
         work_plan_id, work_plan_key, duration,
         category_id, workgroup_id, created_by
       )
       VALUES (
         $1, nextval('work_order_wo_key_seq'), $2, $3, $4, $5,
         $6, $7, $8, $9, 'open',
         NULL, NULL, $10::numeric,
         $11, $12, $13
       )
       RETURNING id`,
      [
        siteId,
        shortText.slice(0, 200),
        assetIdRaw,
        asset.costcenter_id,
        instructionTrimmed,
        ps,
        pe,
        worktimeNum,
        workTypeIdParsed,
        durationHours,
        nextCategoryId,
        workgroupIdParsed,
        auth.id,
      ],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }

    const tableRow = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'work_order',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'work_order',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const workOrder = await fetchWorkOrderDetailForResponse(client, insertedId)
    await client.query('COMMIT')
    broadcastWorkOrderCreated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderCreated>[0],
    )
    res.status(201).json({
      work_order: workOrder!,
    })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const shortTextOpt = parseShortText(req.body)
  const instructionTextOpt = parseInstructionText(req.body)
  const assetIdOpt = parseAssetId(req.body)
  const worktimeOpt = parseWorktime(req.body)
  const planStartOpt = parseOptionalInstant(req.body, 'plan_start')
  const durationOpt = parseDurationHours(req.body)
  const workTypeIdOpt = parseWorkTypeId(req.body)
  const categoryIdOpt = parseCategoryId(req.body)
  const workgroupIdOpt = parseWorkgroupId(req.body)
  const statusOpt = parseStatus(req.body)

  if (workTypeIdOpt === 'invalid') {
    res.status(400).json({ error: 'work_type_id must be a valid UUID.' })
    return
  }
  if (categoryIdOpt === 'invalid') {
    res.status(400).json({ error: 'category_id must be a valid UUID or null.' })
    return
  }
  if (statusOpt === 'invalid') {
    res.status(400).json({
      error:
        'status must be one of: open, assigned, started, continued, on_hold, done, closed.',
    })
    return
  }
  if (workgroupIdOpt === 'invalid') {
    res.status(400).json({ error: 'workgroup_id is required (a valid UUID).' })
    return
  }
  if (durationOpt === undefined && req.body?.duration !== undefined) {
    res.status(400).json({ error: 'duration must be a non-negative number (hours).' })
    return
  }

  if (shortTextOpt !== undefined && !shortTextOpt.trim()) {
    res.status(400).json({ error: 'Short text cannot be empty.' })
    return
  }
  if (instructionTextOpt !== undefined) {
    const t = instructionTextOpt.trim()
    if (!t) {
      res.status(400).json({ error: 'Instruction text cannot be empty.' })
      return
    }
    if (t.length > 2000) {
      res.status(400).json({
        error: 'Instruction text must be at most 2000 characters.',
      })
      return
    }
  }
  if (assetIdOpt !== undefined && (!assetIdOpt || !UUID_RE.test(assetIdOpt))) {
    res.status(400).json({ error: 'Invalid asset_id.' })
    return
  }
  if (worktimeOpt !== undefined) {
    const worktimeNum =
      typeof worktimeOpt === 'number'
        ? worktimeOpt
        : typeof worktimeOpt === 'string'
          ? Number(worktimeOpt)
          : NaN
    if (!Number.isFinite(worktimeNum) || worktimeNum < 0) {
      res.status(400).json({ error: 'Worktime must be a non-negative number.' })
      return
    }
  }
  if (planStartOpt === undefined && req.body?.plan_start !== undefined) {
    res.status(400).json({ error: 'Invalid plan_start.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    if (statusOpt !== undefined && statusOpt !== beforeRow.status) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Status cannot be changed via this endpoint. Use Start, Hold, or Feedback actions.',
      })
      return
    }

    const nextWorkgroupId = workgroupIdOpt ?? beforeRow.workgroup_id
    const wgPatch = await getWorkgroupForSite(
      client,
      nextWorkgroupId,
      beforeRow.site_id,
    )
    if (!wgPatch) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'workgroup_id must reference a workgroup for this work order site.',
      })
      return
    }

    const assignedEmployeeIdsR = await client.query<{ employee_id: string }>(
      `SELECT employee_id
       FROM work_order_employees
       WHERE work_order_id = $1`,
      [id],
    )
    const assignedEmployeeIds = assignedEmployeeIdsR.rows.map((row) => row.employee_id)
    if (assignedEmployeeIds.length > 0) {
      const allowedMemberR = await client.query<{ employee_id: string }>(
        `SELECT employee_id
         FROM workgroup_employees
         WHERE workgroup_id = $1
           AND employee_id = ANY($2::uuid[])`,
        [nextWorkgroupId, assignedEmployeeIds],
      )
      if (allowedMemberR.rows.length !== assignedEmployeeIds.length) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'Cannot change workgroup while assigned employees are not members of the target workgroup.',
        })
        return
      }
    }

    const pmId = beforeRow.work_plan_id
      ? await getPmWorkTypeIdForSite(client, beforeRow.site_id)
      : undefined
    if (beforeRow.work_plan_id && !pmId) {
      await client.query('ROLLBACK')
      res.status(500).json({
        error: 'PM work type is missing for this site; contact an administrator.',
      })
      return
    }

    if (
      beforeRow.work_plan_id &&
      workTypeIdOpt !== undefined &&
      workTypeIdOpt !== pmId
    ) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'work_type_id cannot be changed while this work order is linked to a work plan (PM only).',
      })
      return
    }

    let nextShort = beforeRow.short_text
    let nextInstruction = beforeRow.instruction_text
    let nextAssetId = beforeRow.asset_id
    let nextCostcenterId = beforeRow.costcenter_id
    let nextPlanStart = beforeRow.plan_start
    let nextWorktime = beforeRow.worktime
    let nextDuration = Number(beforeRow.duration)
    let nextWorkTypeId = beforeRow.work_type_id
    let nextStatus = beforeRow.status

    if (beforeRow.work_plan_id && pmId) {
      nextWorkTypeId = pmId
    } else if (workTypeIdOpt !== undefined) {
      const wt = await getWorkTypeForSite(
        client,
        workTypeIdOpt,
        beforeRow.site_id,
      )
      if (!wt) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'work_type_id must reference a work type for this work order site.',
        })
        return
      }
      nextWorkTypeId = wt.id
    }

    let nextCategoryId: string | null = beforeRow.category_id
    if (categoryIdOpt !== undefined) {
      if (categoryIdOpt === null) {
        nextCategoryId = null
      } else {
        const ok = await categoryBelongsToSite(
          client,
          categoryIdOpt,
          beforeRow.site_id,
        )
        if (!ok) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'category_id must reference a category for this work order site.',
          })
          return
        }
        nextCategoryId = categoryIdOpt
      }
    }

    if (shortTextOpt !== undefined) {
      nextShort = shortTextOpt.trim().slice(0, 200)
    }
    if (instructionTextOpt !== undefined) {
      nextInstruction = instructionTextOpt.trim()
    }
    if (assetIdOpt !== undefined) {
      const asset = await resolveAssetForWrite(client, assetIdOpt, beforeRow.site_id)
      if (!asset) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Asset not found or not in this work order site.',
        })
        return
      }
      nextAssetId = assetIdOpt
      nextCostcenterId = asset.costcenter_id
    }
    if (worktimeOpt !== undefined) {
      const worktimeNum =
        typeof worktimeOpt === 'number'
          ? worktimeOpt
          : typeof worktimeOpt === 'string'
            ? Number(worktimeOpt)
            : NaN
      nextWorktime = String(worktimeNum)
    }
    if (planStartOpt !== undefined) {
      nextPlanStart = planStartOpt
    }
    if (durationOpt !== undefined) {
      nextDuration = durationOpt
    }
    if (statusOpt !== undefined) {
      nextStatus = statusOpt
    }

    const nextPlanEnd =
      nextPlanStart === null
        ? null
        : planEndFromStartAndDurationHours(nextPlanStart, nextDuration)

    const r = await client.query<WorkOrderTableRow>(
      `UPDATE work_orders SET
         short_text = $1,
         instruction_text = $2,
         asset_id = $3,
         costcenter_id = $4,
         plan_start = $5,
         plan_end = $6,
         worktime = $7,
         work_type_id = $8,
         category_id = $9,
         duration = $10::numeric,
         workgroup_id = $11,
         status = $12,
         updated_at = now(),
         updated_by = $13
       WHERE id = $14
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, work_type_id, status,
                 hold_reason,
                 work_plan_id, work_plan_key, duration, category_id, workgroup_id,
                 created_at, updated_at, created_by, updated_by`,
      [
        nextShort,
        nextInstruction,
        nextAssetId,
        nextCostcenterId,
        nextPlanStart,
        nextPlanEnd,
        nextWorktime,
        nextWorkTypeId,
        nextCategoryId,
        nextDuration,
        nextWorkgroupId,
        nextStatus,
        auth.id,
        id,
      ],
    )
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    const beforeState = redactForAudit(
      'work_order',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_order',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_order',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const notificationDrafts = buildWorkOrderFieldChangeNotifications({
      actorUserId: auth.id,
      actorName: auth.name,
      workOrderId: afterTable.id,
      workOrderKey: afterTable.wo_key,
      changes,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: afterTable.id,
      drafts: notificationDrafts,
    })

    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    broadcastWorkOrderUpdated(
      workOrder! as unknown as Parameters<typeof broadcastWorkOrderUpdated>[0],
    )
    res.json({
      work_order: workOrder!,
    })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.post('/:id/work-instructions', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }
  const sortRaw = req.body?.sort_nr
  const textRaw = req.body?.instruction_text
  if (typeof sortRaw !== 'number' || !Number.isInteger(sortRaw)) {
    res.status(400).json({ error: 'sort_nr must be an integer.' })
    return
  }
  if (typeof textRaw !== 'string') {
    res.status(400).json({ error: 'instruction_text is required.' })
    return
  }
  const t = textRaw.trim()
  if (!t) {
    res.status(400).json({ error: 'Instruction text cannot be empty.' })
    return
  }
  if (t.length > 200) {
    res.status(400).json({ error: 'Instruction must be at most 200 characters.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<{ site_id: string; wo_key: number }>(
      `SELECT site_id, wo_key FROM work_orders WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const row = prev.rows[0]
    if (!row || !canAccessSite(scope, row.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }
    const ins = await client.query<WorkInstructionDto>(
      `INSERT INTO work_instructions (work_order_id, sort_nr, instruction_text, done)
       VALUES ($1, $2, $3, false)
       RETURNING id, sort_nr, instruction_text, done`,
      [id, sortRaw, t],
    )
    const wi = ins.rows[0]
    if (!wi) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }
    const afterState = redactForAudit(
      'work_instruction',
      serializeRowForAudit(wi as unknown as Record<string, unknown>),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'work_instruction',
      resourceId: wi.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: id,
      drafts: [
        buildWorkInstructionCreatedNotification({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: id,
          workOrderKey: row.wo_key,
          workInstructionId: wi.id,
          sortNr: wi.sort_nr,
        }),
      ],
    })
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    res.status(201).json({ work_instruction: wi })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id/work-instructions/:wiId', async (req, res) => {
  const id = req.params.id
  const wiId = req.params.wiId
  if (!UUID_RE.test(id) || !UUID_RE.test(wiId)) {
    res.status(400).json({ error: 'Invalid id.' })
    return
  }
  const body = req.body as Record<string, unknown>
  const hasSort = 'sort_nr' in body
  const hasText = 'instruction_text' in body
  const hasDone = 'done' in body
  if (!hasSort && !hasText && !hasDone) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  let nextSort: number | undefined
  if (hasSort) {
    const v = body.sort_nr
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      res.status(400).json({ error: 'sort_nr must be an integer.' })
      return
    }
    nextSort = v
  }
  let nextText: string | undefined
  if (hasText) {
    const v = body.instruction_text
    if (typeof v !== 'string') {
      res.status(400).json({ error: 'instruction_text must be a string.' })
      return
    }
    const t = v.trim()
    if (!t) {
      res.status(400).json({ error: 'Instruction text cannot be empty.' })
      return
    }
    if (t.length > 200) {
      res.status(400).json({
        error: 'Instruction must be at most 200 characters.',
      })
      return
    }
    nextText = t
  }
  let nextDone: boolean | undefined
  if (hasDone) {
    const v = body.done
    if (typeof v !== 'boolean') {
      res.status(400).json({ error: 'done must be a boolean.' })
      return
    }
    nextDone = v
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const lockWo = await client.query<{ site_id: string; wo_key: number }>(
      `SELECT w.site_id, w.wo_key
       FROM work_orders w
       INNER JOIN work_instructions wi ON wi.work_order_id = w.id
       WHERE w.id = $1 AND wi.id = $2
       FOR UPDATE`,
      [id, wiId],
    )
    const ok = lockWo.rows[0]
    if (!ok || !canAccessSite(scope, ok.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }

    const cur = await client.query<WorkInstructionDto>(
      `SELECT id, sort_nr, instruction_text, done FROM work_instructions WHERE id = $1`,
      [wiId],
    )
    const row = cur.rows[0]
    if (!row || row.id !== wiId) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }

    const upd = await client.query<WorkInstructionDto>(
      `UPDATE work_instructions SET
         sort_nr = COALESCE($1, sort_nr),
         instruction_text = COALESCE($2, instruction_text),
         done = COALESCE($3, done)
       WHERE id = $4 AND work_order_id = $5
       RETURNING id, sort_nr, instruction_text, done`,
      [
        nextSort ?? null,
        nextText ?? null,
        nextDone ?? null,
        wiId,
        id,
      ],
    )
    const after = upd.rows[0]
    if (!after) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }
    const beforeState = redactForAudit(
      'work_instruction',
      serializeRowForAudit(row as unknown as Record<string, unknown>),
    )
    const afterState = redactForAudit(
      'work_instruction',
      serializeRowForAudit(after as unknown as Record<string, unknown>),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_instruction',
      resourceId: wiId,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: id,
      drafts: buildWorkInstructionUpdatedNotifications({
        actorUserId: auth.id,
        actorName: auth.name,
        workOrderId: id,
        workOrderKey: ok.wo_key,
        workInstructionId: wiId,
        changes,
      }),
    })
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    res.json({ work_instruction: after })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id/work-instructions/:wiId', async (req, res) => {
  const id = req.params.id
  const wiId = req.params.wiId
  if (!UUID_RE.test(id) || !UUID_RE.test(wiId)) {
    res.status(400).json({ error: 'Invalid id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    let notificationsToBroadcast: Awaited<
      ReturnType<typeof createNotificationsForSubscribers>
    > = []
    await client.query('BEGIN')
    const prev = await client.query<{
      site_id: string
      wo_key: number
      sort_nr: number
      instruction_text: string
      done: boolean
    }>(
      `SELECT w.site_id, w.wo_key, wi.sort_nr, wi.instruction_text, wi.done
       FROM work_instructions wi
       INNER JOIN work_orders w ON w.id = wi.work_order_id
       WHERE wi.id = $1 AND wi.work_order_id = $2`,
      [wiId, id],
    )
    const row = prev.rows[0]
    if (!row || !canAccessSite(scope, row.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }
    const beforeState = redactForAudit(
      'work_instruction',
      serializeRowForAudit({
        id: wiId,
        sort_nr: row.sort_nr,
        instruction_text: row.instruction_text,
        done: row.done,
      }),
    )
    await client.query(
      `DELETE FROM work_instructions WHERE id = $1 AND work_order_id = $2`,
      [wiId, id],
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'work_instruction',
      resourceId: wiId,
      beforeState,
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    notificationsToBroadcast = await createNotificationsForSubscribers(client, {
      workOrderId: id,
      drafts: [
        buildWorkInstructionDeletedNotification({
          actorUserId: auth.id,
          actorName: auth.name,
          workOrderId: id,
          workOrderKey: row.wo_key,
          workInstructionId: wiId,
          sortNr: row.sort_nr,
        }),
      ],
    })
    await client.query('COMMIT')
    broadcastWorkOrderNotifications(notificationsToBroadcast)
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work order id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
              hold_reason,
              work_plan_id, work_plan_key, duration, category_id, workgroup_id,
              created_at, updated_at, created_by, updated_by
       FROM work_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found.' })
      return
    }

    await client.query(`DELETE FROM work_orders WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'work_order',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'work_order',
      resourceId: id,
      beforeState,
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    broadcastWorkOrderDeleted(id, beforeRow.site_id)
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

export default router
