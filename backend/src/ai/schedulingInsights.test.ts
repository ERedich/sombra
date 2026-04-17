import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  analyzeSchedulingSnapshot,
  type EmployeeCapacityIssue,
  planWindowsOverlap,
} from './schedulingInsights.js'
import type { CopilotSchedulingSnapshot } from './copilotSchedulingSnapshot.js'

describe('planWindowsOverlap', () => {
  it('detects overlap', () => {
    assert.equal(
      planWindowsOverlap(
        '2025-06-01T08:00:00.000Z',
        '2025-06-01T12:00:00.000Z',
        '2025-06-01T10:00:00.000Z',
        '2025-06-01T14:00:00.000Z',
      ),
      true,
    )
  })

  it('returns false when touching at boundary', () => {
    assert.equal(
      planWindowsOverlap(
        '2025-06-01T08:00:00.000Z',
        '2025-06-01T10:00:00.000Z',
        '2025-06-01T10:00:00.000Z',
        '2025-06-01T12:00:00.000Z',
      ),
      false,
    )
  })

  it('returns false when disjoint', () => {
    assert.equal(
      planWindowsOverlap(
        '2025-06-01T08:00:00.000Z',
        '2025-06-01T09:00:00.000Z',
        '2025-06-01T10:00:00.000Z',
        '2025-06-01T11:00:00.000Z',
      ),
      false,
    )
  })
})

function emptyMeta(): CopilotSchedulingSnapshot['meta'] {
  return {
    date_from: '2025-06-01',
    date_to: '2025-06-07',
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
  }
}

describe('analyzeSchedulingSnapshot', () => {
  it('flags employee over SPC capacity', () => {
    const snapshot: CopilotSchedulingSnapshot = {
      work_orders: [],
      shift_assignments: [
        {
          id: 'sa1',
          shift_id: 'sh1',
          assignment_date: '2025-06-02',
          employee_id: 'e1',
          presence_status: 'scheduled',
          shift_key: 'D',
          shift_name: 'Day',
          time_start: '08:00:00',
          time_end: '16:00:00',
          employee_key: 'E1',
          employee_name: 'Emp One',
        },
      ],
      capacity_allocations: [],
      used_hours_by_employee_date: {
        e1: { '2025-06-02': 9 },
      },
      meta: {
        ...emptyMeta(),
        policy: {
          shift_planning_capacity_pct: 100,
          shift_bound_projection: true,
          apply_default_shift_plan: false,
        },
      },
    }
    const { issues } = analyzeSchedulingSnapshot(snapshot)
    const crit = issues.filter(
      (i): i is EmployeeCapacityIssue =>
        i.kind === 'employee_capacity' && i.severity === 'critical',
    )
    assert.ok(crit.length >= 1)
    assert.equal(crit[0]?.employee_id, 'e1')
  })

  it('flags WO overlap on same asset', () => {
    const aid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot: CopilotSchedulingSnapshot = {
      work_orders: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          wo_key: '1000001',
          short_text: 'A',
          status: 'open',
          asset_id: aid,
          asset_key: 'X',
          asset_name: 'Ax',
          workgroup_id: '00000000-0000-4000-8000-000000000021',
          workgroup_key: 'G1',
          workgroup_name: 'G',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-01T08:00:00.000Z',
          plan_end: '2025-06-01T12:00:00.000Z',
          planned_duration: 4,
          assigned_employee_ids: [],
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          wo_key: '1000002',
          short_text: 'B',
          status: 'open',
          asset_id: aid,
          asset_key: 'X',
          asset_name: 'Ax',
          workgroup_id: '00000000-0000-4000-8000-000000000022',
          workgroup_key: 'G2',
          workgroup_name: 'G2',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-01T10:00:00.000Z',
          plan_end: '2025-06-01T14:00:00.000Z',
          planned_duration: 4,
          assigned_employee_ids: [],
        },
      ],
      shift_assignments: [],
      capacity_allocations: [],
      used_hours_by_employee_date: {},
      meta: emptyMeta(),
    }
    const { issues } = analyzeSchedulingSnapshot(snapshot)
    const ol = issues.filter((i) => i.kind === 'wo_plan_overlap')
    assert.equal(ol.length, 1)
    assert.equal(ol[0]?.kind === 'wo_plan_overlap' && ol[0].reason, 'same_asset')
  })

  it('flags allocation gap vs planned_duration', () => {
    const snapshot: CopilotSchedulingSnapshot = {
      work_orders: [
        {
          id: '00000000-0000-4000-8000-000000000031',
          wo_key: '1000003',
          short_text: 'Gap',
          status: 'open',
          asset_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          asset_key: 'Y',
          asset_name: 'Y',
          workgroup_id: '00000000-0000-4000-8000-000000000021',
          workgroup_key: 'G1',
          workgroup_name: 'G',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-01T08:00:00.000Z',
          plan_end: '2025-06-01T12:00:00.000Z',
          planned_duration: 8,
          assigned_employee_ids: [],
        },
      ],
      shift_assignments: [],
      capacity_allocations: [
        {
          work_order_id: '00000000-0000-4000-8000-000000000031',
          employee_id: 'e1',
          allocation_date: '2025-06-01',
          planned_hours: 1,
        },
      ],
      used_hours_by_employee_date: {},
      meta: emptyMeta(),
    }
    const { issues } = analyzeSchedulingSnapshot(snapshot)
    const g = issues.filter((i) => i.kind === 'allocation_gap')
    assert.equal(g.length, 1)
  })
})
