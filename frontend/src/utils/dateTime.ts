import { i18n } from '../i18n/i18n'

const EM_DASH = '—'

/**
 * BCP 47 / i18next language for formatting (user’s chosen UI locale).
 */
function resolveLocale(explicit?: string): string {
  const raw = (explicit ?? i18n.language ?? 'en').trim()
  return raw.length > 0 ? raw : 'en'
}

function isGermanLocale(code: string): boolean {
  return code === 'de' || code.startsWith('de-')
}

/** en, en-US, en-GB, … */
function isEnglishLocale(code: string): boolean {
  return code === 'en' || code.startsWith('en-')
}

/** DE: DD.MM.YYYY (via Intl de-DE) */
const INTL_DATE_DE: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}

/** EN: MM/DD/YYYY — explicit en-US for consistent tables */
const INTL_DATE_EN: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  year: 'numeric',
}

/** 24h HH:MM for both DE and EN table parity */
const INTL_TIME_24H: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

const fmtDeDate = new Intl.DateTimeFormat('de-DE', INTL_DATE_DE)
const fmtDeTime = new Intl.DateTimeFormat('de-DE', INTL_TIME_24H)
const fmtEnDate = new Intl.DateTimeFormat('en-US', INTL_DATE_EN)
const fmtEnTime = new Intl.DateTimeFormat('en-US', INTL_TIME_24H)

/** Format ISO date (or date-only string) for list/table display. */
export function formatDate(iso: string, locale?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EM_DASH
  const loc = resolveLocale(locale)
  if (isGermanLocale(loc)) {
    return fmtDeDate.format(d)
  }
  if (isEnglishLocale(loc)) {
    return fmtEnDate.format(d)
  }
  return d.toLocaleDateString(loc, { dateStyle: 'short' })
}

/**
 * Format ISO timestamp for list/table display.
 * DE: DD.MM.YYYY - HH:MM (24h). EN: MM/DD/YYYY - HH:MM (24h).
 */
export function formatDateTime(iso: string, locale?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EM_DASH
  const loc = resolveLocale(locale)
  if (isGermanLocale(loc)) {
    return `${fmtDeDate.format(d)} - ${fmtDeTime.format(d)}`
  }
  if (isEnglishLocale(loc)) {
    return `${fmtEnDate.format(d)} - ${fmtEnTime.format(d)}`
  }
  return d.toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })
}
