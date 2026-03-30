import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useHotkeySettings } from '../hotkeys/HotkeySettingsContext'
import { matchesHotkey } from '../hotkeys/matchesHotkey'

type RegisterFn = (fn: (() => void) | null) => void

const AppCreateShortcutContext = createContext<RegisterFn | null>(null)

export function AppCreateShortcutProvider({ children }: { children: ReactNode }) {
  const callbackRef = useRef<(() => void) | null>(null)
  const { createData } = useHotkeySettings()

  const register = useCallback((fn: (() => void) | null) => {
    callbackRef.current = fn
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, createData)) return
      const fn = callbackRef.current
      if (!fn) return
      e.preventDefault()
      fn()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [createData])

  return (
    <AppCreateShortcutContext.Provider value={register}>
      {children}
    </AppCreateShortcutContext.Provider>
  )
}

/** Registers the active screen’s “Create new record” handler (same as the Create toolbar button). */
export function useRegisterCreateShortcut(handler: () => void) {
  const register = useContext(AppCreateShortcutContext)
  if (!register) {
    throw new Error(
      'useRegisterCreateShortcut must be used within AppCreateShortcutProvider',
    )
  }
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useLayoutEffect(() => {
    register(() => {
      handlerRef.current()
    })
    return () => register(null)
  }, [register])
}
