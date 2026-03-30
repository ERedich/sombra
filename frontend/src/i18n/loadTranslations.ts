import { apiBase } from '../api'
import { i18n } from './i18n'

export type TranslationsResponse = {
  locale: string
  messages: Record<string, string>
}

/** Load API strings into i18next and switch language. */
export async function ensureTranslationsLoaded(locale: string): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/translations?locale=${encodeURIComponent(locale)}`,
  )
  if (!res.ok) {
    throw new Error(`translations ${res.status}`)
  }
  const data = (await res.json()) as TranslationsResponse
  i18n.addResourceBundle(
    data.locale,
    'translation',
    data.messages,
    true,
    true,
  )
  await i18n.changeLanguage(data.locale)
}
