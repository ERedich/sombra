import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useHotkeySettings } from '../hotkeys/HotkeySettingsContext'
import { matchesHotkey } from '../hotkeys/matchesHotkey'

type RegisterFn = (el: HTMLInputElement | null) => void

const AppToolbarSearchFocusContext = createContext<RegisterFn | null>(null)

export function AppToolbarSearchFocusProvider({
  children,
}: {
  children: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { jumpToSearchbar } = useHotkeySettings()

  const registerToolbarSearch = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, jumpToSearchbar)) return
      const el = inputRef.current
      if (!el) return
      e.preventDefault()
      el.focus()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [jumpToSearchbar])

  return (
    <AppToolbarSearchFocusContext.Provider value={registerToolbarSearch}>
      {children}
    </AppToolbarSearchFocusContext.Provider>
  )
}

export function useRegisterAppToolbarSearch(): RefObject<HTMLInputElement | null> {
  const register = useContext(AppToolbarSearchFocusContext)
  if (!register) {
    throw new Error(
      'useRegisterAppToolbarSearch must be used within AppToolbarSearchFocusProvider',
    )
  }
  const ref = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    register(ref.current)
    return () => register(null)
  })

  return ref
}
