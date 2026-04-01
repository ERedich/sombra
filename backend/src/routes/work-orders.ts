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
import { broadcastWorkOrderCreated } from '../realtime/workOrderSocket.js'
import { requireAuth } from '../middleware/auth.js'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
} from '../audit/auditLog.js'
import { planEndFromStartAndDurationHours } from '../services/intervalUtc.js'
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
  work_instruction_count: number
  work_instruction_done_count: number
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
       false AS has_employee_assignment,
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

  if (workTypeIdOpt === 'invalid') {
    res.status(400).json({ error: 'work_type_id must be a valid UUID.' })
    return
  }
  if (categoryIdOpt === 'invalid') {
    res.status(400).json({ error: 'category_id must be a valid UUID or null.' })
    return
  }
  if (workgroupIdOpt === undefined || workgroupIdOpt === 'invalid') {
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
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, work_type_id, status,
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

    const wgPatch = await getWorkgroupForSite(
      client,
      workgroupIdOpt,
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
         updated_at = now(),
         updated_by = $12
       WHERE id = $13
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, work_type_id, status,
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
        workgroupIdOpt,
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

    const workOrder = await fetchWorkOrderDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<{ site_id: string }>(
      `SELECT site_id FROM work_orders WHERE id = $1 FOR UPDATE`,
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
    await client.query('COMMIT')
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lockWo = await client.query<{ site_id: string }>(
      `SELECT w.site_id
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
    await client.query('COMMIT')
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<{ site_id: string }>(
      `SELECT w.site_id
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
    await client.query(
      `DELETE FROM work_instructions WHERE id = $1 AND work_order_id = $2`,
      [wiId, id],
    )
    await client.query('COMMIT')
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
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

export default router
