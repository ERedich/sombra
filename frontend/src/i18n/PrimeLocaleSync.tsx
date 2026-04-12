import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { addLocale, PrimeReactContext } from 'primereact/api'
import { useAppParameters } from '../layout/AppParametersProvider'
import { primeDateFormatForDtf } from '../utils/dateTimeFormatPreference'
import { primeLocaleForAppLocale } from './registerPrimeLocales'

/**
 * Keeps PrimeReact `locale` in sync with i18next language (Calendar, pickers, etc.)
 * and Calendar `dateFormat` in sync with general app setting `dtf`.
 */
export function PrimeLocaleSync() {
  const { i18n } = useTranslation()
  const ctx = useContext(PrimeReactContext)
  const { dtf } = useAppParameters()

  useEffect(() => {
    const fmt = primeDateFormatForDtf(dtf)
    addLocale('de', { dateFormat: fmt })
    addLocale('en', { dateFormat: fmt })
  }, [dtf])

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
