import { isKiraUuid } from '@sombra/shared'
import type { Pool } from 'pg'

const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export type CopilotShiftAssignmentPrepareOk = {
  ok: true
  payload: {
    shift_id: string
    employee_id: string
    assignment_date: string
  }
  summary: {
    shift_key: string
    shift_name: string
    time_start: string
    time_end: string
    employee_key: string
    employee_name: string
    assignment_date: string
  }
}

export type CopilotShiftAssignmentPrepareResult =
  | CopilotShiftAssignmentPrepareOk
  | { ok: false; error: string }

/**
 * Validates POST /api/shift-assignments body for the working site:
 * same-site shift + employee, weekday in shift.available_weekdays, no duplicate slot.
 */
export async function validatePrepareCreateShiftAssignment(
  pool: Pool,
  siteId: string,
  raw: Record<string, unknown>,
): Promise<CopilotShiftAssignmentPrepareResult> {
  const shiftId =
    typeof raw.shift_id === 'string' ? raw.shift_id.trim() : ''
  const employeeId =
    typeof raw.employee_id === 'string' ? raw.employee_id.trim() : ''
  const adRaw =
    typeof raw.assignment_date === 'string' ? raw.assignment_date.trim() : ''

  if (!shiftId || !isKiraUuid(shiftId)) {
    return { ok: false, error: 'shift_id must be a valid UUID.' }
  }
  if (!employeeId || !isKiraUuid(employeeId)) {
    return { ok: false, error: 'employee_id must be a valid UUID.' }
  }
  if (!DATE_YMD_RE.test(adRaw)) {
    return { ok: false, error: 'assignment_date must be YYYY-MM-DD.' }
  }

  const shR = await pool.query<{
    id: string
    key: string
    name: string
    time_start: string
    time_end: string
    available_weekdays: number[]
    site_id: string
  }>(
    `SELECT id, key, name,
            time_start::text AS time_start,
            time_end::text AS time_end,
            available_weekdays,
            site_id::text AS site_id
       FROM shifts
      WHERE id = $1::uuid`,
    [shiftId],
  )
  const sh = shR.rows[0]
  if (!sh || sh.site_id !== siteId) {
    return {
      ok: false,
      error: 'Shift not found on this working site.',
    }
  }

  const empR = await pool.query<{ id: string; key: string; name: string }>(
    `SELECT id::text AS id, key, name FROM employees WHERE id = $1::uuid AND site_id = $2::uuid`,
    [employeeId, siteId],
  )
  const emp = empR.rows[0]
  if (!emp) {
    return {
      ok: false,
      error: 'Employee not found on this working site.',
    }
  }

  const wds = Array.isArray(sh.available_weekdays)
    ? sh.available_weekdays.map((x) => Number(x))
    : []
  const dowR = await pool.query<{ iw: number }>(
    `SELECT EXTRACT(ISODOW FROM $1::date)::int AS iw`,
    [adRaw],
  )
  const iw = dowR.rows[0]?.iw
  if (iw === undefined || !wds.includes(iw)) {
    return {
      ok: false,
      error:
        'That shift is not defined for the weekday of assignment_date (check available_weekdays vs. ISO weekday Mon=1…Sun=7).',
    }
  }

  const dup = await pool.query(
    `SELECT 1 FROM shift_assignments
      WHERE shift_id = $1::uuid AND assignment_date = $2::date AND employee_id = $3::uuid`,
    [shiftId, adRaw, employeeId],
  )
  if ((dup.rowCount ?? 0) > 0) {
    return {
      ok: false,
      error:
        'This employee is already assigned to this shift on that date.',
    }
  }

  return {
    ok: true,
    payload: {
      shift_id: shiftId,
      employee_id: employeeId,
      assignment_date: adRaw,
    },
    summary: {
      shift_key: sh.key,
      shift_name: sh.name,
      time_start: sh.time_start,
      time_end: sh.time_end,
      employee_key: emp.key,
      employee_name: emp.name,
      assignment_date: adRaw,
    },
  }
}
