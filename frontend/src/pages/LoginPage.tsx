import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { Password } from 'primereact/password'
import { apiBase } from '../api'
import { getToken, setAuth, type AuthUser } from '../auth'
import { ensureTranslationsLoaded } from '../i18n/loadTranslations'
import './LoginPage.css'

const LOCALE_STORAGE_KEY = 'cmms_login_locale'

type AppLocaleOption = { code: string; native_name: string }

/** Map BCP-47 locale to a 2-letter region for flag emoji; extend as new app_locales are added. */
function localeToRegionCode(localeCode: string): string {
  const lc = localeCode.toLowerCase()
  const parts = lc.split(/[-_]/)
  const lang = parts[0] ?? lc
  const second = parts[1]
  if (second && second.length === 2 && /^[a-z]{2}$/.test(second)) {
    return second
  }
  const LANG_TO_REGION: Record<string, string> = {
    en: 'gb',
    de: 'de',
    fr: 'fr',
    es: 'es',
    it: 'it',
    pt: 'pt',
    nl: 'nl',
    pl: 'pl',
    sv: 'se',
    da: 'dk',
    fi: 'fi',
    no: 'no',
    nb: 'no',
    cs: 'cz',
    sk: 'sk',
    hu: 'hu',
    ro: 'ro',
    bg: 'bg',
    el: 'gr',
    tr: 'tr',
    uk: 'ua',
    ru: 'ru',
    ja: 'jp',
    ko: 'kr',
    zh: 'cn',
  }
  return LANG_TO_REGION[lang] ?? 'un'
}

function regionCodeToFlagEmoji(region: string): string {
  const r = region.toUpperCase()
  if (r.length !== 2 || !/^[A-Z]{2}$/.test(r)) return '🏳️'
  return String.fromCodePoint(
    0x1f1e6 + r.charCodeAt(0) - 65,
    0x1f1e6 + r.charCodeAt(1) - 65,
  )
}

