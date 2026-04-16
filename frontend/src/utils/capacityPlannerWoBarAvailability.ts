/**
 * WO Gantt pill: shift coverage overlay (first on-day segment only — no overnight tail).
 * Track % matches barLayout / dateList column semantics in CapacityPlannerAppPage (local calendar).
 */

import {
  firstSegmentMinuteRange,
  localYmdToDayStartMs,
} from './capacityWoShiftOverlap'

const MS_PER_DAY = 86400000
const MS_PER_MINUTE = 60000

export type MsInterval = { lo: number; hi: number }

function toLocalYmd(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localTimeOfDayFraction(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  const sod = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    0,
  ).getTime()
  return Math.max(0, Math.min((d.getTime() - sod) / MS_PER_DAY, 1))
}

/** Left edge of instant on the Gantt track (0–100%), same logic as barLayout. */
export function instantToTrackPct(iso: string, dateList: string[]): number {
  const n = dateList.length
  if (n === 0) return 0
  const ymd = toLocalYmd(iso)
  const frac = localTimeOfDayFraction(iso)
  const i = dateList.findIndex((d) => d >= ymd)
  if (i < 0) return 100
  return Math.max(0, Math.min(100, ((i + frac) / n) * 100))
}

function instantToTrackPctFromMs(ms: number, dateList: string[]): number {
  return instantToTrackPct(new Date(ms).toISOString(), dateList)
}

export function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  if (intervals.length === 0) return []
  const s = [...intervals].sort((a, b) => a.lo - b.lo)
  const out: MsInterval[] = []
  let cur = { ...s[0]! }
  for (let k = 1; k < s.length; k += 1) {
    const n = s[k]!
    if (n.lo <= cur.hi) {
      cur.hi = Math.max(cur.hi, n.hi)
    } else {
      out.push(cur)
      cur = { ...n }
    }
  }
  out.push(cur)
  return out
}

/** Union of first-segment shift windows (epoch ms, local midnight on each assignment date). */
export function mergedGridShiftIntervalsLocalMs(
  assignments: Array<{
    assignment_date: string
    time_start: string
    time_end: string
  }>,
  dateListYmd: string[],
): MsInterval[] {
  const daySet = new Set(dateListYmd)
  const raw: MsInterval[] = []
  for (const a of assignments) {
    if (!daySet.has(a.assignment_date)) continue
    const r = firstSegmentMinuteRange(a.time_start, a.time_end)
    const dayStart = localYmdToDayStartMs(a.assignment_date)
    if (Number.isNaN(dayStart)) continue
    raw.push({
      lo: dayStart + r.lo * MS_PER_MINUTE,
      hi: dayStart + r.hi * MS_PER_MINUTE,
    })
  }
  return mergeIntervals(raw)
}

export function intersectIntervals(
  woLo: number,
  woHi: number,
  merged: MsInterval[],
): MsInterval[] {
  const o: MsInterval[] = []
  for (const seg of merged) {
    const lo = Math.max(seg.lo, woLo)
    const hi = Math.min(seg.hi, woHi)
    if (hi > lo) o.push({ lo, hi })
  }
  return mergeIntervals(o)
}

/** Pill-relative overlay segments (left/width %) from intersected [lo,hi) ms. */
export function woShiftHighlightOverlaysInPill(
  planStartIso: string,
  planEndIso: string,
  dateList: string[],
  pillLayout: { leftPct: number; widthPct: number },
  mergedShifts: MsInterval[],
): { leftPct: number; widthPct: number }[] {
  const woLo = new Date(planStartIso).getTime()
  const woHi = new Date(planEndIso).getTime()
  if (!(woHi > woLo) || !(pillLayout.widthPct > 0)) return []

  const pillLeft = pillLayout.leftPct
  const pillW = pillLayout.widthPct
  const pillRight = pillLeft + pillW

  const hits = intersectIntervals(woLo, woHi, mergedShifts)
  const out: { leftPct: number; widthPct: number }[] = []

  for (const seg of hits) {
    const trackA = instantToTrackPctFromMs(seg.lo, dateList)
    const trackB = instantToTrackPctFromMs(
      Math.max(seg.lo, seg.hi - 1),
      dateList,
    )
    const segL = Math.max(trackA, pillLeft)
    const segR = Math.min(trackB, pillRight)
    if (!(segR > segL)) continue
    const leftPct = ((segL - pillLeft) / pillW) * 100
    const widthPct = ((segR - segL) / pillW) * 100
    if (!(widthPct > 0)) continue
    out.push({
      leftPct: Math.max(0, leftPct),
      widthPct: Math.min(100 - Math.max(0, leftPct), widthPct),
    })
  }
  return out
}
