import { Router } from 'express'
import type { Response } from 'express'
import type { AuthUser } from '../middleware/auth.js'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
} from '../audit/auditLog.js'
import {
  runWorkPlanGenerator,
  type GeneratorActor,
} from '../services/workPlanWoGen.js'
import type { IntervalTimeType } from '../services/intervalUtc.js'
import type { WorkInstructionDto } from './work-orders.js'
import { parseWorkInstructionsInput } from './work-orders.js'
import type { Pool, PoolClient } from 'pg'


const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WorkPlanTableRow = {
  id: string
  site_id: string
  plan_key: string
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  interval_count: number
  interval_time_type: string
  due_date: Date
  next_due_at: Date
  lead_time_days: number
  planned_duration: string
  category_id: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type WorkPlanRow = WorkPlanTableRow & {
  site_key: string
  site_name: string
  site_colour: string
  asset_key: string
  asset_name: string
  costcenter_key: string | null
  costcenter_name: string | null
  category_key: string | null
  category_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function rowToAuditRecord(row: WorkPlanTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const LIST_SQL = `
SELECT p.id, p.site_id, p.plan_key, p.short_text, p.asset_id, p.costcenter_id,
       p.instruction_text, p.planned_duration::text, p.interval_count, p.interval_time_type,
       p.due_date, p.next_due_at, p.lead_time_days,
       p.created_at, p.updated_at, p.created_by, p.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       a.key AS asset_key, a.name AS asset_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cat.key AS category_key, cat.name AS category_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name,
       false AS has_material_assignment,
       false AS has_employee_assignment,
       (SELECT COUNT(*)::int FROM work_instructions wi WHERE wi.work_plan_id = p.id)
         AS work_instruction_count,
       (SELECT COUNT(*)::int FROM work_instructions wi
         WHERE wi.work_plan_id = p.id AND wi.done = true)
         AS work_instruction_done_count
FROM work_plans p
INNER JOIN sites st ON st.id = p.site_id
INNER JOIN assets a ON a.id = p.asset_id
LEFT JOIN categories cat ON cat.id = p.category_id
LEFT JOIN costcenters cc ON cc.id = p.costcenter_id
LEFT JOIN users cb ON cb.id = p.created_by
LEFT JOIN users ub ON ub.id = p.updated_by
`

async function fetchWorkPlanWithJoins(
  client: PoolClient,
  id: string,
): Promise<WorkPlanRow | undefined> {
  const r = await client.query<WorkPlanRow>(
    `${LIST_SQL} WHERE p.id = $1`,
    [id],
  )
  return r.rows[0]
}

async function fetchWorkInstructionsForWorkPlan(
  client: Pool | PoolClient,
  workPlanId: string,
): Promise<WorkInstructionDto[]> {
  const r = await client.query<WorkInstructionDto>(
    `SELECT id, sort_nr, instruction_text, false AS done
     FROM work_instructions
     WHERE work_plan_id = $1
     ORDER BY sort_nr ASC, id ASC`,
    [workPlanId],
  )
  return r.rows
}

async function fetchWorkPlanDetailForResponse(
  client: PoolClient,
  id: string,
): Promise<
  (WorkPlanRow & { work_instructions: WorkInstructionDto[] }) | undefined
> {
  const wp = await fetchWorkPlanWithJoins(client, id)
  if (!wp) return undefined
  const work_instructions = await fetchWorkInstructionsForWorkPlan(client, id)
  return { ...wp, work_instructions }
}

async function insertWorkInstructionsForPlan(
  client: PoolClient,
  workPlanId: string,
  items: { sort_nr: number; instruction_text: string }[],
): Promise<void> {
  for (const it of items) {
    await client.query(
      `INSERT INTO work_instructions (work_plan_id, sort_nr, instruction_text, done)
       VALUES ($1, $2, $3, false)`,
      [workPlanId, it.sort_nr, it.instruction_text],
    )
  }
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

function parseIntervalType(v: unknown): IntervalTimeType | 'invalid' {
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim().toLowerCase()
  if (s === 'day' || s === 'week' || s === 'month' || s === 'year') return s
  return 'invalid'
}

function parseDueDate(v: unknown): Date | 'invalid' {
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!s) return 'invalid'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

const router = Router()
router.use(requireAuth)

router.post('/generate-due', async (req, res) => {
  const auth = req.authUser!
  const actor: GeneratorActor = {
    userId: auth.id,
    loginName: auth.login_name,
    name: auth.name,
  }
  try {
    const result = await runWorkPlanGenerator(pool, actor)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Generator failed.' })
  }
})

router.get('/', async (req, res) => {
  const auth = req.authUser!
  if (auth.role === 'admin') {
    const r = await pool.query<WorkPlanRow>(
      `${LIST_SQL} ORDER BY st.name ASC, p.plan_key ASC`,
    )
    res.json({ work_plans: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ work_plans: [] })
    return
  }
  const r = await pool.query<WorkPlanRow>(
    `${LIST_SQL} WHERE p.site_id = ANY($1::uuid[])
     ORDER BY st.name ASC, p.plan_key ASC`,
    [allowed],
  )
  res.json({ work_plans: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work plan id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<WorkPlanRow>(`${LIST_SQL} WHERE p.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Work plan not found.' })
    return
  }
  const work_instructions = await fetchWorkInstructionsForWorkPlan(pool, id)
  res.json({
    work_plan: {
      ...row,
      work_instructions,
    },
  })
})

router.post('/', async (req, res) => {
  const planKey =
    typeof req.body?.plan_key === 'string' ? req.body.plan_key.trim() : ''
  const shortText =
    typeof req.body?.short_text === 'string' ? req.body.short_text.trim() : ''
  const instructionText =
    typeof req.body?.instruction_text === 'string'
      ? req.body.instruction_text
      : ''
  const assetIdRaw =
    typeof req.body?.asset_id === 'string' ? req.body.asset_id : ''

  const intervalParsed = parseIntervalType(req.body?.interval_time_type)
  if (intervalParsed === 'invalid') {
    res.status(400).json({
      error: 'interval_time_type must be day, week, month, or year.',
    })
    return
  }

  const intervalCountRaw = req.body?.interval_count
  const intervalCount =
    typeof intervalCountRaw === 'number'
      ? intervalCountRaw
      : typeof intervalCountRaw === 'string'
        ? Number(intervalCountRaw)
        : NaN
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    res.status(400).json({ error: 'interval_count must be an integer >= 1.' })
    return
  }

  const dueParsed = parseDueDate(req.body?.due_date)
  if (dueParsed === 'invalid') {
    res.status(400).json({ error: 'due_date is required (ISO timestamp).' })
    return
  }

  const leadRaw = req.body?.lead_time_days
  const leadNum =
    leadRaw === undefined || leadRaw === null
      ? 0
      : typeof leadRaw === 'number'
        ? leadRaw
        : typeof leadRaw === 'string'
          ? Number(leadRaw)
          : NaN
  if (!Number.isInteger(leadNum) || leadNum < 0) {
    res.status(400).json({
      error: 'lead_time_days must be a non-negative integer.',
    })
    return
  }

  const durRaw = req.body?.planned_duration
  const durNum =
    durRaw === undefined || durRaw === null
      ? 0
      : typeof durRaw === 'number'
        ? durRaw
        : typeof durRaw === 'string'
          ? Number(durRaw)
          : NaN
  if (!Number.isFinite(durNum) || durNum < 0) {
    res.status(400).json({
      error: 'planned_duration must be a non-negative number.',
    })
    return
  }

  if (!planKey || !shortText) {
    res.status(400).json({ error: 'plan_key and short_text are required.' })
    return
  }
  const instructionTrimmed = instructionText.trim()
  if (!instructionTrimmed) {
    res.status(400).json({ error: 'Instruction text cannot be empty.' })
    return
  }
  if (instructionTrimmed.length > 2000) {
    res.status(400).json({
      error: 'Instruction text must be at most 2000 characters.',
    })
    return
  }
  if (!assetIdRaw || !UUID_RE.test(assetIdRaw)) {
    res.status(400).json({ error: 'A valid asset_id is required.' })
    return
  }
  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

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

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const asset = await resolveAssetForWrite(client, assetIdRaw, siteId)
    if (!asset) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error: 'Asset not found or not in your working site.',
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
      `INSERT INTO work_plans (
         site_id, plan_key, short_text, asset_id, costcenter_id, instruction_text,
         planned_duration, interval_count, interval_time_type,
         due_date, next_due_at, lead_time_days,
         category_id, created_by
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7::numeric,
         $8, $9, $10, $10, $11,
         $12, $13
       )
       RETURNING id`,
      [
        siteId,
        planKey.slice(0, 200),
        shortText.slice(0, 200),
        assetIdRaw,
        asset.costcenter_id,
        instructionTrimmed,
        durNum,
        intervalCount,
        intervalParsed,
        dueParsed,
        leadNum,
        nextCategoryId,
        auth.id,
      ],
    )
    const insertedId = r.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }

    await insertWorkInstructionsForPlan(client, insertedId, wiParsed.items)

    const tableRow = await client.query<WorkPlanTableRow>(
      `SELECT id, site_id, plan_key, short_text, asset_id, costcenter_id, instruction_text,
              planned_duration::text, interval_count, interval_time_type,
              due_date, next_due_at, lead_time_days, category_id,
              created_at, updated_at, created_by, updated_by
       FROM work_plans WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit(
      'work_plan',
      rowToAuditRecord(persisted),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'work_plan',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const workPlan = await fetchWorkPlanDetailForResponse(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ work_plan: workPlan! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A work plan with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work plan id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const body = req.body as Record<string, unknown>
  const has = (k: string) => k in body

  if (
    !has('plan_key') &&
    !has('short_text') &&
    !has('instruction_text') &&
    !has('asset_id') &&
    !has('planned_duration') &&
    !has('interval_count') &&
    !has('interval_time_type') &&
    !has('due_date') &&
    !has('lead_time_days') &&
    !has('category_id')
  ) {
    res.status(400).json({ error: 'No fields to update.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkPlanTableRow>(
      `SELECT id, site_id, plan_key, short_text, asset_id, costcenter_id, instruction_text,
              planned_duration::text, interval_count, interval_time_type,
              due_date, next_due_at, lead_time_days, category_id,
              created_at, updated_at, created_by, updated_by
       FROM work_plans
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work plan not found.' })
      return
    }

    let nextPlanKey = beforeRow.plan_key
    let nextShort = beforeRow.short_text
    let nextInstruction = beforeRow.instruction_text
    let nextAssetId = beforeRow.asset_id
    let nextCostcenterId = beforeRow.costcenter_id
    let nextPlannedDuration = Number(beforeRow.planned_duration)
    let nextIntervalCount = beforeRow.interval_count
    let nextIntervalType = beforeRow.interval_time_type
    let nextDueDate = beforeRow.due_date
    let nextNextDue = beforeRow.next_due_at
    let nextLead = beforeRow.lead_time_days
    let nextCategoryId: string | null = beforeRow.category_id

    if (has('plan_key')) {
      const k =
        typeof body.plan_key === 'string' ? body.plan_key.trim() : ''
      if (!k) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'plan_key cannot be empty.' })
        return
      }
      nextPlanKey = k.slice(0, 200)
    }
    if (has('short_text')) {
      const t = typeof body.short_text === 'string' ? body.short_text.trim() : ''
      if (!t) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'short_text cannot be empty.' })
        return
      }
      nextShort = t.slice(0, 200)
    }
    if (has('instruction_text')) {
      const t =
        typeof body.instruction_text === 'string'
          ? body.instruction_text.trim()
          : ''
      if (!t) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Instruction text cannot be empty.' })
        return
      }
      if (t.length > 2000) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Instruction text must be at most 2000 characters.',
        })
        return
      }
      nextInstruction = t
    }
    if (has('asset_id')) {
      const aid =
        typeof body.asset_id === 'string' ? body.asset_id : ''
      if (!aid || !UUID_RE.test(aid)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid asset_id.' })
        return
      }
      const asset = await resolveAssetForWrite(client, aid, beforeRow.site_id)
      if (!asset) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Asset not found or not in this work plan site.',
        })
        return
      }
      nextAssetId = aid
      nextCostcenterId = asset.costcenter_id
    }
    if (has('planned_duration')) {
      const w = body.planned_duration
      const n = typeof w === 'number' ? w : typeof w === 'string' ? Number(w) : NaN
      if (!Number.isFinite(n) || n < 0) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'planned_duration must be a non-negative number.',
        })
        return
      }
      nextPlannedDuration = n
    }
    if (has('interval_count')) {
      const ic = body.interval_count
      const n =
        typeof ic === 'number' ? ic : typeof ic === 'string' ? Number(ic) : NaN
      if (!Number.isInteger(n) || n < 1) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'interval_count must be an integer >= 1.',
        })
        return
      }
      nextIntervalCount = n
    }
    if (has('interval_time_type')) {
      const it = parseIntervalType(body.interval_time_type)
      if (it === 'invalid') {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'interval_time_type must be day, week, month, or year.',
        })
        return
      }
      nextIntervalType = it
    }
    if (has('due_date')) {
      const d = parseDueDate(body.due_date)
      if (d === 'invalid') {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid due_date.' })
        return
      }
      nextDueDate = d
    }
    if (has('lead_time_days')) {
      const l = body.lead_time_days
      const n =
        typeof l === 'number' ? l : typeof l === 'string' ? Number(l) : NaN
      if (!Number.isInteger(n) || n < 0) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'lead_time_days must be a non-negative integer.',
        })
        return
      }
      nextLead = n
    }
    if (has('category_id')) {
      const parsed = parseCategoryId(body)
      if (parsed === 'invalid') {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'category_id must be a valid UUID or null.',
        })
        return
      }
      if (parsed === null) {
        nextCategoryId = null
      } else if (parsed !== undefined) {
        const ok = await categoryBelongsToSite(client, parsed, beforeRow.site_id)
        if (!ok) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'category_id must reference a category for this work plan site.',
          })
          return
        }
        nextCategoryId = parsed
      }
    }

    const anchorOrIntervalChanged =
      (has('due_date') &&
        nextDueDate.getTime() !== beforeRow.due_date.getTime()) ||
      (has('interval_count') && nextIntervalCount !== beforeRow.interval_count) ||
      (has('interval_time_type') &&
        nextIntervalType !== beforeRow.interval_time_type)

    if (anchorOrIntervalChanged) {
      nextNextDue = nextDueDate
    }

    const r = await client.query<WorkPlanTableRow>(
      `UPDATE work_plans SET
         plan_key = $1,
         short_text = $2,
         instruction_text = $3,
         asset_id = $4,
         costcenter_id = $5,
         planned_duration = $6::numeric,
         interval_count = $7,
         interval_time_type = $8,
         due_date = $9,
         next_due_at = $10,
         lead_time_days = $11,
         category_id = $12,
         updated_at = now(),
         updated_by = $13
       WHERE id = $14
       RETURNING id, site_id, plan_key, short_text, asset_id, costcenter_id, instruction_text,
                 planned_duration::text, interval_count, interval_time_type,
                 due_date, next_due_at, lead_time_days, category_id,
                 created_at, updated_at, created_by, updated_by`,
      [
        nextPlanKey,
        nextShort,
        nextInstruction,
        nextAssetId,
        nextCostcenterId,
        nextPlannedDuration,
        nextIntervalCount,
        nextIntervalType,
        nextDueDate,
        nextNextDue,
        nextLead,
        nextCategoryId,
        auth.id,
        id,
      ],
    )
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work plan not found.' })
      return
    }

    const beforeState = redactForAudit(
      'work_plan',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'work_plan',
      rowToAuditRecord(afterTable),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'work_plan',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })

    const workPlan = await fetchWorkPlanDetailForResponse(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ work_plan: workPlan! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'A work plan with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.post('/:id/work-instructions', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid work plan id.' })
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
      `SELECT site_id FROM work_plans WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const row = prev.rows[0]
    if (!row || !canAccessSite(scope, row.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work plan not found.' })
      return
    }
    const ins = await client.query<WorkInstructionDto>(
      `INSERT INTO work_instructions (work_plan_id, sort_nr, instruction_text, done)
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
  if (hasDone) {
    res.status(400).json({ error: 'done cannot be updated on work plan instructions.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lockWo = await client.query<{ site_id: string }>(
      `SELECT p.site_id
       FROM work_plans p
       INNER JOIN work_instructions wi ON wi.work_plan_id = p.id
       WHERE p.id = $1 AND wi.id = $2
       FOR UPDATE`,
      [id, wiId],
    )
    const ok = lockWo.rows[0]
    if (!ok || !canAccessSite(scope, ok.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }

    const upd = await client.query<WorkInstructionDto>(
      `UPDATE work_instructions SET
         sort_nr = COALESCE($1, sort_nr),
         instruction_text = COALESCE($2, instruction_text)
       WHERE id = $3 AND work_plan_id = $4
       RETURNING id, sort_nr, instruction_text, done`,
      [nextSort ?? null, nextText ?? null, wiId, id],
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
      `SELECT p.site_id
       FROM work_instructions wi
       INNER JOIN work_plans p ON p.id = wi.work_plan_id
       WHERE wi.id = $1 AND wi.work_plan_id = $2`,
      [wiId, id],
    )
    const row = prev.rows[0]
    if (!row || !canAccessSite(scope, row.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found.' })
      return
    }
    await client.query(
      `DELETE FROM work_instructions WHERE id = $1 AND work_plan_id = $2`,
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
    res.status(400).json({ error: 'Invalid work plan id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkPlanTableRow>(
      `SELECT id, site_id, plan_key, short_text, asset_id, costcenter_id, instruction_text,
              planned_duration::text, interval_count, interval_time_type,
              due_date, next_due_at, lead_time_days, category_id,
              created_at, updated_at, created_by, updated_by
       FROM work_plans
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work plan not found.' })
      return
    }

    await client.query(`DELETE FROM work_plans WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'work_plan',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'work_plan',
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

export function generatorActorSystem(): GeneratorActor {
  return {
    userId: null,
    loginName: 'system',
    name: 'System',
  }
}
