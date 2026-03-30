/** Serializable shortcut; use `code` (e.g. KeyF) for layout-stable matching. */
export type HotkeyBinding = {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  code: string
}

export type HotkeySettingsV1 = {
  jumpToSearchbar: HotkeyBinding
  /** Triggers Create / new-record on list screens that register a handler. */
  createData: HotkeyBinding
  /** Opens Quick Access (app search + recent apps). */
  quickAccess: HotkeyBinding
  /** Navigate to the app you were on before the current screen. */
  openLastApp: HotkeyBinding
}
