import { isKiraUuid } from '@sombra/shared'
import type { Pool } from 'pg'
import { getShiftAppSettings, getWoAppSettings } from '../services/appSettings.js'
import {
  roundPlannedHours,
  shiftHoursOnAssignmentDay,
  woOverlapsAnyShiftFirstSegmentUtc,
} from '../services/capacityPlanning.js'
import { getWorkOrderDetailsForSite } from './copilotContext.js'

const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/

function utcCalendarYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export type CopilotCapacityAllocationPrepareOk = {
  ok: true
  work_order_id: string
  wo_key: number
  short_text: string
  employee_key: string
  employee_name: string
  payload: {
    employee_id: string
    allocation_date: string
    planned_hours: number
  }
}

export type CopilotCapacityAllocationPrepareResult =
  | CopilotCapacityAllocationPrepareOk
  | { ok: false; error: string }

/**
 * Same business rules as PUT /api/work-orders/:id/capacity-allocation (planned_hours > 0).
 * For planned_hours === 0 (clear allocation), only WO + employee UUID + date format are required.
 */
export async function validatePrepareSetCapacityAllocation(
  pool: Pool,
  siteId: string,
  raw: Record<string, unknown>,
): Promise<CopilotCapacityAllocationPrepareResult> {
  const idRaw = raw.work_order_id
  const keyRaw = raw.wo_key
  const idIn = typeof idRaw === 'string' ? idRaw.trim() : ''
  const woKey =
    typeof keyRaw === 'number' && Number.isFinite(keyRaw)
      ? Math.trunc(keyRaw)
      : typeof keyRaw === 'string' && /^\d+$/.test(keyRaw.trim())
        ? Number.parseInt(keyRaw.trim(), 10)
        : null
  if (!idIn && (woKey === null || woKey <= 0)) {
    return { ok: false, error: 'Provide work_order_id (UUID) or wo_key (positive integer).' }
  }
  if (idIn && !isKiraUuid(idIn)) {
    return { ok: false, error: 'work_order_id must be a valid UUID.' }
  }

  const employeeId =
    typeof raw.employee_id === 'string' ? raw.employee_id.trim() : ''
  if (!employeeId || !isKiraUuid(employeeId)) {
    return { ok: false, error: 'employee_id must be a valid UUID.' }
  }

  const adRaw =
    typeof raw.allocation_date === 'string' ? raw.allocation_date.trim() : ''
  if (!DATE_YMD_RE.test(adRaw)) {
    return { ok: false, error: 'allocation_date must be YYYY-MM-DD.' }
  }

  const plannedRaw = raw.planned_hours
  const plannedHours =
    typeof plannedRaw === 'number'
      ? plannedRaw
      : typeof plannedRaw === 'string' && plannedRaw.trim() !== ''
        ? Number(plannedRaw)
        : NaN
  if (!Number.isFinite(plannedHours) || plannedHours < 0) {
    return { ok: false, error: 'planned_hours must be a non-negative number.' }
  }

  const wo = await getWorkOrderDetailsForSite(pool, siteId, {
    id: idIn || null,
    wo_key: woKey,
  })
  if (!wo) {
    return {
      ok: false,
      error:
        'Work order not found on this working site. Check wo_key / id or switch site.',
    }
  }

  const empR = await pool.query<{ key: string; name: string; site_id: string }>(
    `SELECT key, name, site_id::text AS site_id FROM employees WHERE id = $1::uuid`,
    [employeeId],
  )
  const emp = empR.rows[0]
  if (!emp || emp.site_id !== siteId) {
    return {
      ok: false,
      error: 'Employee not found on this working site.',
    }
  }

  if (plannedHours === 0) {
    return {
      ok: true,
      work_order_id: wo.id,
      wo_key: wo.wo_key,
      short_text: wo.short_text,
      employee_key: emp.key,
      employee_name: emp.name,
      payload: {
        employee_id: employeeId,
        allocation_date: adRaw,
        planned_hours: 0,
      },
    }
  }

  if (!wo.plan_start || !wo.plan_end) {
    return {
      ok: false,
      error:
        'This work order has no planned start and end; capacity cannot be assigned.',
    }
  }

  const planStart = new Date(wo.plan_start)
  const planEnd = new Date(wo.plan_end)
  if (Number.isNaN(planStart.getTime()) || Number.isNaN(planEnd.getTime())) {
    return { ok: false, error: 'Work order plan_start / plan_end are invalid.' }
  }

  const psY = utcCalendarYmd(planStart)
  const peY = utcCalendarYmd(planEnd)
  if (adRaw < psY || adRaw > peY) {
    return {
      ok: false,
      error:
        'allocation_date must fall on a calendar day within the work order plan period (UTC).',
    }
  }

  if (wo.workgroup_id) {
    const memberR = await pool.query(
      `SELECT 1 FROM workgroup_employees
       WHERE workgroup_id = $1::uuid AND employee_id = $2::uuid`,
      [wo.workgroup_id, employeeId],
    )
    if (memberR.rows.length === 0) {
      return {
        ok: false,
        error:
          'When a workgroup is set, only employees assigned to that workgroup can be allocated.',
      }
    }
  }

  const shiftsR = await pool.query<{
    time_start: string
    time_end: string
  }>(
    `SELECT COALESCE(sa.override_time_start, sh.time_start)::text AS time_start,
            COALESCE(sa.override_time_end, sh.time_end)::text AS time_end
       FROM shift_assignments sa
       INNER JOIN shifts sh ON sh.id = sa.shift_id
      WHERE sa.employee_id = $1::uuid
        AND sa.assignment_date = $2::date`,
    [employeeId, adRaw],
  )
  if (shiftsR.rows.length === 0) {
    return {
      ok: false,
      error: 'This employee has no shift assignment on the chosen date.',
    }
  }

  if (
    !woOverlapsAnyShiftFirstSegmentUtc(
      planStart,
      planEnd,
      adRaw,
      shiftsR.rows,
    )
  ) {
    return {
      ok: false,
      error:
        'Work order planned time does not overlap any shift on this date (UTC).',
    }
  }

  const shiftSettings = await getShiftAppSettings(pool)
  const spcFrac = shiftSettings.shift_planning_capacity_pct / 100
  let capHours = 0
  for (const row of shiftsR.rows) {
    capHours +=
      shiftHoursOnAssignmentDay(row.time_start, row.time_end) * spcFrac
  }

  const oldR = await pool.query<{ planned_hours: string }>(
    `SELECT planned_hours::text FROM work_order_capacity_allocations
      WHERE work_order_id = $1::uuid AND employee_id = $2::uuid AND allocation_date = $3::date`,
    [wo.id, employeeId, adRaw],
  )
  const oldHours = oldR.rows[0] ? Number(oldR.rows[0].planned_hours) : 0

  const sumR = await pool.query<{ s: string }>(
    `SELECT COALESCE(SUM(planned_hours), 0)::text AS s
       FROM work_order_capacity_allocations
      WHERE employee_id = $1::uuid AND allocation_date = $2::date`,
    [employeeId, adRaw],
  )
  const totalBeforeNew = Number(sumR.rows[0]?.s ?? 0)
  const totalAfter = totalBeforeNew - oldHours + plannedHours

  const woAppForPhr = await getWoAppSettings(pool)
  if (
    woAppForPhr.planned_hours_restriction &&
    roundPlannedHours(totalAfter) > roundPlannedHours(capHours)
  ) {
    return {
      ok: false,
      error: `Planned hours exceed shift planning capacity for this date (${capHours.toFixed(2)} h under SPC).`,
    }
  }

  return {
    ok: true,
    work_order_id: wo.id,
    wo_key: wo.wo_key,
    short_text: wo.short_text,
    employee_key: emp.key,
    employee_name: emp.name,
    payload: {
      employee_id: employeeId,
      allocation_date: adRaw,
      planned_hours: plannedHours,
    },
  }
}
