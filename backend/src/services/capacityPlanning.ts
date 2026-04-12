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
