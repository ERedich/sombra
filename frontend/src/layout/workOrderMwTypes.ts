import type { WorkOrder } from '../apps/work-orders/workOrderTypes'

export type WorkOrderMwSession =
  | null
  | { kind: 'create' }
  | {
      kind: 'edit'
      workOrderId: string
      seedRow: WorkOrder | null
      initialTab?: number
    }

export type WoMwEvent =
  | {
      type: 'merged_row'
      workOrder: WorkOrder
      beforeRow?: WorkOrder | null
    }
  | { type: 'created_row'; workOrder: WorkOrder }
  | { type: 'silent_list_refresh' }
