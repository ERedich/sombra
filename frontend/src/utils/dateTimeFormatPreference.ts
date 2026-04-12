/** Mirrors backend `GeneralDtfId` / `general.dtf`. */
export const GENERAL_DTF_IDS = [
  'ddmmyyyy_hhmm',
  'ddmmyy_hhmm',
  'mmddyyyy_hhmm',
  'mmddyy_hhmm',
] as const

export type GeneralDtfId = (typeof GENERAL_DTF_IDS)[number]

export const DEFAULT_GENERAL_DTF: GeneralDtfId = 'ddmmyyyy_hhmm'

const ALLOWED = new Set<string>(GENERAL_DTF_IDS)

export function isGeneralDtfId(value: unknown): value is GeneralDtfId {
  return typeof value === 'string' && ALLOWED.has(value)
}

let currentDtf: GeneralDtfId = DEFAULT_GENERAL_DTF

export function setDateTimeFormatPreference(id: GeneralDtfId): void {
  currentDtf = id
}

export function getDateTimeFormatPreference(): GeneralDtfId {
  return currentDtf
}

/** Prime Calendar: `yy` = 4-digit year, `y` = 2-digit (PrimeReact convention). */
export function primeDateFormatForDtf(dtf: GeneralDtfId): string {
  switch (dtf) {
    case 'ddmmyyyy_hhmm':
      return 'dd.mm.yy'
    case 'ddmmyy_hhmm':
      return 'dd.mm.y'
    case 'mmddyyyy_hhmm':
      return 'mm/dd/yy'
    case 'mmddyy_hhmm':
      return 'mm/dd/y'
    default:
      return 'dd.mm.yy'
  }
}
