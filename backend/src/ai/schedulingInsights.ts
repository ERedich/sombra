import type {
  CopilotCapacityAllocationRow,
  CopilotSchedulingSnapshot,
  CopilotShiftAssignmentSlim,
  CopilotSlimWorkOrder,
} from './copilotSchedulingSnapshot.js'
import { shiftHoursOnAssignmentDay } from '../services/capacityPlanning.js'

export type SchedulingIssueSeverity = 'warning' | 'critical'

export type SchedulingIssueBase = {
  id: string
  kind: string
  severity: SchedulingIssueSeverity
  summary: string
}

export type EmployeeCapacityIssue = SchedulingIssueBase & {
  kind: 'employee_capacity'
  employee_id: string
  employee_key: string | null
  employee_name: string | null
  date: string
  allocated_hours: number
  shift_hours_scheduled: number
  effective_capacity_hours: number
  utilization_pct: number
}

export type WoPlanOverlapIssue = SchedulingIssueBase & {
  kind: 'wo_plan_overlap'
  reason: 'same_asset' | 'same_workgroup' | 'shared_assigned_employee'
  work_order_a_id: string
  work_order_a_key: string
  work_order_b_id: string
  work_order_b_key: string
  overlap_start: string
  overlap_end: string
}

export type AllocationGapIssue = SchedulingIssueBase & {
  kind: 'allocation_gap'
  work_order_id: string
  wo_key: string
  short_text: string
  planned_duration: number
  allocated_hours_in_window: number
}

export type SchedulingIssue =
  | EmployeeCapacityIssue
  | WoPlanOverlapIssue
  | AllocationGapIssue

export type SchedulingAnalysisSummary = {
  work_order_count: number
  shift_assignment_count: number
  allocation_row_count: number
  issue_count_by_severity: { warning: number; critical: number }
}

export type SchedulingAnalysisResult = {
  issues: SchedulingIssue[]
  summary: SchedulingAnalysisSummary
}

const ACTIVE_WO_STATUSES = new Set([
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
])

/** UTC instant overlap (half-open [a,b) style using strict inequality for touch-at-boundary). */
export function planWindowsOverlap(
  aStartIso: string,
  aEndIso: string,
  bStartIso: string,
  bEndIso: string,
): boolean {
  const as = Date.parse(aStartIso)
  const ae = Date.parse(aEndIso)
  const bs = Date.parse(bStartIso)
  const be = Date.parse(bEndIso)
  if (![as, ae, bs, be].every(Number.isFinite)) return false
  return as < be && bs < ae
}

function overlapInterval(
  aStartIso: string,
  aEndIso: string,
  bStartIso: string,
  bEndIso: string,
): { start: string; end: string } | null {
  const as = Date.parse(aStartIso)
  const ae = Date.parse(aEndIso)
  const bs = Date.parse(bStartIso)
  const be = Date.parse(bEndIso)
  if (![as, ae, bs, be].every(Number.isFinite)) return null
  const lo = Math.max(as, bs)
  const hi = Math.min(ae, be)
  if (lo >= hi) return null
  return { start: new Date(lo).toISOString(), end: new Date(hi).toISOString() }
}

function setsOverlap(a: string[], b: string[]): boolean {
  const sb = new Set(b)
  return a.some((x) => sb.has(x))
}

function shiftHoursForAssignmentsOnDate(
  assignments: CopilotShiftAssignmentSlim[],
  employeeId: string,
  date: string,
): number {
  let h = 0
  for (const sa of assignments) {
    if (sa.employee_id !== employeeId || sa.assignment_date !== date) continue
    h += shiftHoursOnAssignmentDay(sa.time_start, sa.time_end)
  }
  return h
}

function employeeDisplay(
  assignments: CopilotShiftAssignmentSlim[],
  employeeId: string,
): { key: string | null; name: string | null } {
  for (const sa of assignments) {
    if (sa.employee_id === employeeId) {
      return { key: sa.employee_key, name: sa.employee_name }
    }
  }
  return { key: null, name: null }
}

