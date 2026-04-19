import { isKiraUuid } from '@sombra/shared'
import type { Pool } from 'pg'
import {
  getWoStartRequiresAssignment,
  getWoUserAutoAssignOnStart,
} from '../services/appSettings.js'
import { getWorkOrderDetailsForSite } from './copilotContext.js'

export type CopilotFeedbackEntry = {
  employee_id: string
  employee_key: string
  employee_name: string
  hours: number
  feedback_text: string
}

export type CopilotFeedbackPrepareOk = {
  ok: true
  work_order_id: string
  wo_key: number
  short_text: string
  wo_status: string
  payload: {
    entries: Array<{
      employee_id: string
      hours: number
      feedback_text: string
    }>
    target_status: 'on_hold' | 'done' | null
    hold_reason: string | null
  }
  summary: {
    entries: CopilotFeedbackEntry[]
    target_status: 'on_hold' | 'done' | null
    hold_reason: string | null
    total_hours: number
  }
}

export type CopilotFeedbackPrepareResult =
  | CopilotFeedbackPrepareOk
  | { ok: false; error: string }

/**
 * Validates body for POST /api/work-orders/:id/actions/feedback. Mirrors the
 * server's own parser (entries[] with employee_id + feedback_text + hours;
 * optional target_status in {on_hold, done}; hold_reason required + non-empty
 * when target_status === on_hold) and also mirrors the same employee-
 * eligibility rules the POST handler enforces via
 * `ensureEmployeeAllowedForFeedbackEntry`:
 *
 *   1. If the employee is already in `work_order_employees` → OK (no further check).
 *   2. Else if SWB (`wo_start_requires_assignment`) is on → reject with
 *      "must already be assigned".
 *   3. Else if UAA (`wo_user_auto_assign_on_start`) is off → only the actor's
 *      own linked employee is allowed.
 *   4. Else (SWB off + UAA on) → employee must be on the same site as the WO
 *      and, **when the WO has a workgroup_id**, must be a member of that
 *      workgroup in `workgroup_employees`. (The POST will then auto-assign.)
 *
 * Pre-validating here avoids the "Kira confirms → server rejects" mismatch
 * and matches how `prepare_set_capacity_allocation` enforces the same
 * workgroup rule for the Kapazitätsplaner.
 */
