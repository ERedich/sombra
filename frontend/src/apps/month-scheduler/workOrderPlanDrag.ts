import { parseYmd } from './calendarGrid'

export const MCAL_WO_DRAG_MIME = 'application/x-sombra-mcal-wo+json' as const

export type McalWoDragPayload = {
  woId: string
  /** Inclusive calendar span (local YMD) — matches scheduler bar. */
  spanStartYmd: string
  spanEndYmd: string
}

export function parseMcalWoDragPayload(
  raw: string,
): McalWoDragPayload | null {
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (typeof o.woId !== 'string' || !o.woId.trim()) return null
    if (typeof o.spanStartYmd !== 'string' || typeof o.spanEndYmd !== 'string')
      return null
    return {
      woId: o.woId.trim(),
      spanStartYmd: o.spanStartYmd,
      spanEndYmd: o.spanEndYmd,
    }
  } catch {
    return null
  }
}

/** Signed calendar-day difference (a − b) using local noon dates. */
export function diffYmdDays(aYmd: string, bYmd: string): number {
  const a = parseYmd(aYmd).getTime()
  const b = parseYmd(bYmd).getTime()
  return Math.round((a - b) / 86_400_000)
}

/** Shift an ISO instant by whole calendar days (local date arithmetic). */
export function addDaysToIsoInstant(iso: string, dayDelta: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + dayDelta)
  return d.toISOString()
}
