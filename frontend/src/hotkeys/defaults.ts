import type { HotkeyBinding, HotkeySettingsV1 } from './types'

export const DEFAULT_JUMP_TO_SEARCHBAR: HotkeyBinding = {
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  code: 'KeyF',
}

export const DEFAULT_CREATE_DATA: HotkeyBinding = {
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  code: 'KeyN',
}

export const DEFAULT_QUICK_ACCESS: HotkeyBinding = {
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  metaKey: false,
  code: 'KeyF',
}

export const DEFAULT_OPEN_LAST_APP: HotkeyBinding = {
  ctrlKey: false,
  shiftKey: false,
  altKey: true,
  metaKey: false,
  code: 'KeyQ',
}

export const DEFAULT_HOTKEY_SETTINGS: HotkeySettingsV1 = {
  jumpToSearchbar: DEFAULT_JUMP_TO_SEARCHBAR,
  createData: DEFAULT_CREATE_DATA,
  quickAccess: DEFAULT_QUICK_ACCESS,
  openLastApp: DEFAULT_OPEN_LAST_APP,
}
