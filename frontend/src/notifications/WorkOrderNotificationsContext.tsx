import type { ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Toast } from 'primereact/toast'
import type { ToastMessage } from 'primereact/toast'
import { ApiError, apiBase, apiJson } from '../api'
import { getToken } from '../auth'
import { useWorkOrderMw } from '../layout/WorkOrderMwProvider'

export type WorkOrderNotificationItem = {
  id: string
  user_id: string
  work_order_id: string
  kind: string
  message: string
  payload_json: Record<string, unknown>
  created_at: string
  read_at: string | null
}

type NotificationsListResponse = {
  notifications: WorkOrderNotificationItem[]
  hours: number
}

type NotificationsUnreadResponse = {
  unread_count: number
}

type NotificationWsMessage = {
  type: 'work_order_notification'
  notification: WorkOrderNotificationItem
}

type WorkOrderNotificationsContextValue = {
  items: WorkOrderNotificationItem[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markVisibleAsRead: () => Promise<void>
}

const WINDOW_HOURS = 24

const Ctx = createContext<WorkOrderNotificationsContextValue | null>(null)

function isWithinWindow(iso: string, hours = WINDOW_HOURS): boolean {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  return t >= Date.now() - hours * 60 * 60 * 1000
}

function buildWsUrl(): string | null {
  const token = getToken()
  if (!token) return null
  const raw = apiBase && apiBase.trim() ? apiBase.trim() : window.location.origin
  const u = new URL(raw)
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${u.host}/api/ws?token=${encodeURIComponent(token)}`
}

export function WorkOrderNotificationsProvider({
  children,
}: {
  children: ReactNode
}) {
  const location = useLocation()
  const { mountWoMw } = useWorkOrderMw()
  const { t } = useTranslation()
  const toastRef = useRef<Toast>(null)
  const [items, setItems] = useState<WorkOrderNotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setItems([])
      setUnreadCount(0)
      return
    }
    setLoading(true)
    try {
      const [list, unread] = await Promise.all([
        apiJson<NotificationsListResponse>(`/api/notifications?hours=${WINDOW_HOURS}`),
        apiJson<NotificationsUnreadResponse>('/api/notifications/unread-count'),
      ])
      setItems(list.notifications ?? [])
      setUnreadCount(
        Number.isFinite(unread.unread_count) ? unread.unread_count : 0,
      )
    } catch {
      setItems([])
      setUnreadCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  const markVisibleAsRead = useCallback(async () => {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return
    try {
      await apiJson<{ ok: true; updated_count: number }>(
        '/api/notifications/mark-read-visible',
        {
          method: 'POST',
          body: JSON.stringify({
            notification_ids: unreadIds,
            hours: WINDOW_HOURS,
          }),
        },
      )
      const nowIso = new Date().toISOString()
      setItems((prev) =>
        prev.map((n) =>
          unreadIds.includes(n.id) ? { ...n, read_at: nowIso } : n,
        ),
      )
      setUnreadCount((cur) => Math.max(0, cur - unreadIds.length))
    } catch {
      /* keep unread badge on API failure */
    }
  }, [items])

  const openWorkOrderFromToast = useCallback(
    (workOrderId: string) => {
      const id = workOrderId.trim()
      if (!id) return
      toastRef.current?.clear()
      mountWoMw(id)
    },
    [mountWoMw],
  )

  useEffect(() => {
    if (location.pathname === '/login' || !getToken()) {
      setItems([])
      setUnreadCount(0)
      return
    }
    void refresh()
  }, [location.pathname, refresh])

  useEffect(() => {
    if (location.pathname === '/login' || !getToken()) return
    let ws: WebSocket | null = null
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const connect = () => {
      const url = buildWsUrl()
      if (!url) return
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      ws.onopen = () => {
        attempt = 0
      }
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as NotificationWsMessage
          if (data.type !== 'work_order_notification' || !data.notification?.id) {
            return
          }
          const n = data.notification
          setItems((prev) => {
            const merged = [n, ...prev.filter((x) => x.id !== n.id)].filter((x) =>
              isWithinWindow(x.created_at),
            )
            return merged.slice(0, 200)
          })
          if (!n.read_at) {
            setUnreadCount((v) => v + 1)
          }
          const payloadWorkOrderId =
            typeof n.payload_json?.work_order_id === 'string'
              ? n.payload_json.work_order_id.trim()
              : ''
          const fallbackWorkOrderId = n.work_order_id?.trim() ?? ''
          const workOrderId = payloadWorkOrderId || fallbackWorkOrderId
          const msg: ToastMessage = {
            severity: 'info',
            summary: t('notifications.toast_summary'),
            detail: n.message,
            life: 5000,
          }
          if (workOrderId) {
            msg.content = () => (
              <div className="flex flex-column gap-2">
                <div className="font-medium">{t('notifications.toast_summary')}</div>
                <div className="text-sm">{n.message}</div>
                <div>
                  <Button
                    type="button"
                    label={t('common.jump_to_file')}
                    icon="pi pi-external-link"
                    size="small"
                    outlined
                    onClick={() => openWorkOrderFromToast(workOrderId)}
                  />
                </div>
              </div>
            )
          }
          toastRef.current?.show(msg)
        } catch {
          /* ignore malformed payload */
        }
      }
      ws.onerror = () => {
        ws?.close()
      }
      ws.onclose = () => {
        if (cancelled) return
        scheduleReconnect()
      }
    }
    function scheduleReconnect() {
      if (cancelled) return
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      const delay = Math.min(30_000, 1000 * 2 ** attempt)
      attempt += 1
      reconnectTimer = window.setTimeout(() => {
        connect()
      }, delay)
    }
    connect()
    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [location.pathname, openWorkOrderFromToast, t])

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      loading,
      refresh,
      markVisibleAsRead,
    }),
    [items, unreadCount, loading, refresh, markVisibleAsRead],
  )

  return (
    <Ctx.Provider value={value}>
      <Toast ref={toastRef} position="top-right" />
      {children}
    </Ctx.Provider>
  )
}

export function useWorkOrderNotifications(): WorkOrderNotificationsContextValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('useWorkOrderNotifications must be used within provider')
  }
  return v
}

export function notificationApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  return fallback
}
