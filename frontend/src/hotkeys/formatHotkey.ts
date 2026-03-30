import type { HotkeyBinding } from './types'

const MODIFIER_ORDER: Array<{
  key: keyof Pick<HotkeyBinding, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>
  win: string
  mac: string
}> = [
  { key: 'ctrlKey', win: 'Ctrl', mac: 'Ctrl' },
  { key: 'shiftKey', win: 'Shift', mac: 'Shift' },
  { key: 'altKey', win: 'Alt', mac: 'Alt' },
  { key: 'metaKey', win: 'Win', mac: '⌘' },
]

function codeToLabel(code: string): string {
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return code
  return code
}

/** Prefer ⌘ label when meta is used (macOS); otherwise Windows-style names. */
export function formatHotkey(b: HotkeyBinding, preferMacLabels = false): string {
  const parts: string[] = []
  for (const { key, win, mac } of MODIFIER_ORDER) {
    if (b[key]) parts.push(preferMacLabels && key === 'metaKey' ? mac : win)
  }
  parts.push(codeToLabel(b.code))
  return parts.join('+')
}
