import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useContext, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PrimeReactContext } from 'primereact/api'
import { Button } from 'primereact/button'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { clearAuth, getStoredUser } from '../auth'
import { getAppsForUser } from '../navigation/registeredApps'
import '../App.css'

const THEME_LINK_ID = 'theme-link'
const THEME_LIGHT = 'lara-light-amber'
const THEME_DARK = 'lara-dark-amber'
const STORAGE_KEY = 'cmms-theme-dark'

const SIDEBAR_WIDTH = '16rem'

function themeHref(theme: string) {
  return `/themes/${theme}/theme.css`
}

const sidebarStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: SIDEBAR_WIDTH,
  height: '100vh',
  maxHeight: '100vh',
  overflow: 'hidden',
  zIndex: 100,
}

const mainStyle: CSSProperties = {
  marginLeft: SIDEBAR_WIDTH,
  minHeight: '100vh',
  overflowY: 'auto',
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { changeTheme } = useContext(PrimeReactContext)
  const user = getStoredUser()
  const navApps = getAppsForUser(user)

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  const applyDarkMode = useCallback(
    (isDark: boolean) => {
      const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null
      const href = link?.getAttribute('href') ?? ''
      const currentlyDark = href.includes(THEME_DARK)
      if (isDark === currentlyDark) return
      if (isDark) {
        changeTheme?.(THEME_LIGHT, THEME_DARK, THEME_LINK_ID, () => {
          const el = document.getElementById(THEME_LINK_ID) as HTMLLinkElement
          if (el) el.href = themeHref(THEME_DARK)
        })
      } else {
        changeTheme?.(THEME_DARK, THEME_LIGHT, THEME_LINK_ID, () => {
          const el = document.getElementById(THEME_LINK_ID) as HTMLLinkElement
          if (el) el.href = themeHref(THEME_LIGHT)
        })
      }
    },
    [changeTheme],
  )

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, darkMode ? '1' : '0')
    applyDarkMode(darkMode)
  }, [darkMode, applyDarkMode])

  function confirmLogout() {
    confirmDialog({
      tagKey: 'logout',
      header: t('shell.logout_confirm_header'),
      message: t('shell.logout_confirm_message'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('shell.logout_accept'),
      rejectLabel: t('shell.logout_reject'),
      defaultFocus: 'reject',
      dismissableMask: true,
      accept: () => {
        clearAuth()
        navigate('/login', { replace: true })
      },
    })
  }

  return (
    <div className="bg-surface-ground">
      <ConfirmDialog tagKey="logout" dismissableMask />
      <aside
        className="bg-surface-section app-sidebar flex flex-column"
        style={sidebarStyle}
        aria-label={t('shell.nav_aria')}
      >
        <div className="flex flex-column h-full w-full overflow-hidden">
          <div className="flex-shrink-0 p-3">
            <span className="text-xl font-semibold block mb-3">
              {t('shell.brand_name')}
            </span>
            <nav className="flex flex-column gap-1 overflow-hidden">
              {navApps.map((app) => (
                <NavLink
                  key={app.path}
                  to={app.path}
                  end={app.path === '/'}
                  className={({ isActive }) =>
                    [
                      'app-sidebar-link',
                      'flex align-items-center gap-2 px-2 py-2 border-round text-sm no-underline transition-colors transition-duration-150',
                      isActive ? 'app-sidebar-link--active' : 'text-color-secondary',
                    ].join(' ')
                  }
                >
                  <i className={app.icon} aria-hidden />
                  <span>{t(app.labelKey)}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex-grow-1 flex-shrink-1 min-h-0" aria-hidden />

          <div className="flex-shrink-0 p-3 app-sidebar-footer flex flex-column gap-3">
            {user ? (
              <div className="text-sm text-color-secondary line-height-3">
                <div className="font-medium text-color">{user.name}</div>
                <div className="text-xs">{user.login_name}</div>
              </div>
            ) : null}
            <div className="flex justify-content-center">
              <Button
                type="button"
                icon={darkMode ? 'pi pi-sun' : 'pi pi-moon'}
                rounded
                text
                severity="secondary"
                onClick={() => setDarkMode((d) => !d)}
                aria-label={
                  darkMode
                    ? t('shell.theme_light_aria')
                    : t('shell.theme_dark_aria')
                }
              />
            </div>
            <Button
              type="button"
              label={t('shell.log_out')}
              icon="pi pi-sign-out"
              severity="secondary"
              outlined
              className="w-full"
              onClick={confirmLogout}
            />
          </div>
        </div>
      </aside>

      <main className="bg-surface-ground" style={mainStyle}>
        {children}
      </main>
    </div>
  )
}
