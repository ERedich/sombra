/** Must match backend WO status keys used in app settings. */
export const WORK_ORDER_STATUS_KEYS = [
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
  'done',
  'closed',
] as const

export type WorkOrderStatusColourKey = (typeof WORK_ORDER_STATUS_KEYS)[number]

/** Default badge colours when custom status colours (WOST) are enabled. */
export const DEFAULT_WORK_ORDER_STATUS_HEX: Record<
  WorkOrderStatusColourKey,
  string
> = {
  open: '#0ea5e9',
  assigned: '#64748b',
  started: '#f59e0b',
  continued: '#d97706',
  on_hold: '#ea580c',
  done: '#22c55e',
  closed: '#1e293b',
}

const HEX6 = /^#[0-9A-Fa-f]{6}$/

/** PrimeReact ColorPicker uses six hex digits without a leading `#`. */
export function woStatusHexToPickerValue(hex: string): string {
  const s = hex.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '000000'
}

export function woStatusHexFromPickerValue(value: string): string {
  const s = value.replace(/^#/, '').toLowerCase()
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : '#000000'
}

export function mergeDisplayStatusColours(
  overrides: Partial<Record<WorkOrderStatusColourKey, string>>,
): Record<WorkOrderStatusColourKey, string> {
  const out = { ...DEFAULT_WORK_ORDER_STATUS_HEX }
  for (const k of WORK_ORDER_STATUS_KEYS) {
    const v = overrides[k]
    if (typeof v === 'string' && HEX6.test(v.trim())) {
      out[k] = v.trim().toLowerCase()
    }
  }
  return out
}
