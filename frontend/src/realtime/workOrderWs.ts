import { apiBase } from '../api'
import { getToken } from '../auth'
import type { WorkOrder } from '../apps/work-orders/workOrderTypes'

export type WorkOrderWsEventType =
  | 'work_order_created'
  | 'work_order_updated'
  | 'work_order_deleted'

export type WorkOrderWsMessage = {
  type?: WorkOrderWsEventType | string
  work_order?: WorkOrder
  work_order_id?: string
}

/** WebSocket URL for `/api/ws` (JWT `token` query param). */
export function buildWorkOrderWsUrl(): string | null {
  const token = getToken()
  if (!token) return null
  const base = (apiBase.trim() || window.location.origin).replace(/\/$/, '')
  const u = new URL(base)
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${u.host}/api/ws?token=${encodeURIComponent(token)}`
}
