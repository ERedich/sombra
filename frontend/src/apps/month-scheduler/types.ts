/** Category ids — labels come from i18n keys `mcal.type_*`. */
export const EVENT_TYPE_IDS = [
  'work',
  'personal',
  'health',
  'social',
  'travel',
  'other',
] as const

export type EventTypeId = (typeof EVENT_TYPE_IDS)[number]

export type CalendarEvent = {
  id: number
  title: string
  /** Inclusive YYYY-MM-DD */
  start: string
  /** Inclusive YYYY-MM-DD */
  end: string
  type: EventTypeId
}

/** Merged view: local session events + work orders (plan range). */
export type SchedulerEvent = {
  id: string
  title: string
  start: string
  end: string
  color: string
  source: 'local' | 'work_order'
  /** Set when `source === 'local'` */
  localNumericId?: number
  /** Set when `source === 'work_order'` */
  woId?: string
  /** Set when `source === 'work_order'` — display key on the bar. */
  woKey?: number
}

export type EventTypeStyle = {
  id: EventTypeId
  /** i18n msg_key */
  labelKey: string
  color: string
}

export const EVENT_TYPE_STYLES: EventTypeStyle[] = [
  { id: 'work', labelKey: 'mcal.type_work', color: '#3B82F6' },
  { id: 'personal', labelKey: 'mcal.type_personal', color: '#8B5CF6' },
  { id: 'health', labelKey: 'mcal.type_health', color: '#10B981' },
  { id: 'social', labelKey: 'mcal.type_social', color: '#F59E0B' },
  { id: 'travel', labelKey: 'mcal.type_travel', color: '#EF4444' },
  { id: 'other', labelKey: 'mcal.type_other', color: '#6B7280' },
]
