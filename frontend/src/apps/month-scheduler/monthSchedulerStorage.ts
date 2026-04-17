import type { CalendarEvent } from './types'
import { EVENT_TYPE_IDS } from './types'

const STORAGE_PREFIX = 'cmms-month-scheduler-events'

function isEventTypeId(x: unknown): x is CalendarEvent['type'] {
  return typeof x === 'string' && (EVENT_TYPE_IDS as readonly string[]).includes(x)
}

function isValidEvent(x: unknown): x is CalendarEvent {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'number' &&
    typeof o.title === 'string' &&
    typeof o.start === 'string' &&
    typeof o.end === 'string' &&
    isEventTypeId(o.type)
  )
}

function storageKey(siteId: string): string {
  return `${STORAGE_PREFIX}:${siteId}`
}

export function loadEventsForSite(siteId: string): CalendarEvent[] {
  try {
    const raw = sessionStorage.getItem(storageKey(siteId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidEvent)
  } catch {
    return []
  }
}

export function persistEventsForSite(
  siteId: string,
  events: CalendarEvent[],
): void {
  sessionStorage.setItem(storageKey(siteId), JSON.stringify(events))
}
