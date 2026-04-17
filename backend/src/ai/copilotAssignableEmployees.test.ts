import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findAssignableEmployees } from './copilotAssignableEmployees.js'
import type {
  CopilotSchedulingSnapshot,
  CopilotShiftAssignmentSlim,
} from './copilotSchedulingSnapshot.js'

function baseMeta(
  overrides?: Partial<CopilotSchedulingSnapshot['meta']>,
): CopilotSchedulingSnapshot['meta'] {
  return {
    date_from: '2026-04-30',
    date_to: '2026-05-02',
    site_id: '00000000-0000-4000-8000-000000000001',
    workgroup_id: null,
    max_range_days: 31,
    max_work_orders: 200,
    work_orders_truncated: false,
    work_orders_returned: 0,
    policy: {
      shift_planning_capacity_pct: 100,
      shift_bound_projection: true,
      apply_default_shift_plan: false,
    },
    hint: null,
    ...overrides,
  }
}

function sa(
  overrides: Partial<CopilotShiftAssignmentSlim> &
    Pick<
      CopilotShiftAssignmentSlim,
      'employee_id' | 'assignment_date' | 'time_start' | 'time_end'
    >,
): CopilotShiftAssignmentSlim {
  return {
    id: `sa-${overrides.employee_id}-${overrides.assignment_date}`,
    shift_id: 'sh1',
    presence_status: 'scheduled',
    shift_key: 'D',
    shift_name: 'Day',
    employee_key: `EMP-${overrides.employee_id.toUpperCase()}`,
    employee_name: `Employee ${overrides.employee_id}`,
    ...overrides,
  }
}

function makeSnapshot(
  rows: CopilotShiftAssignmentSlim[],
): CopilotSchedulingSnapshot {
  return {
    work_orders: [],
    shift_assignments: rows,
    capacity_allocations: [],
    used_hours_by_employee_date: {},
    meta: baseMeta(),
  }
}

describe('findAssignableEmployees', () => {
  it('returns empty buckets for an empty snapshot', () => {
    const r = findAssignableEmployees(makeSnapshot([]), {
      plan_start: '2026-05-01T09:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
    })
    assert.equal(r.ok, true)
    assert.ok(r.ok)
    assert.deepEqual(r.result.assignable, [])
    assert.deepEqual(r.result.partial, [])
    assert.deepEqual(r.result.excluded_no_shift, [])
    assert.deepEqual(r.result.meta.planning_dates, ['2026-05-01'])
  })

  it('day shift fully covers WO window -> assignable', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-05-01',
        time_start: '08:00:00',
        time_end: '16:00:00',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T09:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.assignable.length, 1)
    assert.equal(r.result.assignable[0]?.employee_id, 'e1')
    assert.equal(r.result.partial.length, 0)
    assert.equal(r.result.excluded_no_shift.length, 0)
  })

  it('shift 08-12 vs WO 10-14 -> partial with uncovered 12-14', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-05-01',
        time_start: '08:00:00',
        time_end: '12:00:00',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T10:00:00.000Z',
      plan_end: '2026-05-01T14:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.assignable.length, 0)
    assert.equal(r.result.partial.length, 1)
    assert.equal(r.result.partial[0]?.uncovered_ranges.length, 1)
    assert.equal(
      r.result.partial[0]?.uncovered_ranges[0]?.start_utc,
      '2026-05-01T12:00:00.000Z',
    )
    assert.equal(
      r.result.partial[0]?.uncovered_ranges[0]?.end_utc,
      '2026-05-01T14:00:00.000Z',
    )
  })

  it('overnight shift 20-06 on D covers WO 22-02 (D/D+1) -> assignable', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-05-01',
        time_start: '20:00:00',
        time_end: '06:00:00',
        shift_key: 'N',
        shift_name: 'Night',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T22:00:00.000Z',
      plan_end: '2026-05-02T02:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.assignable.length, 1)
    assert.equal(r.result.assignable[0]?.shift_windows.length, 2)
  })

  it('absent presence_status -> excluded with reason absent', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-05-01',
        time_start: '08:00:00',
        time_end: '16:00:00',
        presence_status: 'absent',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T09:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.assignable.length, 0)
    assert.equal(r.result.excluded_no_shift.length, 1)
    assert.equal(r.result.excluded_no_shift[0]?.reason, 'absent')
  })

  it('no shift_assignment row on the WO day -> employee not in any bucket', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-04-30',
        time_start: '08:00:00',
        time_end: '16:00:00',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T09:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.assignable.length, 0)
    assert.equal(r.result.partial.length, 0)
    assert.equal(r.result.excluded_no_shift.length, 0)
  })

  it('shift on WO day but not overlapping the WO window -> excluded outside_shift', () => {
    const snap = makeSnapshot([
      sa({
        employee_id: 'e1',
        assignment_date: '2026-05-01',
        time_start: '06:00:00',
        time_end: '08:00:00',
      }),
    ])
    const r = findAssignableEmployees(snap, {
      plan_start: '2026-05-01T10:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
    })
    assert.ok(r.ok)
    assert.equal(r.result.excluded_no_shift.length, 1)
    assert.equal(r.result.excluded_no_shift[0]?.reason, 'outside_shift')
  })

  it('rejects invalid plan window', () => {
    const r = findAssignableEmployees(makeSnapshot([]), {
      plan_start: '2026-05-01T12:00:00.000Z',
      plan_end: '2026-05-01T10:00:00.000Z',
    })
    assert.equal(r.ok, false)
  })

  it('propagates workgroup_id in meta', () => {
    const r = findAssignableEmployees(makeSnapshot([]), {
      plan_start: '2026-05-01T09:00:00.000Z',
      plan_end: '2026-05-01T12:00:00.000Z',
      workgroup_id: 'wg-1',
    })
    assert.ok(r.ok)
    assert.equal(r.result.meta.workgroup_id, 'wg-1')
  })
})
