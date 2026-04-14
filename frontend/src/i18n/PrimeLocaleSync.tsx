import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { addLocale, PrimeReactContext } from 'primereact/api'
import { useAppParameters } from '../layout/AppParametersProvider'
import { primeFirstDayOfWeekFromFdw } from '../utils/firstDayOfWeekPreference'
import { primeDateFormatForDtf } from '../utils/dateTimeFormatPreference'
import { primeLocaleForAppLocale } from './registerPrimeLocales'

/**
 * Keeps PrimeReact `locale` in sync with i18next language (Calendar, pickers, etc.)
 * and Calendar `dateFormat` in sync with general app setting `dtf`.
 */
export function PrimeLocaleSync() {
  const { i18n } = useTranslation()
  const ctx = useContext(PrimeReactContext)
  const { dtf, fdw } = useAppParameters()

  useEffect(() => {
    const fmt = primeDateFormatForDtf(dtf)
    const firstDayOfWeek = primeFirstDayOfWeekFromFdw(fdw)
    addLocale('de', { dateFormat: fmt, firstDayOfWeek })
    addLocale('en', { dateFormat: fmt, firstDayOfWeek })
  }, [dtf, fdw])

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