function analyzeEmployeeCapacity(
  snapshot: CopilotSchedulingSnapshot,
): EmployeeCapacityIssue[] {
  const pct = snapshot.meta.policy.shift_planning_capacity_pct
  const spcFrac = Math.min(100, Math.max(0, pct)) / 100
  const issues: EmployeeCapacityIssue[] = []

  const datesByEmployee = new Map<string, Set<string>>()
  for (const [emp, byDate] of Object.entries(
    snapshot.used_hours_by_employee_date,
  )) {
    if (!datesByEmployee.has(emp)) datesByEmployee.set(emp, new Set())
    for (const d of Object.keys(byDate)) {
      datesByEmployee.get(emp)!.add(d)
    }
  }
  for (const sa of snapshot.shift_assignments) {
    if (!datesByEmployee.has(sa.employee_id)) {
      datesByEmployee.set(sa.employee_id, new Set())
    }
    datesByEmployee.get(sa.employee_id)!.add(sa.assignment_date)
  }

  for (const [employeeId, dates] of datesByEmployee) {
    for (const date of dates) {
      const allocated =
        snapshot.used_hours_by_employee_date[employeeId]?.[date] ?? 0
      const shiftH = shiftHoursForAssignmentsOnDate(
        snapshot.shift_assignments,
        employeeId,
        date,
      )
      const effectiveCap = shiftH * spcFrac
      if (shiftH <= 0 && allocated <= 0) continue
      const util =
        effectiveCap > 0
          ? (allocated / effectiveCap) * 100
          : allocated > 0
            ? Number.POSITIVE_INFINITY
            : 0

      const { key: employee_key, name: employee_name } = employeeDisplay(
        snapshot.shift_assignments,
        employeeId,
      )

      if (allocated > effectiveCap + 1e-6) {
        issues.push({
          id: `emp_cap_crit_${employeeId}_${date}`,
          kind: 'employee_capacity',
          severity: 'critical',
          summary: `Allocated ${allocated.toFixed(2)}h exceeds SPC capacity ${effectiveCap.toFixed(2)}h (${pct}% of ${shiftH.toFixed(2)}h shift) on ${date}.`,
          employee_id: employeeId,
          employee_key,
          employee_name,
          date,
          allocated_hours: allocated,
          shift_hours_scheduled: shiftH,
          effective_capacity_hours: effectiveCap,
          utilization_pct: Number.isFinite(util) ? util : 999,
        })
      } else if (effectiveCap > 0 && util >= 85) {
        issues.push({
          id: `emp_cap_warn_${employeeId}_${date}`,
          kind: 'employee_capacity',
          severity: 'warning',
          summary: `High capacity use (${util.toFixed(0)}% of SPC cap ${effectiveCap.toFixed(2)}h) on ${date}.`,
          employee_id: employeeId,
          employee_key,
          employee_name,
          date,
          allocated_hours: allocated,
          shift_hours_scheduled: shiftH,
          effective_capacity_hours: effectiveCap,
          utilization_pct: util,
        })
      } else if (shiftH <= 0 && allocated > 0) {
        issues.push({
          id: `emp_cap_no_shift_${employeeId}_${date}`,
          kind: 'employee_capacity',
          severity: 'warning',
          summary: `Planned ${allocated.toFixed(2)}h on ${date} but no shift assignment that day (cannot validate shift bucket).`,
          employee_id: employeeId,
          employee_key,
          employee_name,
          date,
          allocated_hours: allocated,
          shift_hours_scheduled: 0,
          effective_capacity_hours: 0,
          utilization_pct: 0,
        })
      }
    }
  }

  return issues
}

