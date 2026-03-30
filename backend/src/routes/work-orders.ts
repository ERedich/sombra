import { Router } from 'express'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
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
  status: string
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
       w.instruction_text, w.plan_start, w.plan_end, w.worktime, w.status,
       w.created_at, w.updated_at, w.created_by, w.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       a.key AS asset_key, a.name AS asset_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM work_orders w
INNER JOIN sites st ON st.id = w.site_id
INNER JOIN assets a ON a.id = w.asset_id
LEFT JOIN costcenters cc ON cc.id = w.costcenter_id
LEFT JOIN users cb ON cb.id = w.created_by
LEFT JOIN users ub ON ub.id = w.updated_by
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
  res.json({ work_order: row })
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
  const planEnd = parseOptionalInstant(req.body, 'plan_end')
  if (planStart === undefined && req.body?.plan_start !== undefined) {
    res.status(400).json({ error: 'Invalid plan_start.' })
    return
  }
  if (planEnd === undefined && req.body?.plan_end !== undefined) {
    res.status(400).json({ error: 'Invalid plan_end.' })
    return
  }
  const ps = planStart === undefined ? null : planStart
  const pe = planEnd === undefined ? null : planEnd

  if (ps != null && pe != null && pe.getTime() < ps.getTime()) {
    res.status(400).json({ error: 'plan_end must be on or after plan_start.' })
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

    const r = await client.query<{ id: string }>(
      `INSERT INTO work_orders (
         site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
         plan_start, plan_end, worktime, status, created_by
       )
       VALUES (
         $1, nextval('work_order_wo_key_seq'), $2, $3, $4, $5,
         $6, $7, $8, 'open', $9
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
              plan_start, plan_end, worktime, status,
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
    const workOrder = await fetchWorkOrderWithJoins(client, insertedId)
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
  const planEndOpt = parseOptionalInstant(req.body, 'plan_end')

  if (
    shortTextOpt === undefined &&
    instructionTextOpt === undefined &&
    assetIdOpt === undefined &&
    worktimeOpt === undefined &&
    planStartOpt === undefined &&
    planEndOpt === undefined
  ) {
    res.status(400).json({ error: 'No fields to update.' })
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
  if (planEndOpt === undefined && req.body?.plan_end !== undefined) {
    res.status(400).json({ error: 'Invalid plan_end.' })
    return
  }

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<WorkOrderTableRow>(
      `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
              plan_start, plan_end, worktime, status,
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

    let nextShort = beforeRow.short_text
    let nextInstruction = beforeRow.instruction_text
    let nextAssetId = beforeRow.asset_id
    let nextCostcenterId = beforeRow.costcenter_id
    let nextPlanStart = beforeRow.plan_start
    let nextPlanEnd = beforeRow.plan_end
    let nextWorktime = beforeRow.worktime

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
    if (planEndOpt !== undefined) {
      nextPlanEnd = planEndOpt
    }

    const ps = nextPlanStart
    const pe = nextPlanEnd
    if (ps != null && pe != null && pe.getTime() < ps.getTime()) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'plan_end must be on or after plan_start.' })
      return
    }

    const r = await client.query<WorkOrderTableRow>(
      `UPDATE work_orders SET
         short_text = $1,
         instruction_text = $2,
         asset_id = $3,
         costcenter_id = $4,
         plan_start = $5,
         plan_end = $6,
         worktime = $7,
         updated_at = now(),
         updated_by = $8
       WHERE id = $9
       RETURNING id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                 plan_start, plan_end, worktime, status,
                 created_at, updated_at, created_by, updated_by`,
      [
        nextShort,
        nextInstruction,
        nextAssetId,
        nextCostcenterId,
        nextPlanStart,
        nextPlanEnd,
        nextWorktime,
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

    const workOrder = await fetchWorkOrderWithJoins(client, afterTable.id)
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
              plan_start, plan_end, worktime, status,
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
