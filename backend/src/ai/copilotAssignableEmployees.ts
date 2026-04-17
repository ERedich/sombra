import type { CopilotSchedulingSnapshot } from './copilotSchedulingSnapshot.js'
import {
  firstSegmentMinuteRange,
  isOvernightShift,
  overnightTailMinuteRange,
  utcYmdToDayStartMs,
} from '../services/capacityPlanning.js'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/** presence_status values that count as "planned / at work" for a WO. */
const AT_WORK_PRESENCE = new Set(['scheduled', 'present'])

export type AssignableShiftWindow = {
  assignment_date: string
  shift_key: string
  shift_name: string
  start_utc: string
  end_utc: string
  presence_status: string
}

export type AssignableEmployee = {
  employee_id: string
  employee_key: string
  employee_name: string
  shift_windows: AssignableShiftWindow[]
}

export type PartialEmployee = AssignableEmployee & {
  uncovered_ranges: Array<{ start_utc: string; end_utc: string }>
}

export type ExcludedEmployee = {
  employee_id: string
  employee_key: string
  employee_name: string
  reason: 'no_shift_on_day' | 'absent' | 'outside_shift'
}

export type AssignableResult = {
  meta: {
    plan_start: string
    plan_end: string
    workgroup_id: string | null
    planning_dates: string[]
  }
  assignable: AssignableEmployee[]
  partial: PartialEmployee[]
  excluded_no_shift: ExcludedEmployee[]
}

type ParsedArgs = {
  planStartMs: number
  planEndMs: number
  planStartIso: string
  planEndIso: string
}

function parsePlanWindow(
  planStart: string,
  planEnd: string,
): ParsedArgs | { error: string } {
  const a = Date.parse(planStart)
  const b = Date.parse(planEnd)
  if (!Number.isFinite(a)) return { error: 'plan_start is not a valid ISO date/time.' }
  if (!Number.isFinite(b)) return { error: 'plan_end is not a valid ISO date/time.' }
  if (!(a < b)) return { error: 'plan_start must be strictly before plan_end.' }
  return {
    planStartMs: a,
    planEndMs: b,
    planStartIso: new Date(a).toISOString(),
    planEndIso: new Date(b).toISOString(),
  }
}

function ymdUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function daysCoveredByWindow(startMs: number, endMs: number): string[] {
  const startDay = Math.floor(startMs / MS_PER_DAY) * MS_PER_DAY
  const lastDayStart = Math.floor((endMs - 1) / MS_PER_DAY) * MS_PER_DAY
  const out: string[] = []
  for (let t = startDay; t <= lastDayStart; t += MS_PER_DAY) {
    out.push(ymdUtc(t))
  }
  return out
}

type ShiftInterval = {
  employee_id: string
  employee_key: string
  employee_name: string
  assignment_date: string
  shift_key: string
  shift_name: string
  presence_status: string
  startMs: number
  endMs: number
}

/** Expand a shift_assignment row into 1-2 absolute UTC intervals (first segment + optional overnight tail). */
function expandShiftAssignment(
  sa: CopilotSchedulingSnapshot['shift_assignments'][number],
): ShiftInterval[] {
  const dayStart = utcYmdToDayStartMs(sa.assignment_date)
  if (Number.isNaN(dayStart)) return []
  const overnight = isOvernightShift(sa.time_start, sa.time_end)
  const first = firstSegmentMinuteRange(sa.time_start, sa.time_end)
  const out: ShiftInterval[] = []
  out.push({
    employee_id: sa.employee_id,
    employee_key: sa.employee_key,
    employee_name: sa.employee_name,
    assignment_date: sa.assignment_date,
    shift_key: sa.shift_key,
    shift_name: sa.shift_name,
    presence_status: sa.presence_status,
    startMs: dayStart + first.lo * MS_PER_MINUTE,
    endMs: dayStart + first.hi * MS_PER_MINUTE,
  })
  if (overnight) {
    const tail = overnightTailMinuteRange(sa.time_end)
    const tailDayStart = dayStart + MS_PER_DAY
    if (tail.hi > tail.lo) {
      out.push({
        employee_id: sa.employee_id,
        employee_key: sa.employee_key,
        employee_name: sa.employee_name,
        assignment_date: sa.assignment_date,
        shift_key: sa.shift_key,
        shift_name: sa.shift_name,
        presence_status: sa.presence_status,
        startMs: tailDayStart + tail.lo * MS_PER_MINUTE,
        endMs: tailDayStart + tail.hi * MS_PER_MINUTE,
      })
    }
  }
  return out
}

/** Merge an unsorted array of [start, end] intervals into disjoint, sorted intervals. */
function mergeIntervals(
  intervals: Array<{ startMs: number; endMs: number }>,
): Array<{ startMs: number; endMs: number }> {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs)
  const out: Array<{ startMs: number; endMs: number }> = []
  let cur = { ...sorted[0]! }
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!
    if (next.startMs <= cur.endMs) {
      cur.endMs = Math.max(cur.endMs, next.endMs)
    } else {
      out.push(cur)
      cur = { ...next }
    }
  }
  out.push(cur)
  return out
}