function analyzeWoOverlaps(snapshot: CopilotSchedulingSnapshot): WoPlanOverlapIssue[] {
  const issues: WoPlanOverlapIssue[] = []
  const wos = snapshot.work_orders.filter(
    (w) =>
      w.plan_start &&
      w.plan_end &&
      ACTIVE_WO_STATUSES.has(w.status),
  )

  for (let i = 0; i < wos.length; i++) {
    for (let j = i + 1; j < wos.length; j++) {
      const a = wos[i]!
      const b = wos[j]!
      if (
        !planWindowsOverlap(
          a.plan_start!,
          a.plan_end!,
          b.plan_start!,
          b.plan_end!,
        )
      ) {
        continue
      }
      const reasons: WoPlanOverlapIssue['reason'][] = []
      if (a.asset_id === b.asset_id) reasons.push('same_asset')
      if (a.workgroup_id === b.workgroup_id) reasons.push('same_workgroup')
      if (
        a.assigned_employee_ids.length &&
        b.assigned_employee_ids.length &&
        setsOverlap(a.assigned_employee_ids, b.assigned_employee_ids)
      ) {
        reasons.push('shared_assigned_employee')
      }
      if (reasons.length === 0) continue

      const iv = overlapInterval(
        a.plan_start!,
        a.plan_end!,
        b.plan_start!,
        b.plan_end!,
      )
      if (!iv) continue

      const reason = reasons[0]!
      const id = `wo_ol_${a.id.slice(0, 8)}_${b.id.slice(0, 8)}_${reason}`
      issues.push({
        id,
        kind: 'wo_plan_overlap',
        severity: 'warning',
        summary: `WO ${a.wo_key} and ${b.wo_key} overlap in plan window (${reason.replace(/_/g, ' ')}).`,
        reason,
        work_order_a_id: a.id,
        work_order_a_key: String(a.wo_key),
        work_order_b_id: b.id,
        work_order_b_key: String(b.wo_key),
        overlap_start: iv.start,
        overlap_end: iv.end,
      })
    }
  }
  return issues
}

function sumAllocationsForWo(
  allocations: CopilotCapacityAllocationRow[],
  workOrderId: string,
): number {
  let s = 0
  for (const r of allocations) {
    if (r.work_order_id === workOrderId && Number.isFinite(r.planned_hours)) {
      s += r.planned_hours
    }
  }
  return s
}

function analyzeAllocationGaps(
  snapshot: CopilotSchedulingSnapshot,
): AllocationGapIssue[] {
  const issues: AllocationGapIssue[] = []
  for (const w of snapshot.work_orders) {
    if (!ACTIVE_WO_STATUSES.has(w.status)) continue
    const pd = w.planned_duration
    if (pd == null || pd <= 0) continue
    const sum = sumAllocationsForWo(snapshot.capacity_allocations, w.id)
    if (sum + 0.05 < pd) {
      issues.push({
        id: `alloc_gap_${w.id}`,
        kind: 'allocation_gap',
        severity: 'warning',
        summary: `WO ${w.wo_key}: planned capacity allocations (${sum.toFixed(2)}h) are below planned duration (${pd.toFixed(2)}h) in this window.`,
        work_order_id: w.id,
        wo_key: String(w.wo_key),
        short_text: w.short_text,
        planned_duration: pd,
        allocated_hours_in_window: sum,
      })
    }
  }
  return issues
}

export function analyzeSchedulingSnapshot(
  snapshot: CopilotSchedulingSnapshot,
): SchedulingAnalysisResult {
  const emp = analyzeEmployeeCapacity(snapshot)
  const ol = analyzeWoOverlaps(snapshot)
  const gap = analyzeAllocationGaps(snapshot)
  const issues = [...emp, ...ol, ...gap].sort((a, b) => {
    const sev = (s: SchedulingIssueSeverity) =>
      s === 'critical' ? 0 : 1
    return sev(a.severity) - sev(b.severity) || a.id.localeCompare(b.id)
  })

  const issue_count_by_severity = { warning: 0, critical: 0 }
  for (const i of issues) {
    issue_count_by_severity[i.severity] += 1
  }

  return {
    issues,
    summary: {
      work_order_count: snapshot.work_orders.length,
      shift_assignment_count: snapshot.shift_assignments.length,
      allocation_row_count: snapshot.capacity_allocations.length,
      issue_count_by_severity,
    },
  }
}
