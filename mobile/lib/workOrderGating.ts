import type { WorkOrderRow } from './cmmsTypes'

type RowPick = Pick<
  WorkOrderRow,
  'status' | 'workgroup_id' | 'assigned_employee_ids'
>

export function workOrderCanStart(
  row: RowPick,
  currentEmployeeId: string | null,
  employeeWorkgroupIds: string[],
  startRequiresAssignment: boolean,
): boolean {
  const assignedToWo =
    !!currentEmployeeId &&
    (row.assigned_employee_ids ?? []).includes(currentEmployeeId)
  const wgId = row.workgroup_id?.trim() ?? ''
  const inWorkgroup =
    wgId.length === 0 || employeeWorkgroupIds.includes(wgId)
  return (
    !!currentEmployeeId &&
    inWorkgroup &&
    (startRequiresAssignment ? assignedToWo : true)
  )
}

export function workOrderCanStopOrHold(
  row: RowPick,
  currentEmployeeId: string | null,
  startRequiresAssignment: boolean,
): boolean {
  const assignedToWo =
    !!currentEmployeeId &&
    (row.assigned_employee_ids ?? []).includes(currentEmployeeId)
  return startRequiresAssignment ? assignedToWo : !!currentEmployeeId
}

export const PLAY_STATUSES = new Set(['open', 'assigned', 'on_hold'])
export const ACTIVE_STATUSES = new Set(['started', 'continued'])
