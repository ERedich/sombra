/**
 * WO plan vs shift overlap on an allocation date.
 * `*Utc*` helpers: UTC midnight day bounds + wall times on that UTC day (matches backend).
 * `*Local*` helpers: browser-local midnight for `YYYY-MM-DD` + same wall-clock minutes.
 * Mirrors backend/src/services/capacityPlanning.ts for UTC variants — keep in sync.
 * Shift times have no site TZ in the schema; planner UI uses local browser calendar.
 */

const MS_PER_DAY = 86400000
const MS_PER_MINUTE = 60000
const MINUTES_PER_DAY = 24 * 60

export function timeHmsToMinutes(hms: string): number {
  const parts = hms.trim().split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  const sec = Number(parts[2] ?? 0)
  return h * 60 + m + sec / 60
}

/** First-segment minute range on the assignment calendar day (start → midnight if overnight). */
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

export function utcYmdToDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return NaN
  }
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0)
}

/** Local midnight for calendar `YYYY-MM-DD` in the browser timezone. */
export function localYmdToDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return NaN
  }
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

export function woSegmentMsOnUtcDay(
  planStartIso: string,
  planEndIso: string,
  ymd: string,
): { lo: number; hi: number } | null {
  const dayStart = utcYmdToDayStartMs(ymd)
  if (Number.isNaN(dayStart)) return null
  const dayEnd = dayStart + MS_PER_DAY
  const woLo = new Date(planStartIso).getTime()
  const woHi = new Date(planEndIso).getTime()
  if (Number.isNaN(woLo) || Number.isNaN(woHi)) return null
  const lo = Math.max(woLo, dayStart)
  const hi = Math.min(woHi, dayEnd)
  if (!(hi > lo)) return null
  return { lo, hi }
}

export function woSegmentMsOnLocalDay(
  planStartIso: string,
  planEndIso: string,
  ymd: string,
): { lo: number; hi: number } | null {
  const dayStart = localYmdToDayStartMs(ymd)
  if (Number.isNaN(dayStart)) return null
  const dayEnd = dayStart + MS_PER_DAY
  const woLo = new Date(planStartIso).getTime()
  const woHi = new Date(planEndIso).getTime()
  if (Number.isNaN(woLo) || Number.isNaN(woHi)) return null
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

export function woOverlapsAnyShiftFirstSegmentUtc(
  planStartIso: string,
  planEndIso: string,
  allocationDateYmd: string,
  shifts: { time_start: string; time_end: string }[],
): boolean {
  const seg = woSegmentMsOnUtcDay(planStartIso, planEndIso, allocationDateYmd)
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

/** Same as {@link woOverlapsAnyShiftFirstSegmentUtc} but day bounds are local browser midnight. */
export function woOverlapsAnyShiftFirstSegmentLocal(
  planStartIso: string,
  planEndIso: string,
  allocationDateYmd: string,
  shifts: { time_start: string; time_end: string }[],
): boolean {
  const seg = woSegmentMsOnLocalDay(planStartIso, planEndIso, allocationDateYmd)
  if (!seg) return false
  const dayStart = localYmdToDayStartMs(allocationDateYmd)
  if (Number.isNaN(dayStart)) return false
  for (const sh of shifts) {
    const r = firstSegmentMinuteRange(sh.time_start, sh.time_end)
    const shiftLo = dayStart + r.lo * MS_PER_MINUTE
    const shiftHi = dayStart + r.hi * MS_PER_MINUTE
    if (intervalsOverlapMs(seg.lo, seg.hi, shiftLo, shiftHi)) return true
  }
  return false
}

/** Left and width as % of the UTC day for the shift’s first on-day segment (for mini timeline bars). */
export function shiftFirstSegmentLayoutPct(
  timeStart: string,
  timeEnd: string,
): { leftPct: number; widthPct: number } {
  const r = firstSegmentMinuteRange(timeStart, timeEnd)
  const leftPct = (r.lo / MINUTES_PER_DAY) * 100
  const widthPct = ((r.hi - r.lo) / MINUTES_PER_DAY) * 100
  return { leftPct, widthPct }
}
