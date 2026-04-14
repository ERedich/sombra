import { addLocale } from 'primereact/api'

/**
 * PrimeReact component locales (Calendar, DataTable, etc.).
 * Add entries here when new app_locales codes are introduced and PrimeReact provides a bundle.
 */
const dePrime: Record<string, unknown> = {
  accept: 'Ja',
  reject: 'Nein',
  cancel: 'Abbrechen',
  clear: 'Leeren',
  today: 'Heute',
  weekHeader: 'KW',
  // firstDayOfWeek: set from general.fdw in PrimeLocaleSync (defaults to Monday there).
  // Prime Calendar: paired `yy` renders full calendar year (DD.MM.YYYY-style).
  dateFormat: 'dd.mm.yy',
  monthNames: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  monthNamesShort: [
    'Jan',
    'Feb',
    'Mär',
    'Apr',
    'Mai',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Okt',
    'Nov',
    'Dez',
  ],
  dayNames: [
    'Sonntag',
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag',
  ],
  dayNamesShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  dayNamesMin: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  emptyFilterMessage: 'Keine Ergebnisse',
  emptyMessage: 'Keine Einträge',
  emptySearchMessage: 'Keine Ergebnisse',
  filter: 'Filter',
  searchMessage: '{0} Ergebnisse verfügbar',
  selectionMessage: '{0} Einträge ausgewählt',
}

export function registerPrimeLocales(): void {
  addLocale('de', dePrime)
}

/** Map app locale code to PrimeReact locale key (fallback to `en`). */
export function primeLocaleForAppLocale(code: string): string {
  if (code === 'de') return 'de'
  return 'en'
}
