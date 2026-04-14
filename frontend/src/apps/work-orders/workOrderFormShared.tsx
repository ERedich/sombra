import type { TFunction } from 'i18next'
import { Tag } from 'primereact/tag'
import type { WorkOrderStatusColourKey } from '../../constants/woStatusColours'
import type { WorkOrder } from './workOrderTypes'

export const WO_FEEDBACK_DONE_REQUIRES_TIME_CODE = 'WO_FEEDBACK_DONE_REQUIRES_TIME'

export const WO_STATUS_I18N_KEYS: Record<string, string> = {
  open: 'wo.status_open',
  assigned: 'wo.status_assigned',
  started: 'wo.status_started',
  continued: 'wo.status_continued',
  on_hold: 'wo.status_on_hold',
  done: 'wo.status_done',
  closed: 'wo.status_closed',
}

export function parseWorktimeNum(w: string): number {
  const n = Number(w)
  return Number.isFinite(n) ? n : 0
}

export function sortedWorkOrders(rows: WorkOrder[]): WorkOrder[] {
  return [...rows].sort((a, b) => b.wo_key - a.wo_key)
}

export function workOrderHasLinkedPlan(
  row: Pick<WorkOrder, 'work_plan_id' | 'work_plan_key'>,
): boolean {
  const id = row.work_plan_id?.trim() ?? ''
  const key = row.work_plan_key?.trim() ?? ''
  return Boolean(id || key)
}

/** Feedback tab index in WO edit TabView (fixed layout). */
export function feedbackTabIndexForRow(_row: WorkOrder): number {
  return 4
}

function contrastTextOnHex(bgHex: string): string {
  const s = bgHex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#ffffff'
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

export function formStatusTag(
  formStatus: string,
  t: TFunction,
  mergedColours: Record<WorkOrderStatusColourKey, string>,
) {
  const k = WO_STATUS_I18N_KEYS[formStatus]
  const label = k ? t(k) : formStatus
  const sk = formStatus as WorkOrderStatusColourKey
  const colour = mergedColours[sk] ?? mergedColours.open
  const fg = contrastTextOnHex(colour)
  return (
    <Tag
      value={label}
      rounded
      className="text-sm font-medium white-space-nowrap"
      style={{
        backgroundColor: colour,
        color: fg,
        border: `1px solid ${colour}`,
      }}
    />
  )
}
