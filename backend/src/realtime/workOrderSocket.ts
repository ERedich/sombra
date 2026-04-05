import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'
import { WebSocket, WebSocketServer } from 'ws'
import { canAccessSite, loadUserSiteScope, type UserSiteScope } from '../auth/siteScope.js'
import { pool } from '../db.js'
import { env } from '../env.js'

type JwtUserClaims = {
  sub: string
  role: string
}

type WorkOrderBroadcastRow = Record<string, unknown> & { site_id: string }
export type WorkOrderNotificationBroadcast = {
  id: string
  user_id: string
  work_order_id: string
  kind: string
  message: string
  payload_json: Record<string, unknown>
  created_at: Date
  read_at: Date | null
}

type Client = { ws: WebSocket; scope: UserSiteScope; userId: string }

const clients = new Set<Client>()

function broadcastWorkOrderEvent(
  type: 'work_order_created' | 'work_order_updated',
  row: WorkOrderBroadcastRow,
): void {
  const payload = JSON.stringify({
    type,
    work_order: row,
  })
  for (const c of clients) {
    if (!canAccessSite(c.scope, row.site_id)) continue
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload)
    }
  }
}

/**
 * Broadcast a newly created work order (list row shape) to connected clients
 * who may access that WO's site.
 */
export function broadcastWorkOrderCreated(row: WorkOrderBroadcastRow): void {
  broadcastWorkOrderEvent('work_order_created', row)
}

/** Broadcast updated work order row to permitted clients. */
export function broadcastWorkOrderUpdated(row: WorkOrderBroadcastRow): void {
  broadcastWorkOrderEvent('work_order_updated', row)
}

/** Broadcast work order deletion to permitted clients. */
export function broadcastWorkOrderDeleted(workOrderId: string, siteId: string): void {
  const payload = JSON.stringify({
    type: 'work_order_deleted',
    work_order_id: workOrderId,
  })
  for (const c of clients) {
    if (!canAccessSite(c.scope, siteId)) continue
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload)
    }
  }
}

/** Broadcast per-user notification events to matching websocket clients. */
export function broadcastWorkOrderNotifications(
  notifications: WorkOrderNotificationBroadcast[],
): void {
  if (notifications.length === 0) return
  for (const n of notifications) {
    const payload = JSON.stringify({
      type: 'work_order_notification',
      notification: {
        id: n.id,
        user_id: n.user_id,
        work_order_id: n.work_order_id,
        kind: n.kind,
        message: n.message,
        payload_json: n.payload_json,
        created_at:
          n.created_at instanceof Date ? n.created_at.toISOString() : n.created_at,
        read_at:
          n.read_at instanceof Date
            ? n.read_at.toISOString()
            : n.read_at,
      },
    })
    for (const c of clients) {
      if (c.userId !== n.user_id) continue
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload)
      }
    }
  }
}

export function initWorkOrderRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/api/ws' })

  wss.on('connection', (ws, req) => {
    void handleConnection(ws, req)
  })
}

async function handleConnection(ws: WebSocket, req: import('http').IncomingMessage): Promise<void> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const token = url.searchParams.get('token')
  if (!token) {
    ws.close(1008, 'Missing token')
    return
  }

  let userId: string
  let role: string
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtUserClaims
    userId = payload.sub
    role = typeof payload.role === 'string' ? payload.role : ''
  } catch {
    ws.close(1008, 'Invalid token')
    return
  }

  let scope: UserSiteScope
  try {
    scope = await loadUserSiteScope(pool, userId, role)
  } catch {
    ws.close(1011, 'Server error')
    return
  }

  const client: Client = { ws, scope, userId }
  clients.add(client)
  ws.on('close', () => {
    clients.delete(client)
  })
  ws.on('error', () => {
    clients.delete(client)
  })
}
