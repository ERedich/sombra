import type { Pool, PoolClient } from 'pg'
import { broadcastWorkOrderCreated } from '../realtime/workOrderSocket.js'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
} from '../audit/auditLog.js'
import {
  addIntervalUtc,
  isDueForGeneration,
  planEndFromStartAndDurationHours,
  type IntervalTimeType,
} from './intervalUtc.js'

const MAX_WO_PER_PLAN_PER_RUN = 50

type WorkPlanGenRow = {
  id: string
  site_id: string
  plan_key: string
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  interval_count: number
  interval_time_type: IntervalTimeType
  next_due_at: Date
  lead_time_days: number
  planned_duration: string
}

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
  work_type_id: string
  status: string
  work_plan_id: string | null
  work_plan_key: string | null
  planned_duration: string
  category_id: string | null
  workgroup_id: string
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

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
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

function rowToWoAudit(row: WorkOrderTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

function rowToWpAudit(row: WorkPlanTableRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>
}

const LIST_WO_SQL = `
SELECT w.id, w.site_id, w.wo_key, w.short_text, w.asset_id, w.costcenter_id,
       w.instruction_text, w.plan_start, w.plan_end, w.work_type_id, w.status,
       w.work_plan_id, w.work_plan_key, w.planned_duration, w.category_id, w.workgroup_id,
       w.created_at, w.updated_at, w.created_by, w.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       a.key AS asset_key, a.name AS asset_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name,
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
`

async function fetchWorkOrderWithJoins(
  client: PoolClient,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await client.query(`${LIST_WO_SQL} WHERE w.id = $1`, [id])
  return r.rows[0] as Record<string, unknown> | undefined
}

export type GeneratorActor = {
  userId: string | null
  loginName: string
  name: string
}

export type GenerateDueResult = {
  generated: number
  plans_advanced: number
}

/**
 * UTC calendar date comparison: today >= date(next_due_at) - lead_time_days.
 * Matches `isDueForGeneration` in intervalUtc.ts.
 */
const DUE_SQL = `(timezone('UTC', now()))::date >= (timezone('UTC', work_plans.next_due_at))::date - work_plans.lead_time_days`

/**
 * Creates PM work orders from work plans whose due window is open, advances
 * next_due_at by the plan interval (up to MAX_WO_PER_PLAN_PER_RUN per plan).
 */
export async function runWorkPlanGenerator(
  pool: Pool,
  actor: GeneratorActor,
): Promise<GenerateDueResult> {
  let generated = 0
  let plans_advanced = 0

  for (;;) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const sel = await client.query<WorkPlanGenRow>(
        `SELECT id, site_id, plan_key, short_text, asset_id, costcenter_id,
                instruction_text, planned_duration::text,
                interval_count, interval_time_type::text,
                next_due_at, lead_time_days
         FROM work_plans
         WHERE next_due_at IS NOT NULL
           AND ${DUE_SQL}
         ORDER BY next_due_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      )
      const wp = sel.rows[0]
      if (!wp) {
        await client.query('COMMIT')
        break
      }

      const durationNum = Number(wp.planned_duration)
      if (!Number.isFinite(durationNum) || durationNum < 0) {
        await client.query('ROLLBACK')
        throw new Error('Invalid planned_duration on work plan.')
      }

      const intervalType = wp.interval_time_type
      let currentNext = new Date(wp.next_due_at)
      let iterations = 0

      while (
        iterations < MAX_WO_PER_PLAN_PER_RUN &&
        isDueForGeneration(currentNext, wp.lead_time_days)
      ) {
        const planStart = new Date(currentNext)
        const planEnd = planEndFromStartAndDurationHours(
          planStart,
          durationNum,
        )

        const ins = await client.query<{ id: string }>(
          `INSERT INTO work_orders (
             site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
             plan_start, plan_end, work_type_id, status,
             work_plan_id, work_plan_key, planned_duration,
             workgroup_id,
             created_by
           )
           VALUES (
             $1, nextval('work_order_wo_key_seq'), $2, $3, $4, $5,
             $6, $7,
             (SELECT id FROM work_types WHERE site_id = $1 AND key = 'PM' LIMIT 1),
             'open',
             $8, $9, $10::numeric,
             (SELECT id FROM workgroups WHERE site_id = $1 AND key = '_DEFAULT' LIMIT 1),
             $11
           )
           RETURNING id`,
          [
            wp.site_id,
            wp.short_text,
            wp.asset_id,
            wp.costcenter_id,
            wp.instruction_text,
            planStart,
            planEnd,
            wp.id,
            wp.plan_key,
            durationNum,
            actor.userId,
          ],
        )
        const woId = ins.rows[0]?.id
        if (!woId) {
          await client.query('ROLLBACK')
          throw new Error('Work order insert failed.')
        }

        await client.query(
          `INSERT INTO work_instructions (work_order_id, sort_nr, instruction_text, done)
           SELECT $1::uuid, wi.sort_nr, wi.instruction_text, false
           FROM work_instructions wi
           WHERE wi.work_plan_id = $2::uuid`,
          [woId, wp.id],
        )

        const tableRow = await client.query<WorkOrderTableRow>(
          `SELECT id, site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
                  plan_start, plan_end, work_type_id, status,
                  work_plan_id, work_plan_key, planned_duration, category_id, workgroup_id,
                  created_at, updated_at, created_by, updated_by
           FROM work_orders WHERE id = $1`,
          [woId],
        )
        const persisted = tableRow.rows[0]!
        const afterWo = redactForAudit('work_order', rowToWoAudit(persisted))
        await writeAudit(client, {
          actorUserId: actor.userId,
          actorKey: actor.loginName,
          actorName: actor.name,
          operation: 'create',
          resourceType: 'work_order',
          resourceId: persisted.id,
          beforeState: null,
          afterState: afterWo,
          fieldChanges: null,
          httpMethod: 'POST',
          path: '/api/work-plans/generate-due',
        })

        const workOrder = await fetchWorkOrderWithJoins(client, woId)
        if (workOrder) {
          broadcastWorkOrderCreated(
            workOrder as { site_id: string } & Record<string, unknown>,
          )
        }
        generated += 1

        const beforeWpRes = await client.query<WorkPlanTableRow>(
          `SELECT id, site_id, plan_key, short_text, asset_id, costcenter_id,
                  instruction_text, planned_duration::text,
                  interval_count, interval_time_type::text,
                  due_date, next_due_at, lead_time_days,
                  created_at, updated_at, created_by, updated_by
           FROM work_plans WHERE id = $1`,
          [wp.id],
        )
        const beforeWp = beforeWpRes.rows[0]!

        const advanced = addIntervalUtc(
          currentNext,
          wp.interval_count,
          intervalType,
        )

        const upd = await client.query<WorkPlanTableRow>(
          `UPDATE work_plans SET
             next_due_at = $1,
             updated_at = now(),
             updated_by = $2
           WHERE id = $3
           RETURNING id, site_id, plan_key, short_text, asset_id, costcenter_id,
                     instruction_text, planned_duration::text,
                     interval_count, interval_time_type::text,
                     due_date, next_due_at, lead_time_days,
                     created_at, updated_at, created_by, updated_by`,
          [advanced, actor.userId, wp.id],
        )
        const afterWp = upd.rows[0]
        if (!afterWp) {
          await client.query('ROLLBACK')
          throw new Error('Work plan update failed.')
        }
        plans_advanced += 1

        const beforeState = redactForAudit('work_plan', rowToWpAudit(beforeWp))
        const afterState = redactForAudit('work_plan', rowToWpAudit(afterWp))
        const changes =
          beforeState && afterState ? fieldChanges(beforeState, afterState) : null
        await writeAudit(client, {
          actorUserId: actor.userId,
          actorKey: actor.loginName,
          actorName: actor.name,
          operation: 'update',
          resourceType: 'work_plan',
          resourceId: wp.id,
          beforeState,
          afterState,
          fieldChanges: changes,
          httpMethod: 'POST',
          path: '/api/work-plans/generate-due',
        })

        currentNext = advanced
        iterations += 1
        if (!isDueForGeneration(currentNext, wp.lead_time_days)) {
          break
        }
      }

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  return { generated, plans_advanced }
}
