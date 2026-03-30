import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getToken, getStoredUser } from '../auth'
import { i18n } from './i18n'
import { ensureTranslationsLoaded } from './loadTranslations'

/**
 * Loads UI strings for authenticated routes before rendering children.
 * Login page loads translations on its own.
 */
export function AppI18nLoader({ children }: { children: ReactNode }) {
  const location = useLocation()
  const loadedLocaleRef = useRef<string | null>(null)
  const [ready, setReady] = useState(
    () => location.pathname === '/login' || !getToken(),
  )

  useEffect(() => {
    if (location.pathname === '/login') {
      setReady(true)
      return
    }
    const token = getToken()
    if (!token) {
      setReady(true)
      return
    }
    const user = getStoredUser()
    const loc = user?.locale ?? 'en'
    if (loadedLocaleRef.current === loc && i18n.language === loc) {
      setReady(true)
      return
    }
    setReady(false)
    void ensureTranslationsLoaded(loc)
      .then(() => {
        loadedLocaleRef.current = loc
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [location.pathname])

  if (!ready) {
    return (
      <div
        className="min-h-screen bg-surface-ground flex align-items-center justify-content-center"
        aria-busy="true"
        aria-label="Loading"
      />
    )
  }
  return children
}
