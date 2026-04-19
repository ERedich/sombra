import { isKiraUuid } from '@sombra/shared'
import type { Pool } from 'pg'
import {
  getWoStartRequiresAssignment,
  getWoUserAutoAssignOnStart,
  getWoAllowMultipleStartedWorkOrders,
} from '../services/appSettings.js'
import { getWorkOrderDetailsForSite } from './copilotContext.js'

export type CopilotWoStartPrepareOk = {
  ok: true
  work_order_id: string
  wo_key: number
  short_text: string
  current_status: string
  next_status: 'started' | 'continued'
  workgroup_id: string | null
}

export type CopilotWoHoldPrepareOk = {
  ok: true
  work_order_id: string
  wo_key: number
  short_text: string
  current_status: string
  reason: string
}

export type CopilotWoStartPrepareResult =
  | CopilotWoStartPrepareOk
  | { ok: false; error: string }
export type CopilotWoHoldPrepareResult =
  | CopilotWoHoldPrepareOk
  | { ok: false; error: string }

function parseWoIdent(
  raw: Record<string, unknown>,
): { ok: true; id: string; woKey: number | null } | { ok: false; error: string } {
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
  return { ok: true, id: idIn, woKey }
}

/**
 * Validates the pre-conditions the server enforces in
 * `POST /api/work-orders/:id/actions/start`. Mirrors:
 *   - WO must exist on the working site.
 *   - Current status ∈ {open, assigned, on_hold}.
 *   - Acting user must be linked to an employee (actorEmployeeId).
 *   - If WO has a workgroup → actor employee must be a member.
 *   - If SWB (`wo_start_requires_assignment`) is on → actor employee must
 *     already be assigned to the WO.
 *   - If PSH (`wo_allow_multiple_started_work_orders`) is off → actor must
 *     not already have another WO in `started` / `continued`.
 * UAA auto-assign is handled silently by the POST; not a precondition here.
 */
export async function validatePrepareWoStart(
  pool: Pool,
  siteId: string,
  actorEmployeeId: string | null,
  raw: Record<string, unknown>,
): Promise<CopilotWoStartPrepareResult> {
  const ident = parseWoIdent(raw)
  if (!ident.ok) return ident

  const wo = await getWorkOrderDetailsForSite(pool, siteId, {
    id: ident.id || null,
    wo_key: ident.woKey,
  })
  if (!wo) {
    return {
      ok: false,
      error:
        'Work order not found on this working site. Check wo_key / id or switch site.',
    }
  }

  const allowedFrom = new Set(['open', 'assigned', 'on_hold'])
  if (!allowedFrom.has(wo.status)) {
    return {
      ok: false,
      error: `Start is only allowed when the work order is open, assigned, or on hold. Current status: ${wo.status}.`,
    }
  }

  if (!actorEmployeeId) {
    return {
      ok: false,
      error:
        'Your user account must be linked to an employee to start a work order. Ask an admin to link your user to an employee row first.',
    }
  }

  const wgIdRaw = wo.workgroup_id
  const woWorkgroupId =
    typeof wgIdRaw === 'string' && isKiraUuid(wgIdRaw.trim())
      ? wgIdRaw.trim()
      : null
  if (woWorkgroupId) {
    const r = await pool.query<{ employee_id: string }>(
      `SELECT employee_id::text AS employee_id
         FROM workgroup_employees
        WHERE workgroup_id = $1::uuid
          AND employee_id = $2::uuid
        LIMIT 1`,
      [woWorkgroupId, actorEmployeeId],
    )
    if ((r.rowCount ?? 0) === 0) {
      return {
        ok: false,
        error: `Your linked employee is not a member of WO ${wo.wo_key}'s workgroup (workgroup_id ${woWorkgroupId}). Only workgroup members can start this WO.`,
      }
    }
  }

  const swb = await getWoStartRequiresAssignment(pool)
  if (swb) {
    const r = await pool.query<{ work_order_id: string }>(
      `SELECT work_order_id::text AS work_order_id
         FROM work_order_employees
        WHERE work_order_id = $1::uuid
          AND employee_id = $2::uuid
        LIMIT 1`,
      [wo.id, actorEmployeeId],
    )
    if ((r.rowCount ?? 0) === 0) {
      return {
        ok: false,
        error: `Site setting wo_start_requires_assignment (SWB) is on, and your linked employee is not on WO ${wo.wo_key}'s assigned list. Add your employee to the WO first (from the app).`,
      }
    }
  }

  const allowMultipleStarted =
    await getWoAllowMultipleStartedWorkOrders(pool)
  if (!allowMultipleStarted) {
    const conflict = await pool.query<{ wo_key: number; short_text: string }>(
      `SELECT w.wo_key, w.short_text
         FROM work_orders w
         INNER JOIN work_order_employees woe
           ON woe.work_order_id = w.id
          AND woe.employee_id = $1::uuid
        WHERE w.id <> $2::uuid
          AND w.site_id = $3::uuid
          AND w.status IN ('started', 'continued')
        LIMIT 1`,
      [actorEmployeeId, wo.id, siteId],
    )
    if ((conflict.rowCount ?? 0) > 0) {
      const c = conflict.rows[0]!
      return {
        ok: false,
        error: `You already have another work order in Started or Continued status (WO ${c.wo_key} — ${c.short_text}). Site setting wo_allow_multiple_started_work_orders is off. Finish or hold that WO before starting another.`,
      }
    }
  }

  const nextStatus: 'started' | 'continued' =
    wo.status === 'on_hold' ? 'continued' : 'started'

  // UAA is advisory for Kira — if UAA is off and SWB is also off and the
  // actor is not on the WO, the server still allows Start (creating no
  // auto-assignment row). No hard precondition here; surface it via the
  // UAA read only if we need a warning in the future.
  void (await getWoUserAutoAssignOnStart(pool))

  return {
    ok: true,
    work_order_id: wo.id,
    wo_key: wo.wo_key,
    short_text: wo.short_text,
    current_status: wo.status,
    next_status: nextStatus,
    workgroup_id: woWorkgroupId,
  }
}

/**
 * Validates the body and pre-conditions the server enforces in
 * `POST /api/work-orders/:id/actions/hold`:
 *   - WO exists on the working site.
 *   - Current status ∈ {started, continued}.
 *   - `reason` is a trimmed, non-empty string up to 2000 chars.
 */
export async function validatePrepareWoHold(
  pool: Pool,
  siteId: string,
  raw: Record<string, unknown>,
): Promise<CopilotWoHoldPrepareResult> {
  const ident = parseWoIdent(raw)
  if (!ident.ok) return ident

  const wo = await getWorkOrderDetailsForSite(pool, siteId, {
    id: ident.id || null,
    wo_key: ident.woKey,
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
      error: `Hold is only allowed when the work order is 'started' or 'continued'. Current status: ${wo.status}.`,
    }
  }

  const reasonRaw = raw.reason
  if (typeof reasonRaw !== 'string') {
    return { ok: false, error: 'reason is required (string, non-empty).' }
  }
  const reason = reasonRaw.trim()
  if (!reason) {
    return { ok: false, error: 'reason cannot be empty.' }
  }
  if (reason.length > 2000) {
    return { ok: false, error: 'reason must be at most 2000 chars.' }
  }

  return {
    ok: true,
    work_order_id: wo.id,
    wo_key: wo.wo_key,
    short_text: wo.short_text,
    current_status: wo.status,
    reason,
  }
}