/** Subtract merged `covered` intervals from `[planStartMs, planEndMs]`; return uncovered sub-intervals. */
function uncoveredRanges(
  planStartMs: number,
  planEndMs: number,
  covered: Array<{ startMs: number; endMs: number }>,
): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = []
  let cursor = planStartMs
  for (const seg of covered) {
    if (seg.endMs <= cursor) continue
    if (seg.startMs >= planEndMs) break
    if (seg.startMs > cursor) {
      out.push({ startMs: cursor, endMs: Math.min(seg.startMs, planEndMs) })
    }
    cursor = Math.max(cursor, seg.endMs)
    if (cursor >= planEndMs) break
  }
  if (cursor < planEndMs) {
    out.push({ startMs: cursor, endMs: planEndMs })
  }
  return out
}

export function findAssignableEmployees(
  snapshot: CopilotSchedulingSnapshot,
  args: { plan_start: string; plan_end: string; workgroup_id?: string | null },
):
  | { ok: true; result: AssignableResult }
  | { ok: false; error: string } {
  const parsed = parsePlanWindow(args.plan_start, args.plan_end)
  if ('error' in parsed) return { ok: false, error: parsed.error }

  const planningDates = daysCoveredByWindow(parsed.planStartMs, parsed.planEndMs)
  const planningDateSet = new Set(planningDates)

  type EmpRec = {
    employee_id: string
    employee_key: string
    employee_name: string
    intervals: ShiftInterval[]
    anyRelevantRow: boolean
    anyAtWorkRow: boolean
    absentRow: boolean
  }
  const byEmp = new Map<string, EmpRec>()

  for (const sa of snapshot.shift_assignments) {
    const exp = expandShiftAssignment(sa)
    if (exp.length === 0) continue
    let touchesPlan = false
    for (const iv of exp) {
      if (iv.endMs <= parsed.planStartMs) continue
      if (iv.startMs >= parsed.planEndMs) continue
      touchesPlan = true
      break
    }
    if (!touchesPlan && !planningDateSet.has(sa.assignment_date)) continue
    const rec =
      byEmp.get(sa.employee_id) ??
      ({
        employee_id: sa.employee_id,
        employee_key: sa.employee_key,
        employee_name: sa.employee_name,
        intervals: [],
        anyRelevantRow: false,
        anyAtWorkRow: false,
        absentRow: false,
      } satisfies EmpRec)
    rec.anyRelevantRow = true
    const atWork = AT_WORK_PRESENCE.has(sa.presence_status)
    if (atWork) {
      rec.anyAtWorkRow = true
      for (const iv of exp) rec.intervals.push(iv)
    } else if (sa.presence_status === 'absent' || sa.presence_status === 'not_present') {
      rec.absentRow = true
    }
    byEmp.set(sa.employee_id, rec)
  }

  const assignable: AssignableEmployee[] = []
  const partial: PartialEmployee[] = []
  const excluded: ExcludedEmployee[] = []

  for (const rec of byEmp.values()) {
    if (!rec.anyAtWorkRow) {
      excluded.push({
        employee_id: rec.employee_id,
        employee_key: rec.employee_key,
        employee_name: rec.employee_name,
        reason: rec.absentRow ? 'absent' : 'no_shift_on_day',
      })
      continue
    }
    const relevantIntervals = rec.intervals.filter(
      (iv) =>
        iv.endMs > parsed.planStartMs && iv.startMs < parsed.planEndMs,
    )
    const merged = mergeIntervals(
      relevantIntervals.map((iv) => ({
        startMs: iv.startMs,
        endMs: iv.endMs,
      })),
    )
    const uncovered = uncoveredRanges(
      parsed.planStartMs,
      parsed.planEndMs,
      merged,
    )
    const shiftWindows: AssignableShiftWindow[] = relevantIntervals
      .slice()
      .sort((a, b) => a.startMs - b.startMs)
      .map((iv) => ({
        assignment_date: iv.assignment_date,
        shift_key: iv.shift_key,
        shift_name: iv.shift_name,
        start_utc: new Date(iv.startMs).toISOString(),
        end_utc: new Date(iv.endMs).toISOString(),
        presence_status: iv.presence_status,
      }))

    if (shiftWindows.length === 0) {
      excluded.push({
        employee_id: rec.employee_id,
        employee_key: rec.employee_key,
        employee_name: rec.employee_name,
        reason: 'outside_shift',
      })
      continue
    }

    if (uncovered.length === 0) {
      assignable.push({
        employee_id: rec.employee_id,
        employee_key: rec.employee_key,
        employee_name: rec.employee_name,
        shift_windows: shiftWindows,
      })
    } else {
      partial.push({
        employee_id: rec.employee_id,
        employee_key: rec.employee_key,
        employee_name: rec.employee_name,
        shift_windows: shiftWindows,
        uncovered_ranges: uncovered.map((u) => ({
          start_utc: new Date(u.startMs).toISOString(),
          end_utc: new Date(u.endMs).toISOString(),
        })),
      })
    }
  }

  assignable.sort((a, b) => a.employee_key.localeCompare(b.employee_key))
  partial.sort((a, b) => a.employee_key.localeCompare(b.employee_key))
  excluded.sort((a, b) => a.employee_key.localeCompare(b.employee_key))

  return {
    ok: true,
    result: {
      meta: {
        plan_start: parsed.planStartIso,
        plan_end: parsed.planEndIso,
        workgroup_id: args.workgroup_id ?? null,
        planning_dates: planningDates,
      },
      assignable,
      partial,
      excluded_no_shift: excluded,
    },
  }
}