function needsWorkingSitePicker(user: AuthUser): boolean {
  if (user.login_name === 'admin') return false
  if (!user.allow_site_change_on_login) return false
  const ids = new Set(
    [user.working_site_id, ...user.additional_site_ids].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    ),
  )
  return ids.size >= 2
}

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [siteDialogOpen, setSiteDialogOpen] = useState(false)
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null)
  const [pickedSiteId, setPickedSiteId] = useState<string | null>(null)
  const [siteSubmitting, setSiteSubmitting] = useState(false)
  const [localeOptions, setLocaleOptions] = useState<AppLocaleOption[]>([])
  const [selectedLocale, setSelectedLocale] = useState('en')
  const [i18nReady, setI18nReady] = useState(false)

  useEffect(() => {
    if (getToken()) navigate('/', { replace: true })
  }, [navigate])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const locRes = await fetch(`${apiBase}/api/locales`)
        const locData = (await locRes.json()) as { locales: AppLocaleOption[] }
        if (cancelled) return
        const list = locData.locales ?? []
        setLocaleOptions(list)
        const saved =
          typeof localStorage !== 'undefined' ?
            localStorage.getItem(LOCALE_STORAGE_KEY)
          : null
        const initial =
          saved && list.some((l) => l.code === saved) ?
            saved
          : (list[0]?.code ?? 'en')
        setSelectedLocale(initial)
        await ensureTranslationsLoaded(initial)
        if (!cancelled) setI18nReady(true)
      } catch {
        if (!cancelled) setI18nReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onLocaleChange = useCallback(async (code: string | null) => {
    if (!code) return
    setSelectedLocale(code)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code)
      await ensureTranslationsLoaded(code)
    } catch {
      /* keep UI usable */
    }
  }, [])

  async function finishLogin(token: string, user: AuthUser) {
    await ensureTranslationsLoaded(user.locale)
    setAuth(token, user)
    navigate('/', { replace: true })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_name: loginName.trim(),
          password,
          locale: selectedLocale,
        }),
      })
      const data = (await res.json()) as {
        error?: string
        token?: string
        user?: AuthUser
      }
      if (!res.ok) {
        setError(data.error ?? t('login.error_login_failed'))
        return
      }
      if (!data.token || !data.user) {
        setError(t('login.error_invalid_response'))
        return
      }
      const user = normalizeAuthUserFromApi(data.user)
      if (needsWorkingSitePicker(user)) {
        setPendingToken(data.token)
        setPendingUser(user)
        setPickedSiteId(user.working_site_id)
        setSiteDialogOpen(true)
        return
      }
      await finishLogin(data.token, user)
    } catch {
      setError(t('login.error_network'))
    } finally {
      setLoading(false)
    }
  }

  async function confirmWorkingSite() {
    if (!pendingToken || !pickedSiteId) return
    setSiteSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/auth/working-site`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({ working_site_id: pickedSiteId }),
      })
      const data = (await res.json()) as {
        error?: string
        token?: string
        user?: AuthUser
      }
      if (!res.ok) {
        setError(data.error ?? t('login.error_working_site'))
        return
      }
      if (!data.token || !data.user) {
        setError(t('login.error_invalid_response'))
        return
      }
      setSiteDialogOpen(false)
      setPendingToken(null)
      setPendingUser(null)
      await finishLogin(data.token, normalizeAuthUserFromApi(data.user))
    } catch {
      setError(t('login.error_network'))
    } finally {
      setSiteSubmitting(false)
    }
  }

  function skipWorkingSitePicker() {
    if (!pendingToken || !pendingUser) return
    setSiteDialogOpen(false)
    const tkn = pendingToken
    const u = pendingUser
    setPendingToken(null)
    setPendingUser(null)
    void finishLogin(tkn, u)
  }

  if (!i18nReady) {
    return (
      <div className="login-page">
        <div className="login-page__backdrop" aria-hidden />
        <div className="login-page__layout">
          <div className="login-page__left" aria-hidden />
          <aside className="login-page__panel flex align-items-center justify-content-center">
            <span className="login-page__loading" aria-busy="true">
              …
            </span>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-page__backdrop" aria-hidden />
      <div className="login-page__layout">
        <div className="login-page__left" />
        <aside className="login-page__panel">
          <div
            className="login-page__locale"
            role="group"
            aria-label={t('login.locale_label')}
          >
            {localeOptions.map((opt) => {
              const flag = regionCodeToFlagEmoji(localeToRegionCode(opt.code))
              const active = selectedLocale === opt.code
              return (
                <button
                  key={opt.code}
                  type="button"
                  title={opt.native_name}
                  aria-label={opt.native_name}
                  aria-pressed={active}
                  disabled={loading || localeOptions.length === 0}
                  onClick={() => void onLocaleChange(opt.code)}
                  className={
                    'flex align-items-center justify-content-center border-circle p-0 cursor-pointer transition-all transition-duration-150 ' +
                    (active ?
                      'shadow-1'
                    : 'border-2 border-transparent')
                  }
                  style={{ width: '2.25rem', height: '2.25rem' }}
                >
                  <span className="text-xl line-height-1" aria-hidden>
                    {flag}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="login-page__panel-inner">
            <Card title={t('login.title')} className="w-full">
              <form
                className="flex flex-column gap-3"
                onSubmit={(e) => void onSubmit(e)}
              >
                <div className="flex flex-column gap-2">
                  <label htmlFor="login-name" className="text-sm font-medium">
                    {t('login.login_name_label')}
                  </label>
                  <InputText
                    id="login-name"
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    className="w-full"
                    autoComplete="username"
                    disabled={loading}
                  />
                </div>
                <div className="flex flex-column gap-2">
                  <label htmlFor="login-password" className="text-sm font-medium">
                    {t('login.password_label')}
                  </label>
                  <Password
                    id="login-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    feedback={false}
                    toggleMask
                    className="w-full"
                    inputClassName="w-full"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                </div>
                {error ? (
                  <Message severity="error" text={error} className="w-full" />
                ) : null}
                <Button
                  type="submit"
                  label={t('login.sign_in')}
                  icon="pi pi-sign-in"
                  loading={loading}
                  className="w-full"
                />
              </form>
            </Card>
          </div>
        </aside>
      </div>

      <Dialog
        header={t('login.working_site_title')}
        visible={siteDialogOpen}
        onHide={() => !siteSubmitting && skipWorkingSitePicker()}
        dismissableMask={!siteSubmitting}
        style={{ width: 'min(26rem, 95vw)' }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('login.keep_current')}
              severity="secondary"
              outlined
              onClick={skipWorkingSitePicker}
              disabled={siteSubmitting}
            />
            <Button
              type="button"
              label={t('login.continue')}
              icon="pi pi-check"
              onClick={() => void confirmWorkingSite()}
              loading={siteSubmitting}
              disabled={!pickedSiteId}
            />
          </div>
        }
      >
        <p className="text-sm text-color-secondary mt-0">
          {t('login.working_site_help')}
        </p>
        <div className="flex flex-column gap-2 pt-2">
          <span className="text-sm font-medium">
            {t('login.working_site_label')}
          </span>
          <Dropdown
            value={pickedSiteId}
            onChange={(e) => setPickedSiteId(e.value as string | null)}
            options={pendingUser?.selectable_working_sites ?? []}
            optionLabel="name"
            optionValue="id"
            className="w-full"
            disabled={siteSubmitting}
            placeholder={t('login.working_site_placeholder')}
            itemTemplate={(opt) => (
              <span>
                {(opt as { name: string; key: string }).name}{' '}
                <span className="text-color-secondary text-sm">
                  ({(opt as { key: string }).key})
                </span>
              </span>
            )}
            valueTemplate={(opt) =>
              opt ? (
                <span>
                  {(opt as { name: string; key: string }).name}{' '}
                  <span className="text-color-secondary text-sm">
                    ({(opt as { key: string }).key})
                  </span>
                </span>
              ) : (
                <span>{t('login.working_site_placeholder')}</span>
              )
            }
          />
        </div>
      </Dialog>
    </div>
  )
}

function normalizeAuthUserFromApi(u: AuthUser): AuthUser {
  return {
    ...u,
    working_site_id: u.working_site_id ?? null,
    allow_site_change_on_login: Boolean(u.allow_site_change_on_login),
    additional_site_ids: Array.isArray(u.additional_site_ids)
      ? u.additional_site_ids
      : [],
    accessible_site_ids: Array.isArray(u.accessible_site_ids)
      ? u.accessible_site_ids
      : [],
    selectable_working_sites: Array.isArray(u.selectable_working_sites)
      ? u.selectable_working_sites
      : [],
    locale: typeof u.locale === 'string' && u.locale.length > 0 ? u.locale : 'en',
  }
}
