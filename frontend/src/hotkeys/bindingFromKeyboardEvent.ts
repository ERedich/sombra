import type { HotkeyBinding } from './types'

const MODIFIER_ONLY_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

/** Returns null if the event is only a modifier key (no main key to bind). */
export function bindingFromKeyboardEvent(
  e: KeyboardEvent,
): HotkeyBinding | null {
  if (MODIFIER_ONLY_CODES.has(e.code)) return null
  return {
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    code: e.code,
  }
}
