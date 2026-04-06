import type { ReactNode } from 'react'
import type { WorkOrderNotificationItem } from './WorkOrderNotificationsContext'

type NotificationLinkHandlers = {
  onWorkOrderClick: (workOrderId: string) => void
  onActorClick: (userId: string) => void
  onEmployeeClick: (employeeId: string) => void
}

function readPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function linkClassName(): string {
  return 'p-0 border-none bg-transparent text-primary cursor-pointer hover:underline'
}

function linkifyWorkOrderTokens(
  text: string,
  workOrderId: string | null,
  onWorkOrderClick: (workOrderId: string) => void,
  keyPrefix: string,
): ReactNode[] {
  if (!text) return []
  if (!workOrderId) return [text]

  const out: ReactNode[] = []
  const woTokenRe = /\bWO\s+\d+\b/g
  let last = 0
  let idx = 0
  let match = woTokenRe.exec(text)
  while (match) {
    const token = match[0]
    const start = match.index
    const end = start + token.length
    if (start > last) out.push(text.slice(last, start))
    out.push(
      <button
        key={`${keyPrefix}-wo-${idx}`}
        type="button"
        className={linkClassName()}
        onClick={() => onWorkOrderClick(workOrderId)}
      >
        {token}
      </button>,
    )
    last = end
    idx += 1
    match = woTokenRe.exec(text)
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length > 0 ? out : [text]
}

export function renderNotificationMessage(
  notification: WorkOrderNotificationItem,
  handlers: NotificationLinkHandlers,
): ReactNode {
  const payload = notification.payload_json ?? {}
  const workOrderId =
    readPayloadString(payload, 'work_order_id') ??
    (notification.work_order_id?.trim() || null)
  const actorUserId = readPayloadString(payload, 'actor_user_id')
  const actorName = readPayloadString(payload, 'actor_user_name')
  const employeeId = readPayloadString(payload, 'employee_id')
  const employeeName =
    readPayloadString(payload, 'employee_key') ??
    readPayloadString(payload, 'employee_name')
  const message = notification.message ?? ''

  if (!message) return null

  const out: ReactNode[] = []
  let remainder = message

  if (actorUserId && actorName && remainder.startsWith(actorName)) {
    out.push(
      <button
        key={`${notification.id}-actor`}
        type="button"
        className={linkClassName()}
        onClick={() => handlers.onActorClick(actorUserId)}
      >
        {actorName}
      </button>,
    )
    remainder = remainder.slice(actorName.length)
  }

  if (employeeId && employeeName) {
    const employeeStart = remainder.indexOf(employeeName)
    if (employeeStart >= 0) {
      const beforeEmployee = remainder.slice(0, employeeStart)
      const afterEmployee = remainder.slice(employeeStart + employeeName.length)
      out.push(
        ...linkifyWorkOrderTokens(
          beforeEmployee,
          workOrderId,
          handlers.onWorkOrderClick,
          `${notification.id}-before-employee`,
        ),
      )
      out.push(
        <button
          key={`${notification.id}-employee`}
          type="button"
          className={linkClassName()}
          onClick={() => handlers.onEmployeeClick(employeeId)}
        >
          {employeeName}
        </button>,
      )
      out.push(
        ...linkifyWorkOrderTokens(
          afterEmployee,
          workOrderId,
          handlers.onWorkOrderClick,
          `${notification.id}-after-employee`,
        ),
      )
      return <>{out}</>
    }
  }

  out.push(
    ...linkifyWorkOrderTokens(
      remainder,
      workOrderId,
      handlers.onWorkOrderClick,
      notification.id,
    ),
  )

  return <>{out}</>
}
