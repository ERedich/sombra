import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeCapacityKpis } from './copilotCapacityKpis.js'
import type { CopilotSchedulingSnapshot } from './copilotSchedulingSnapshot.js'

function baseMeta(
  overrides?: Partial<CopilotSchedulingSnapshot['meta']>,
): CopilotSchedulingSnapshot['meta'] {
  return {
    date_from: '2025-06-02',
    date_to: '2025-06-08',
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

function emptySnapshot(
  meta: CopilotSchedulingSnapshot['meta'] = baseMeta(),
): CopilotSchedulingSnapshot {
  return {
    work_orders: [],
    shift_assignments: [],
    capacity_allocations: [],
    used_hours_by_employee_date: {},
    meta,
  }
}

describe('computeCapacityKpis', () => {
  it('returns zeros for an empty snapshot', () => {
    const k = computeCapacityKpis(emptySnapshot())
    assert.equal(k.tcp_raw_shift_hours, 0)
    assert.equal(k.tcp_effective_hours, 0)
    assert.equal(k.tpd_hours, 0)
    assert.equal(k.tpd_allocated_hours, 0)
    assert.equal(k.tpc_hours, 0)
    assert.equal(k.utilization_pct, null)
    assert.equal(k.overlapping_work_order_count, 0)
    assert.equal(k.shift_planning_capacity_pct, 100)
  })

  it('sums shift hours and applies SPC 80% for TCP', () => {
    const snap: CopilotSchedulingSnapshot = {
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
        {
          id: 'sa2',
          shift_id: 'sh1',
          assignment_date: '2025-06-03',
          employee_id: 'e2',
          presence_status: 'scheduled',
          shift_key: 'D',
          shift_name: 'Day',
          time_start: '08:00:00',
          time_end: '16:00:00',
          employee_key: 'E2',
          employee_name: 'Emp Two',
        },
      ],
      capacity_allocations: [],
      used_hours_by_employee_date: {},
      meta: baseMeta({
        policy: {
          shift_planning_capacity_pct: 80,
          shift_bound_projection: true,
          apply_default_shift_plan: false,
        },
      }),
    }
    const k = computeCapacityKpis(snap)
    assert.equal(k.tcp_raw_shift_hours, 16)
    assert.equal(k.tcp_effective_hours, 12.8)
    assert.equal(k.shift_planning_capacity_pct, 80)
    assert.equal(k.tpc_hours, 12.8)
  })

  it('sums planned_duration of overlapping active WOs only (TPD)', () => {
    const snap: CopilotSchedulingSnapshot = {
      work_orders: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          wo_key: '1',
          short_text: 'inside',
          status: 'open',
          asset_id: 'a',
          asset_key: 'A',
          asset_name: 'A',
          workgroup_id: 'wg',
          workgroup_key: 'WG',
          workgroup_name: 'WG',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-03T08:00:00.000Z',
          plan_end: '2025-06-03T16:00:00.000Z',
          planned_duration: 8,
          assigned_employee_ids: [],
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          wo_key: '2',
          short_text: 'closed-active-filter',
          status: 'closed',
          asset_id: 'a',
          asset_key: 'A',
          asset_name: 'A',
          workgroup_id: 'wg',
          workgroup_key: 'WG',
          workgroup_name: 'WG',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-04T08:00:00.000Z',
          plan_end: '2025-06-04T12:00:00.000Z',
          planned_duration: 4,
          assigned_employee_ids: [],
        },
        {
          id: '00000000-0000-4000-8000-000000000013',
          wo_key: '3',
          short_text: 'outside',
          status: 'open',
          asset_id: 'a',
          asset_key: 'A',
          asset_name: 'A',
          workgroup_id: 'wg',
          workgroup_key: 'WG',
          workgroup_name: 'WG',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-05-20T08:00:00.000Z',
          plan_end: '2025-05-20T16:00:00.000Z',
          planned_duration: 99,
          assigned_employee_ids: [],
        },
        {
          id: '00000000-0000-4000-8000-000000000014',
          wo_key: '4',
          short_text: 'edge',
          status: 'assigned',
          asset_id: 'a',
          asset_key: 'A',
          asset_name: 'A',
          workgroup_id: 'wg',
          workgroup_key: 'WG',
          workgroup_name: 'WG',
          work_type_key: 'PM',
          work_type_name: 'PM',
          plan_start: '2025-06-06T00:00:00.000Z',
          plan_end: '2025-06-06T04:00:00.000Z',
          planned_duration: 4,
          assigned_employee_ids: [],
        },
      ],
      shift_assignments: [],
      capacity_allocations: [],
      used_hours_by_employee_date: {},
      meta: baseMeta(),
    }
    const k = computeCapacityKpis(snap)
    assert.equal(k.tpd_hours, 12)
    assert.equal(k.overlapping_work_order_count, 2)
  })

  it('sums allocations inside range for tpd_allocated_hours', () => {
    const snap: CopilotSchedulingSnapshot = {
      ...emptySnapshot(),
      capacity_allocations: [
        {
          work_order_id: 'w1',
          employee_id: 'e1',
          allocation_date: '2025-06-02',
          planned_hours: 3,
        },
        {
          work_order_id: 'w1',
          employee_id: 'e1',
          allocation_date: '2025-06-03',
          planned_hours: 5,
        },
        {
          work_order_id: 'w2',
          employee_id: 'e2',
          allocation_date: '2025-05-30',
          planned_hours: 99,
        },
      ],
    }
    const k = computeCapacityKpis(snap)
    assert.equal(k.tpd_allocated_hours, 8)
  })

  it('marks overload with negative TPC when TPD exceeds TCP', () => {
    const snap: CopilotSchedulingSnapshot = {
      work_orders: [
        {
          id: '00000000-0000-4000-8000-000000000021',
          wo_key: '21',
          short_text: 'big',
          status: 'open',
          asset_id: 'a',
          asset_key: 'A',
          asset_name: 'A',
          workgroup_id: 'wg',
          workgroup_key: 'WG',
          workgroup_name: 'WG',
          work_type_key: 'CM',
          work_type_name: 'CM',
          plan_start: '2025-06-02T08:00:00.000Z',
          plan_end: '2025-06-02T16:00:00.000Z',
          planned_duration: 40,
          assigned_employee_ids: [],
        },
      ],
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
      used_hours_by_employee_date: {},
      meta: baseMeta(),
    }
    const k = computeCapacityKpis(snap)
    assert.equal(k.tcp_effective_hours, 8)
    assert.equal(k.tpd_hours, 40)
    assert.equal(k.tpc_hours, -32)
    assert.ok(k.utilization_pct !== null && k.utilization_pct > 100)
  })

  it('returns per-day breakdown when include_per_day is true', () => {
    const snap: CopilotSchedulingSnapshot = {
      ...emptySnapshot(),
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
      capacity_allocations: [
        {
          work_order_id: 'w1',
          employee_id: 'e1',
          allocation_date: '2025-06-02',
          planned_hours: 2,
        },
      ],
    }
    const k = computeCapacityKpis(snap, { include_per_day: true })
    assert.ok(k.per_day)
    assert.equal(k.per_day!.length, 7)
    const d0 = k.per_day!.find((p) => p.date === '2025-06-02')
    assert.ok(d0)
    assert.equal(d0!.shift_hours, 8)
    assert.equal(d0!.effective_hours, 8)
    assert.equal(d0!.allocated_hours, 2)
    const d1 = k.per_day!.find((p) => p.date === '2025-06-03')
    assert.ok(d1)
    assert.equal(d1!.shift_hours, 0)
    assert.equal(d1!.allocated_hours, 0)
  })
})
