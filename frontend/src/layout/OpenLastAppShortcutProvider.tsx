import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getToken } from '../auth'
import { useHotkeySettings } from '../hotkeys/HotkeySettingsContext'
import { matchesHotkey } from '../hotkeys/matchesHotkey'
import { REGISTERED_APPS } from '../navigation/registeredApps'

function isRegisteredAppPath(pathname: string): boolean {
  return REGISTERED_APPS.some((a) => a.path === pathname)
}

/**
 * Tracks the last registered app route the user left and navigates back when
 * the Open last app shortcut fires.
 */
export function OpenLastAppShortcutProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { openLastApp } = useHotkeySettings()
  const prevPathRef = useRef(location.pathname)
  const lastAppPathRef = useRef<string | null>(null)

  useEffect(() => {
    const prev = prevPathRef.current
    const next = location.pathname
    if (prev !== next) {
      if (isRegisteredAppPath(prev)) {
        lastAppPathRef.current = prev
      }
      prevPathRef.current = next
    }
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-capture]'))
        return
      if (!matchesHotkey(e, openLastApp)) return
      if (!getToken() || location.pathname === '/login') return
      const target = lastAppPathRef.current
      if (!target || target === location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      navigate(target)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [openLastApp, location.pathname, navigate])

  return <>{children}</>
}
