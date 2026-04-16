export const MINUTES_PER_DAY = 24 * 60

export function timeHmsToMinutes(hms: string): number {
  const parts = hms.trim().split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  const sec = Number(parts[2] ?? 0)
  return h * 60 + m + sec / 60
}

/** Hours of the shift that fall on the assignment calendar day (first segment for overnight). */
export function shiftHoursOnAssignmentDay(
  timeStart: string,
  timeEnd: string,
): number {
  const start = timeHmsToMinutes(timeStart)
  const end = timeHmsToMinutes(timeEnd)
  if (end <= start) {
    return (MINUTES_PER_DAY - start) / 60
  }
  return (end - start) / 60
}

export function isOvernightShift(timeStart: string, timeEnd: string): boolean {
  return timeHmsToMinutes(timeEnd) <= timeHmsToMinutes(timeStart)
}

function overlapMinutes(
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): number {
  const lo = Math.max(aLo, bLo)
  const hi = Math.min(aHi, bHi)
  return Math.max(0, hi - lo)
}

/** First-segment minute range on the assignment's calendar day (start → midnight if overnight). */
export function firstSegmentMinuteRange(
  timeStart: string,
  timeEnd: string,
): { lo: number; hi: number } {
  const s = timeHmsToMinutes(timeStart)
  const e = timeHmsToMinutes(timeEnd)
  if (e <= s) {
    return { lo: s, hi: MINUTES_PER_DAY }
  }
  return { lo: s, hi: e }
}

/** Post-midnight tail on the calendar day after assignment_date (00:00 → time_end). */
export function overnightTailMinuteRange(timeEnd: string): {
  lo: number
  hi: number
} {
  const e = timeHmsToMinutes(timeEnd)
  return { lo: 0, hi: Math.min(e, MINUTES_PER_DAY) }
}

/**
 * TAC contribution for one row (hours × spcFrac). `todayYmd` / `yesterdayYmd` are YYYY-MM-DD.
 */
export function tacHoursForRow(
  assignmentDate: string,
  timeStart: string,
  timeEnd: string,
  todayYmd: string,
  yesterdayYmd: string,
  spcFrac: number,
): number {
  if (assignmentDate === todayYmd) {
    return shiftHoursOnAssignmentDay(timeStart, timeEnd) * spcFrac
  }
  if (assignmentDate === yesterdayYmd && isOvernightShift(timeStart, timeEnd)) {
    const tail = overnightTailMinuteRange(timeEnd)
    return (tail.hi - tail.lo) / 60 * spcFrac
  }
  return 0
}

/**
 * TACh contribution: overlap of [currentHourStart, currentHourEnd) minutes with effective segments on today's calendar wall clock.
 */
export function tachHoursForRow(
  assignmentDate: string,
  timeStart: string,
  timeEnd: string,
  todayYmd: string,
  yesterdayYmd: string,
  spcFrac: number,
  currentHour: number,
): number {
  const hLo = currentHour * 60
  const hHi = Math.min((currentHour + 1) * 60, MINUTES_PER_DAY)
  let minutes = 0
  if (assignmentDate === todayYmd) {
    const seg = firstSegmentMinuteRange(timeStart, timeEnd)
    minutes += overlapMinutes(seg.lo, seg.hi, hLo, hHi)
  }
  if (assignmentDate === yesterdayYmd && isOvernightShift(timeStart, timeEnd)) {
    const tail = overnightTailMinuteRange(timeEnd)
    minutes += overlapMinutes(tail.lo, tail.hi, hLo, hHi)
  }
  return (minutes / 60) * spcFrac
}

/** Compare / display planned hours to 2 decimals (avoids float drift vs UI “8.00 h”). */
export function roundPlannedHours(n: number): number {
  return Math.round(n * 100) / 100
}

const MS_PER_DAY = 86400000
const MS_PER_MINUTE = 60000

/** Parse `YYYY-MM-DD` as UTC midnight (capacity planner / WO plan use UTC calendar semantics). */
export function utcYmdToDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return NaN
  }
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0)
}

/** WO plan interval clipped to the UTC calendar day `ymd`, in epoch ms; null if empty. */
export function woSegmentMsOnUtcDay(
  planStart: Date,
  planEnd: Date,
  ymd: string,
): { lo: number; hi: number } | null {
  const dayStart = utcYmdToDayStartMs(ymd)
  if (Number.isNaN(dayStart)) return null
  const dayEnd = dayStart + MS_PER_DAY
  const woLo = planStart.getTime()
  const woHi = planEnd.getTime()
  const lo = Math.max(woLo, dayStart)
  const hi = Math.min(woHi, dayEnd)
  if (!(hi > lo)) return null
  return { lo, hi }
}

export function intervalsOverlapMs(
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): boolean {
  return Math.max(aLo, bLo) < Math.min(aHi, bHi)
}

/**
 * True if the WO plan window overlaps any shift’s first segment on `allocationDateYmd`.
 * Shift wall times are interpreted as UTC on that calendar day (same frame as WO instants).
 * If plants use non-UTC local wall clocks for shifts, add site timezone and convert intervals.
 */
export function woOverlapsAnyShiftFirstSegmentUtc(
  planStart: Date,
  planEnd: Date,
  allocationDateYmd: string,
  shifts: { time_start: string; time_end: string }[],
): boolean {
  const seg = woSegmentMsOnUtcDay(planStart, planEnd, allocationDateYmd)
  if (!seg) return false
  const dayStart = utcYmdToDayStartMs(allocationDateYmd)
  if (Number.isNaN(dayStart)) return false
  for (const sh of shifts) {
    const r = firstSegmentMinuteRange(sh.time_start, sh.time_end)
    const shiftLo = dayStart + r.lo * MS_PER_MINUTE
    const shiftHi = dayStart + r.hi * MS_PER_MINUTE
    if (intervalsOverlapMs(seg.lo, seg.hi, shiftLo, shiftHi)) return true
  }
  return false
}