export async function validatePrepareWoFeedback(
  pool: Pool,
  siteId: string,
  actorEmployeeId: string | null,
  raw: Record<string, unknown>,
): Promise<CopilotFeedbackPrepareResult> {
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
    return {
      ok: false,
      error: 'Provide work_order_id (UUID) or wo_key (positive integer).',
    }
  }
  if (idIn && !isKiraUuid(idIn)) {
    return { ok: false, error: 'work_order_id must be a valid UUID.' }
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
  if (wo.status !== 'started' && wo.status !== 'continued') {
    return {
      ok: false,
      error: `Feedback (Rückmeldung) is only allowed when the work order is 'started' or 'continued'. Current status: ${wo.status}. Start the WO first (from the app).`,
    }
  }

  const rawEntries = raw.entries
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return { ok: false, error: 'entries must be a non-empty array.' }
  }
  if (rawEntries.length > 50) {
    return { ok: false, error: 'Too many entries (max 50 per feedback call).' }
  }

  const payloadEntries: Array<{
    employee_id: string
    hours: number
    feedback_text: string
  }> = []
  const employeeIds = new Set<string>()
  for (const el of rawEntries) {
    if (typeof el !== 'object' || el === null) {
      return { ok: false, error: 'Each entry must be an object.' }
    }
    const e = el as Record<string, unknown>
    const eid = typeof e.employee_id === 'string' ? e.employee_id.trim() : ''
    if (!eid || !isKiraUuid(eid)) {
      return { ok: false, error: 'Each entry needs a valid employee_id (UUID).' }
    }
    const ftRaw = e.feedback_text
    const ft =
      typeof ftRaw === 'string'
        ? ftRaw.trim()
        : ftRaw === null || ftRaw === undefined
          ? ''
          : null
    if (ft === null) {
      return { ok: false, error: 'feedback_text must be a string if provided.' }
    }
    if (ft.length > 10000) {
      return { ok: false, error: 'feedback_text must be at most 10000 chars.' }
    }
    const hRaw = e.hours
    const hours =
      typeof hRaw === 'number'
        ? hRaw
        : typeof hRaw === 'string' && hRaw.trim() !== ''
          ? Number(hRaw)
          : NaN
    if (!Number.isFinite(hours) || hours < 0) {
      return {
        ok: false,
        error: 'Each entry needs a non-negative numeric hours value.',
      }
    }
    if (ft === '' && hours <= 0) {
      return {
        ok: false,
        error:
          'Each entry needs feedback_text or hours > 0 (at least one must be provided).',
      }
    }
    payloadEntries.push({
      employee_id: eid,
      hours,
      feedback_text: ft,
    })
    employeeIds.add(eid)
  }

  const empR = await pool.query<{
    id: string
    key: string
    name: string
    site_id: string
  }>(
    `SELECT id::text AS id, key, name, site_id::text AS site_id
       FROM employees
      WHERE id = ANY($1::uuid[])`,
    [Array.from(employeeIds)],
  )
  const empById = new Map<string, { key: string; name: string; site_id: string }>()
  for (const row of empR.rows) {
    empById.set(row.id, { key: row.key, name: row.name, site_id: row.site_id })
  }
  for (const id of employeeIds) {
    const emp = empById.get(id)
    if (!emp) {
      return {
        ok: false,
        error: `Employee ${id} not found.`,
      }
    }
    if (emp.site_id !== siteId) {
      return {
        ok: false,
        error: `Employee ${emp.key} (${emp.name}) is not on the current working site.`,
      }
    }
  }

  const employeeIdArr = Array.from(employeeIds)
  const assignedR = await pool.query<{ employee_id: string }>(
    `SELECT employee_id::text AS employee_id
       FROM work_order_employees
      WHERE work_order_id = $1::uuid
        AND employee_id = ANY($2::uuid[])`,
    [wo.id, employeeIdArr],
  )
  const alreadyAssigned = new Set<string>(
    assignedR.rows.map((r) => r.employee_id),
  )

  const swb = await getWoStartRequiresAssignment(pool)
  const uaa = await getWoUserAutoAssignOnStart(pool)

  const wgIdRaw = wo.workgroup_id
  const woWorkgroupId =
    typeof wgIdRaw === 'string' && isKiraUuid(wgIdRaw.trim())
      ? wgIdRaw.trim()
      : null

  let wgMembers: Set<string> | null = null
  if (woWorkgroupId) {
    const unassignedIds = employeeIdArr.filter((id) => !alreadyAssigned.has(id))
    if (unassignedIds.length > 0) {
      const mR = await pool.query<{ employee_id: string }>(
        `SELECT employee_id::text AS employee_id
           FROM workgroup_employees
          WHERE workgroup_id = $1::uuid
            AND employee_id = ANY($2::uuid[])`,
        [woWorkgroupId, unassignedIds],
      )
      wgMembers = new Set<string>(mR.rows.map((r) => r.employee_id))
    } else {
      wgMembers = new Set<string>()
    }
  }

  for (const id of employeeIdArr) {
    const emp = empById.get(id)!
    if (alreadyAssigned.has(id)) continue
    if (swb) {
      return {
        ok: false,
        error: `Employee ${emp.key} (${emp.name}) is not assigned to WO ${wo.wo_key}, and site setting 'wo_start_requires_assignment' (SWB) is on — only already-assigned employees can submit feedback. Add them to the WO's assigned list first (from the app).`,
      }
    }
    if (!uaa) {
      if (!actorEmployeeId || actorEmployeeId !== id) {
        return {
          ok: false,
          error: `Employee ${emp.key} (${emp.name}) is not assigned to WO ${wo.wo_key}. With SWB off and 'wo_user_auto_assign_on_start' (UAA) also off, only the acting user's own linked employee may submit feedback for an unassigned person. Either assign ${emp.key} to the WO first, or restrict the Rückmeldung to the acting user's own entry.`,
        }
      }
      continue
    }
    if (woWorkgroupId && wgMembers && !wgMembers.has(id)) {
      return {
        ok: false,
        error: `Employee ${emp.key} (${emp.name}) is not a member of the workgroup assigned to WO ${wo.wo_key} (workgroup_id ${woWorkgroupId}). When a WO has a workgroup and the employee is not already on the WO's assigned list, only members of that workgroup may report feedback (UAA auto-assign rule).`,
      }
    }
  }

  const tsRaw = raw.target_status
  let targetStatus: 'on_hold' | 'done' | null = null
  if (tsRaw === undefined || tsRaw === null || tsRaw === '') {
    targetStatus = null
  } else if (tsRaw === 'on_hold' || tsRaw === 'done') {
    targetStatus = tsRaw
  } else {
    return {
      ok: false,
      error: "target_status must be 'on_hold', 'done', or omitted.",
    }
  }

  let holdReason: string | null = null
  if (typeof raw.hold_reason === 'string') {
    const hr = raw.hold_reason.trim()
    holdReason = hr === '' ? null : hr
  } else if (raw.hold_reason !== undefined && raw.hold_reason !== null) {
    return { ok: false, error: 'hold_reason must be a string.' }
  }
  if (targetStatus === 'on_hold') {
    if (!holdReason) {
      return {
        ok: false,
        error: 'hold_reason is required when target_status is on_hold.',
      }
    }
    if (holdReason.length > 2000) {
      return { ok: false, error: 'hold_reason must be at most 2000 chars.' }
    }
  }

  const summaryEntries: CopilotFeedbackEntry[] = payloadEntries.map((e) => {
    const emp = empById.get(e.employee_id)!
    return {
      employee_id: e.employee_id,
      employee_key: emp.key,
      employee_name: emp.name,
      hours: e.hours,
      feedback_text: e.feedback_text,
    }
  })
  const totalHours = summaryEntries.reduce((acc, e) => acc + e.hours, 0)

  return {
    ok: true,
    work_order_id: wo.id,
    wo_key: wo.wo_key,
    short_text: wo.short_text,
    wo_status: wo.status,
    payload: {
      entries: payloadEntries,
      target_status: targetStatus,
      hold_reason: targetStatus === 'on_hold' ? holdReason : null,
    },
    summary: {
      entries: summaryEntries,
      target_status: targetStatus,
      hold_reason: targetStatus === 'on_hold' ? holdReason : null,
      total_hours: totalHours,
    },
  }
}
