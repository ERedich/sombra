import { DEFAULT_HOTKEY_SETTINGS } from './defaults'
import type { HotkeyBinding, HotkeySettingsV1 } from './types'

export const HOTKEY_STORAGE_KEY = 'cmms-hotkeys-v1'

function isBinding(raw: unknown): raw is HotkeyBinding {
  if (raw === null || typeof raw !== 'object') return false
  const b = raw as Record<string, unknown>
  return (
    typeof b.code === 'string' &&
    typeof b.ctrlKey === 'boolean' &&
    typeof b.shiftKey === 'boolean' &&
    typeof b.altKey === 'boolean' &&
    typeof b.metaKey === 'boolean'
  )
}

export function loadHotkeySettings(): HotkeySettingsV1 {
  if (typeof window === 'undefined') return DEFAULT_HOTKEY_SETTINGS
  try {
    const raw = window.localStorage.getItem(HOTKEY_STORAGE_KEY)
    if (!raw) return DEFAULT_HOTKEY_SETTINGS
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') {
      return DEFAULT_HOTKEY_SETTINGS
    }
    const o = parsed as Record<string, unknown>
    const jump = o.jumpToSearchbar
    const create = o.createData
    const quick = o.quickAccess
    const last = o.openLastApp
    return {
      jumpToSearchbar:
        isBinding(jump) ?
          { ...DEFAULT_HOTKEY_SETTINGS.jumpToSearchbar, ...jump }
        : DEFAULT_HOTKEY_SETTINGS.jumpToSearchbar,
      createData:
        isBinding(create) ?
          { ...DEFAULT_HOTKEY_SETTINGS.createData, ...create }
        : DEFAULT_HOTKEY_SETTINGS.createData,
      quickAccess:
        isBinding(quick) ?
          { ...DEFAULT_HOTKEY_SETTINGS.quickAccess, ...quick }
        : DEFAULT_HOTKEY_SETTINGS.quickAccess,
      openLastApp:
        isBinding(last) ?
          { ...DEFAULT_HOTKEY_SETTINGS.openLastApp, ...last }
        : DEFAULT_HOTKEY_SETTINGS.openLastApp,
    }
  } catch {
    return DEFAULT_HOTKEY_SETTINGS
  }
}

export function saveHotkeySettings(next: HotkeySettingsV1): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore quota / private mode
  }
}
