import type { HotkeyBinding } from './types'

export function matchesHotkey(e: KeyboardEvent, b: HotkeyBinding): boolean {
  return (
    e.ctrlKey === b.ctrlKey &&
    e.shiftKey === b.shiftKey &&
    e.altKey === b.altKey &&
    e.metaKey === b.metaKey &&
    e.code === b.code
  )
}
