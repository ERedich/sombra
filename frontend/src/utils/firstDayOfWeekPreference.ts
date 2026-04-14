/** General app setting `fdw` (first day of week) — JSON values in `app_settings.general`. */
export const GENERAL_FDW_IDS = ['monday', 'sunday'] as const

export type GeneralFdwId = (typeof GENERAL_FDW_IDS)[number]

export const DEFAULT_GENERAL_FDW: GeneralFdwId = 'monday'

const ALLOWED = new Set<string>(GENERAL_FDW_IDS)

export function isGeneralFdwId(value: unknown): value is GeneralFdwId {
  return typeof value === 'string' && ALLOWED.has(value)
}

/** PrimeReact Calendar locale: 0 = Sunday, 1 = Monday. */
export function primeFirstDayOfWeekFromFdw(fdw: GeneralFdwId): 0 | 1 {
  return fdw === 'sunday' ? 0 : 1
}
