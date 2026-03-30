import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_HOTKEY_SETTINGS } from './defaults'
import { loadHotkeySettings, saveHotkeySettings } from './storage'
import type { HotkeyBinding, HotkeySettingsV1 } from './types'

type HotkeySettingsContextValue = {
  jumpToSearchbar: HotkeyBinding
  setJumpToSearchbar: (next: HotkeyBinding) => void
  createData: HotkeyBinding
  setCreateData: (next: HotkeyBinding) => void
  quickAccess: HotkeyBinding
  setQuickAccess: (next: HotkeyBinding) => void
  openLastApp: HotkeyBinding
  setOpenLastApp: (next: HotkeyBinding) => void
  resetToDefaults: () => void
}

const HotkeySettingsContext = createContext<HotkeySettingsContextValue | null>(
  null,
)

function cloneDefaults(): HotkeySettingsV1 {
  return {
    jumpToSearchbar: { ...DEFAULT_HOTKEY_SETTINGS.jumpToSearchbar },
    createData: { ...DEFAULT_HOTKEY_SETTINGS.createData },
    quickAccess: { ...DEFAULT_HOTKEY_SETTINGS.quickAccess },
    openLastApp: { ...DEFAULT_HOTKEY_SETTINGS.openLastApp },
  }
}

export function HotkeySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<HotkeySettingsV1>(() =>
    loadHotkeySettings(),
  )

  const setJumpToSearchbar = useCallback((next: HotkeyBinding) => {
    setSettings((prev) => {
      const merged = { ...prev, jumpToSearchbar: { ...next } }
      saveHotkeySettings(merged)
      return merged
    })
  }, [])

  const setCreateData = useCallback((next: HotkeyBinding) => {
    setSettings((prev) => {
      const merged = { ...prev, createData: { ...next } }
      saveHotkeySettings(merged)
      return merged
    })
  }, [])

  const setQuickAccess = useCallback((next: HotkeyBinding) => {
    setSettings((prev) => {
      const merged = { ...prev, quickAccess: { ...next } }
      saveHotkeySettings(merged)
      return merged
    })
  }, [])

  const setOpenLastApp = useCallback((next: HotkeyBinding) => {
    setSettings((prev) => {
      const merged = { ...prev, openLastApp: { ...next } }
      saveHotkeySettings(merged)
      return merged
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    const next = cloneDefaults()
    saveHotkeySettings(next)
    setSettings(next)
  }, [])

  const value = useMemo(
    (): HotkeySettingsContextValue => ({
      jumpToSearchbar: settings.jumpToSearchbar,
      setJumpToSearchbar,
      createData: settings.createData,
      setCreateData,
      quickAccess: settings.quickAccess,
      setQuickAccess,
      openLastApp: settings.openLastApp,
      setOpenLastApp,
      resetToDefaults,
    }),
    [
      settings.jumpToSearchbar,
      settings.createData,
      settings.quickAccess,
      settings.openLastApp,
      setJumpToSearchbar,
      setCreateData,
      setQuickAccess,
      setOpenLastApp,
      resetToDefaults,
    ],
  )

  return (
    <HotkeySettingsContext.Provider value={value}>
      {children}
    </HotkeySettingsContext.Provider>
  )
}

export function useHotkeySettings(): HotkeySettingsContextValue {
  const ctx = useContext(HotkeySettingsContext)
  if (!ctx) {
    throw new Error(
      'useHotkeySettings must be used within HotkeySettingsProvider',
    )
  }
  return ctx
}
