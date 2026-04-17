import type { WorkOrder } from '../work-orders/workOrderTypes'
import { toYmd } from './calendarGrid'
import type { SchedulerEvent } from './types'

const DEFAULT_WO_COLOR = '#64748b'

function isoToLocalYmd(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return toYmd(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * One calendar row from plan_start / plan_end (local calendar dates).
 * Returns null if the WO has no usable plan dates.
 */
export function workOrderToSchedulerEvent(wo: WorkOrder): SchedulerEvent | null {
  const a = isoToLocalYmd(wo.plan_start)
  const b = isoToLocalYmd(wo.plan_end)
  let start: string | null = null
  let end: string | null = null
  if (a && b) {
    start = a <= b ? a : b
    end = a <= b ? b : a
  } else if (a) {
    start = end = a
  } else if (b) {
    start = end = b
  }
  if (!start || !end) return null

  const color =
    typeof wo.work_type_colour === 'string' && wo.work_type_colour.trim() !== ''
      ? wo.work_type_colour.trim()
      : DEFAULT_WO_COLOR

  const title = `#${wo.wo_key} — ${wo.short_text}`.trim()

  return {
    id: `wo:${wo.id}`,
    title,
    start,
    end,
    color,
    source: 'work_order',
    woId: wo.id,
    woKey: wo.wo_key,
  }
}

/** True iff YYYY-MM-DD span [start,end] overlaps [rangeStart, rangeEnd] inclusive. */
export function spanOverlapsRange(
  start: string,
  end: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return start <= rangeEnd && end >= rangeStart
}
