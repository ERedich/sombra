import type { GeneralFdwId } from '../../utils/firstDayOfWeekPreference'

/** Minimal shape for week lane layout (local + work orders). */
export type CalendarSpan = {
  id: string
  start: string
  end: string
}

export function toYmd(y: number, monthIndex0: number, d: number): string {
  return `${y}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Local date at noon to avoid DST edge cases when comparing. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function daysInMonth(y: number, monthIndex0: number): number {
  return new Date(y, monthIndex0 + 1, 0).getDate()
}

/** Column index 0..6 for the first day of month in the grid (0 = first weekday column per FDW). */
export function firstDayColumnForMonth(
  y: number,
  monthIndex0: number,
  fdw: GeneralFdwId,
): number {
  const dow = new Date(y, monthIndex0, 1).getDay()
  if (fdw === 'sunday') return dow
  return (dow + 6) % 7
}

/** Seven short weekday labels in display column order (matches FDW). */
export function weekdayShortLabels(locale: string, fdw: GeneralFdwId): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const anchorMon = new Date(2024, 0, 8, 12, 0, 0, 0)
  const anchorSun = new Date(2024, 0, 7, 12, 0, 0, 0)
  const start = fdw === 'sunday' ? anchorSun : anchorMon
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    labels.push(fmt.format(d))
  }
  return labels
}

/** One day cell in the month grid (includes leading/trailing adjacent-month days). */
export type MonthGridCell = {
  /** Local calendar YMD for layout, drag/drop, and “today”. */
  dateStr: string
  /** Day-of-month digit shown in the cell corner. */
  displayDay: number
  /** False for previous/next month padding at grid edges. */
  isCurrentMonth: boolean
}

/** Rows of 7 cells covering the month plus partial weeks from adjacent months. */
export function buildMonthWeeks(
  y: number,
  monthIndex0: number,
  fdw: GeneralFdwId,
): MonthGridCell[][] {
  const dim = daysInMonth(y, monthIndex0)
  const lead = firstDayColumnForMonth(y, monthIndex0, fdw)

  let prevY = y
  let prevM = monthIndex0 - 1
  if (prevM < 0) {
    prevM = 11
    prevY = y - 1
  }
  const prevDim = daysInMonth(prevY, prevM)

  const cells: MonthGridCell[] = []
  for (let i = 0; i < lead; i++) {
    const d = prevDim - lead + i + 1
    cells.push({
      dateStr: toYmd(prevY, prevM, d),
      displayDay: d,
      isCurrentMonth: false,
    })
  }
  for (let d = 1; d <= dim; d++) {
    cells.push({
      dateStr: toYmd(y, monthIndex0, d),
      displayDay: d,
      isCurrentMonth: true,
    })
  }

  let nextY = y
  let nextM = monthIndex0 + 1
  if (nextM > 11) {
    nextM = 0
    nextY = y + 1
  }
  let nextDay = 0
  while (cells.length % 7 !== 0) {
    nextDay += 1
    cells.push({
      dateStr: toYmd(nextY, nextM, nextDay),
      displayDay: nextDay,
      isCurrentMonth: false,
    })
  }

  const weeks: MonthGridCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

export type PlacedSpan<E extends CalendarSpan = CalendarSpan> = {
  ev: E
  colStart: number
  colSpan: number
  lane: number
  isStart: boolean
  isEnd: boolean
}

const CELL_H = 90
const LANE_H = 22
const LANE_GAP = 3
const TOP_PAD = 36

export const MONTH_SCHEDULER_LAYOUT = {
  CELL_H,
  LANE_H,
  LANE_GAP,
  TOP_PAD,
} as const

export function layoutWeek<E extends CalendarSpan>(
  week: MonthGridCell[],
  events: E[],
): { placed: PlacedSpan<E>[]; maxLane: number } {
  const weekDates = week.map((c) => c.dateStr)
  if (!weekDates.length) return { placed: [], maxLane: -1 }

  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]

  const relevant = events
    .filter((ev) => ev.start <= weekEnd && ev.end >= weekStart)
    .slice()
    .sort((a, b) => {
      const la = parseYmd(a.end).getTime() - parseYmd(a.start).getTime()
      const lb = parseYmd(b.end).getTime() - parseYmd(b.start).getTime()
      return lb - la || (a.start < b.start ? -1 : 1)
    })

  const lanes: { colStart: number; colEnd: number }[][] = []
  const placed: PlacedSpan<E>[] = []

  for (const ev of relevant) {
    const cs = ev.start < weekStart ? weekStart : ev.start
    const ce = ev.end > weekEnd ? weekEnd : ev.end

    let colStart = weekDates.indexOf(cs)
    let colEnd = weekDates.indexOf(ce)
    if (colStart === -1) {
      colStart = 0
    }
    if (colEnd === -1) {
      colEnd = weekDates.length - 1
    }

    const colSpan = colEnd - colStart + 1

    let lane = 0
    while (true) {
      if (!lanes[lane]) lanes[lane] = []
      const conflict = lanes[lane].some(
        (p) => !(p.colEnd < colStart || p.colStart > colEnd),
      )
      if (!conflict) {
        lanes[lane].push({ colStart, colEnd })
        break
      }
      lane++
    }

    placed.push({
      ev,
      colStart,
      colSpan,
      lane,
      isStart: ev.start >= weekStart,
      isEnd: ev.end <= weekEnd,
    })
  }

  const maxLane = placed.reduce((m, p) => Math.max(m, p.lane), -1)
  return { placed, maxLane }
}

export function weekRowHeight(maxLane: number): number {
  const eventsH =
    maxLane >= 0 ? (maxLane + 1) * (LANE_H + LANE_GAP) + 6 : 4
  return CELL_H + eventsH
}
