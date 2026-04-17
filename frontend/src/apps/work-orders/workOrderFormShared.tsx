import type { TFunction } from 'i18next'
import { Tag } from 'primereact/tag'
import type { WorkOrderStatusColourKey } from '../../constants/woStatusColours'
import { contrastTextOnHex } from '../../utils/contrastTextOnHex'
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
