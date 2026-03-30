import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PrimeReactContext } from 'primereact/api'
import { primeLocaleForAppLocale } from './registerPrimeLocales'

/**
 * Keeps PrimeReact `locale` in sync with i18next language (Calendar, pickers, etc.).
 */
export function PrimeLocaleSync() {
  const { i18n } = useTranslation()
  const ctx = useContext(PrimeReactContext)

  useEffect(() => {
    if (!ctx?.setLocale) return
    const code = primeLocaleForAppLocale(i18n.language)
    ctx.setLocale(code)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = i18n.language
    }
  }, [ctx, i18n.language])

  return null
}
