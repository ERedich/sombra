import type { WorkOrder } from '../apps/work-orders/workOrderTypes'
import type { ScheduleMonthCell } from './scheduleMonthGrid'

/** Inclusive local calendar days from ISO timestamps (same as capacity planner `toLocalYmd`). */
export function toLocalYmdFromIso(iso: string): string | null {
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type WeekWoBarSegment = {
  wo: WorkOrder
  startCol: number
  endCol: number
}

export type PlacedWeekWoBar = WeekWoBarSegment & {
  lane: number
}

/** One WO contributes at most one segment per week row (columns 0–6). */
export function woSegmentInWeek(
  week: ScheduleMonthCell[],
  wo: WorkOrder,
): WeekWoBarSegment | null {
  const s = wo.plan_start?.trim()
  const e = wo.plan_end?.trim()
  if (!s || !e) return null
  const sd = new Date(s)
  const ed = new Date(e)
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return null
  const startYmd = toLocalYmdFromIso(s)
  const endYmd = toLocalYmdFromIso(e)
  if (!startYmd || !endYmd || endYmd < startYmd) return null

  let minCol = -1
  let maxCol = -1
  for (let i = 0; i < 7; i += 1) {
    const ymd = week[i]!.ymd
    if (ymd >= startYmd && ymd <= endYmd) {
      if (minCol < 0) minCol = i
      maxCol = i
    }
  }
  if (minCol < 0 || maxCol < 0) return null
  return { wo, startCol: minCol, endCol: maxCol }
}

export function buildWeekSegments(
  week: ScheduleMonthCell[],
  rows: WorkOrder[],
): WeekWoBarSegment[] {
  const out: WeekWoBarSegment[] = []
  for (const wo of rows) {
    const seg = woSegmentInWeek(week, wo)
    if (seg) out.push(seg)
  }
  return out
}

function segmentsOverlap(a: WeekWoBarSegment, b: WeekWoBarSegment): boolean {
  return !(a.endCol < b.startCol || b.endCol < a.startCol)
}

/**
 * Greedy lane assignment: sort by start column (then longer span first),
 * place each segment on the smallest lane index with no overlap vs that lane.
 */
export function assignBarLanes(segments: WeekWoBarSegment[]): PlacedWeekWoBar[] {
  const sorted = [...segments].sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol
    return b.endCol - b.startCol - (a.endCol - a.startCol)
  })
  const laneSegs: WeekWoBarSegment[][] = []
  const out: PlacedWeekWoBar[] = []
  for (const s of sorted) {
    let L = 0
    for (; L < laneSegs.length; L += 1) {
      const lane = laneSegs[L]!
      const conflict = lane.some((p) => segmentsOverlap(p, s))
      if (!conflict) break
    }
    if (L === laneSegs.length) laneSegs.push([])
    laneSegs[L]!.push(s)
    out.push({ ...s, lane: L })
  }
  return out
}

export function maxLaneIndex(placed: PlacedWeekWoBar[]): number {
  let m = -1
  for (const p of placed) if (p.lane > m) m = p.lane
  return m
}
