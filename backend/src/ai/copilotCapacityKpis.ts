import type { CopilotSchedulingSnapshot } from './copilotSchedulingSnapshot.js'
import { shiftHoursOnAssignmentDay } from '../services/capacityPlanning.js'
import { roundPlannedHours } from '../services/capacityPlanning.js'

/**
 * WO statuses that still consume capacity inside the window.
 * Mirrors `ACTIVE_WO_STATUSES` in schedulingInsights.ts; kept private here
 * so the KPI aggregator can be used without pulling analyzer internals.
 */
const ACTIVE_WO_STATUSES = new Set<string>([
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
])

export type CapacityKpiPerDay = {
  date: string
  shift_hours: number
  effective_hours: number
  allocated_hours: number
}

export type CapacityKpis = {
  /** Raw sum of shift hours in the window (before SPC). */
  tcp_raw_shift_hours: number
  /** SPC-adjusted available hours; use this as **TCP** when comparing to work load. */
  tcp_effective_hours: number
  /** Sum of `planned_duration` for active WOs with plan windows overlapping the range (primary TPD). */
  tpd_hours: number
  /** Sum of per-day `capacity_allocations.planned_hours` in the range (sanity figure). */
  tpd_allocated_hours: number
  /** TPC = tcp_effective_hours - tpd_hours. Negative = overloaded week. */
  tpc_hours: number
  /** tpd_hours / tcp_effective_hours × 100, null when TCP is 0. */
  utilization_pct: number | null
  /** Number of active WOs counted in `tpd_hours`. */
  overlapping_work_order_count: number
  /** Policy SPC % used for tcp_effective_hours (e.g. 80 means effective = raw × 0.80). */
  shift_planning_capacity_pct: number
  /** Optional per-day breakdown (only when `include_per_day = true`). */
  per_day?: CapacityKpiPerDay[]
}

function ymdBetween(dateFrom: string, dateTo: string): string[] {
  const a = Date.parse(`${dateFrom}T00:00:00Z`)
  const b = Date.parse(`${dateTo}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return []
  const out: string[] = []
  for (let t = a; t <= b; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function planWindowOverlapsRange(
  planStartIso: string | null,
  planEndIso: string | null,
  rangeStartUtcMs: number,
  rangeEndExclusiveUtcMs: number,
): boolean {
  if (!planStartIso || !planEndIso) return false
  const ps = Date.parse(planStartIso)
  const pe = Date.parse(planEndIso)
  if (!Number.isFinite(ps) || !Number.isFinite(pe) || ps >= pe) return false
  return ps < rangeEndExclusiveUtcMs && rangeStartUtcMs < pe
}

/**
 * Aggregate the scheduling snapshot into three headline capacity KPIs
 * (TCP / TPD / TPC) for the snapshot's date range.
 */
export function computeCapacityKpis(
  snapshot: CopilotSchedulingSnapshot,
  options?: { include_per_day?: boolean },
): CapacityKpis {
  const { date_from, date_to, policy } = snapshot.meta
  const spcPct = policy.shift_planning_capacity_pct
  const spcFrac = spcPct / 100

  const days = ymdBetween(date_from, date_to)
  const daySet = new Set(days)
  const rangeStartMs = Date.parse(`${date_from}T00:00:00Z`)
  const rangeEndExclusiveMs = Date.parse(`${date_to}T00:00:00Z`) + 86_400_000

  let tcpRaw = 0
  const shiftHoursByDate = new Map<string, number>()
  for (const sa of snapshot.shift_assignments) {
    if (!daySet.has(sa.assignment_date)) continue
    const h = shiftHoursOnAssignmentDay(sa.time_start, sa.time_end)
    if (!Number.isFinite(h) || h <= 0) continue
    tcpRaw += h
    shiftHoursByDate.set(
      sa.assignment_date,
      (shiftHoursByDate.get(sa.assignment_date) ?? 0) + h,
    )
  }

  let tpd = 0
  let overlappingCount = 0
  for (const w of snapshot.work_orders) {
    if (!ACTIVE_WO_STATUSES.has(w.status)) continue
    if (w.planned_duration == null || !Number.isFinite(w.planned_duration)) {
      continue
    }
    if (w.planned_duration <= 0) continue
    if (
      !planWindowOverlapsRange(
        w.plan_start,
        w.plan_end,
        rangeStartMs,
        rangeEndExclusiveMs,
      )
    ) {
      continue
    }
    tpd += w.planned_duration
    overlappingCount += 1
  }

  let allocatedTotal = 0
  const allocatedByDate = new Map<string, number>()
  for (const row of snapshot.capacity_allocations) {
    if (!daySet.has(row.allocation_date)) continue
    const h = Number.isFinite(row.planned_hours) ? row.planned_hours : 0
    if (h <= 0) continue
    allocatedTotal += h
    allocatedByDate.set(
      row.allocation_date,
      (allocatedByDate.get(row.allocation_date) ?? 0) + h,
    )
  }

  const tcpEffective = tcpRaw * spcFrac
  const tpc = tcpEffective - tpd
  const utilization =
    tcpEffective > 0 ? (tpd / tcpEffective) * 100 : null

  const out: CapacityKpis = {
    tcp_raw_shift_hours: roundPlannedHours(tcpRaw),
    tcp_effective_hours: roundPlannedHours(tcpEffective),
    tpd_hours: roundPlannedHours(tpd),
    tpd_allocated_hours: roundPlannedHours(allocatedTotal),
    tpc_hours: roundPlannedHours(tpc),
    utilization_pct:
      utilization == null ? null : roundPlannedHours(utilization),
    overlapping_work_order_count: overlappingCount,
    shift_planning_capacity_pct: spcPct,
  }

  if (options?.include_per_day) {
    out.per_day = days.map((d) => {
      const rawShift = shiftHoursByDate.get(d) ?? 0
      return {
        date: d,
        shift_hours: roundPlannedHours(rawShift),
        effective_hours: roundPlannedHours(rawShift * spcFrac),
        allocated_hours: roundPlannedHours(allocatedByDate.get(d) ?? 0),
      }
    })
  }

  return out
}
