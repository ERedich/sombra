import {
  localYmdToDayStartMs,
  woSegmentMsOnLocalDay,
} from './capacityWoShiftOverlap'

const MS_PER_DAY = 86400000

/** 15-minute slots per local calendar day (96 per day). */
export const DAY_SLOTS_15MIN = 96

/** @deprecated Use {@link DAY_SLOTS_15MIN} — same value; name kept for older imports. */
export const UTC_DAY_SLOTS_15MIN = DAY_SLOTS_15MIN

/** Left/width % of the local calendar day track for the WO segment that falls on `ymd`. */
export function barLayoutIntersectLocalDay(
  planStartIso: string | null,
  planEndIso: string | null,
  ymd: string,
): { leftPct: number; widthPct: number } | null {
  if (!planStartIso || !planEndIso) return null
  const seg = woSegmentMsOnLocalDay(planStartIso, planEndIso, ymd)
  if (!seg) return null
  const dayStart = localYmdToDayStartMs(ymd)
  if (Number.isNaN(dayStart)) return null
  const leftPct = ((seg.lo - dayStart) / MS_PER_DAY) * 100
  const widthPct = ((seg.hi - seg.lo) / MS_PER_DAY) * 100
  if (!(widthPct > 0)) return null
  return { leftPct, widthPct }
}

/** Slot index from pointer X on a horizontal track (`numSlots` equal-width columns). */
export function slotIndexFromClientX(
  clientX: number,
  trackEl: HTMLElement,
  numSlots: number,
): number {
  if (numSlots <= 0) return 0
  const rect = trackEl.getBoundingClientRect()
  const w = rect.width || 1
  const x = Math.max(0, Math.min(clientX - rect.left, w))
  const idx = Math.floor((x / w) * numSlots)
  return Math.max(0, Math.min(idx, numSlots - 1))
}

/** Local instant at `targetYmd` start + `slotIndex` × 15 minutes (slotIndex 0..95). */
export function planStartSnappedToLocal15MinSlot(
  targetYmd: string,
  slotIndex: number,
): Date {
  const q = Math.max(0, Math.min(Math.floor(slotIndex), DAY_SLOTS_15MIN - 1))
  const [y, m, d] = targetYmd.split('-').map(Number)
  const totalMinutes = q * 15
  return new Date(
    y,
    m - 1,
    d,
    Math.floor(totalMinutes / 60),
    totalMinutes % 60,
    0,
    0,
  )
}

export function woCapacityPlanDurationExceeds24h(
  planStartIso: string,
  planEndIso: string,
): boolean {
  const lo = new Date(planStartIso).getTime()
  const hi = new Date(planEndIso).getTime()
  if (!(hi > lo)) return false
  return hi - lo > MS_PER_DAY
}
