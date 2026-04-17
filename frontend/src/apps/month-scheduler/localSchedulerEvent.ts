import type { CalendarEvent, SchedulerEvent } from './types'
import { EVENT_TYPE_STYLES } from './types'

function colorForType(type: CalendarEvent['type']): string {
  return EVENT_TYPE_STYLES.find((t) => t.id === type)?.color ?? '#6B7280'
}

export function localCalendarEventToScheduler(ev: CalendarEvent): SchedulerEvent {
  return {
    id: `local:${ev.id}`,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    color: colorForType(ev.type),
    source: 'local',
    localNumericId: ev.id,
  }
}
