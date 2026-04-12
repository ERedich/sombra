import { getDateTimeFormatPreference, type GeneralDtfId } from './dateTimeFormatPreference'

const EM_DASH = '—'

const INTL_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

function datePartOptions(dtf: GeneralDtfId): {
  locale: string
  opts: Intl.DateTimeFormatOptions
} {
  switch (dtf) {
    case 'ddmmyyyy_hhmm':
      return {
        locale: 'de-DE',
        opts: { day: '2-digit', month: '2-digit', year: 'numeric' },
      }
    case 'ddmmyy_hhmm':
      return {
        locale: 'de-DE',
        opts: { day: '2-digit', month: '2-digit', year: '2-digit' },
      }
    case 'mmddyyyy_hhmm':
      return {
        locale: 'en-US',
        opts: { month: '2-digit', day: '2-digit', year: 'numeric' },
      }
    case 'mmddyy_hhmm':
      return {
        locale: 'en-US',
        opts: { month: '2-digit', day: '2-digit', year: '2-digit' },
      }
    default:
      return {
        locale: 'de-DE',
        opts: { day: '2-digit', month: '2-digit', year: 'numeric' },
      }
  }
}

function formatDatePart(d: Date, dtf: GeneralDtfId): string {
  const { locale, opts } = datePartOptions(dtf)
  return new Intl.DateTimeFormat(locale, opts).format(d)
}

function formatTimePart(d: Date, dtf: GeneralDtfId): string {
  const { locale } = datePartOptions(dtf)
  return new Intl.DateTimeFormat(locale, INTL_TIME).format(d)
}

/** Format ISO date (or date-only string) for list/table display. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EM_DASH
  const dtf = getDateTimeFormatPreference()
  return formatDatePart(d, dtf)
}

/** Format ISO timestamp for list/table display (24h time). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EM_DASH
  const dtf = getDateTimeFormatPreference()
  return `${formatDatePart(d, dtf)} - ${formatTimePart(d, dtf)}`
}
