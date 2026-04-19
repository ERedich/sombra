import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PrimeReactContext } from 'primereact/api'
import { Button } from 'primereact/button'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { Dialog } from 'primereact/dialog'
import { OverlayPanel } from 'primereact/overlaypanel'
import { postAuthLogout } from '../api'
import { clearAuth, getStoredUser } from '../auth'
import { useWorkOrderNotifications } from '../notifications/WorkOrderNotificationsContext'
import { renderNotificationMessage } from '../notifications/renderNotificationMessage'
import {
  HOME_APP,
  getNavSectionsForUser,
  isSectionActive,
  type NavSection,
} from '../navigation/registeredApps'
import '../App.css'
import { formatDateTime } from '../utils/dateTime'
import { IdleSessionLogoutController } from './IdleSessionLogoutController'
import { useAppParameters } from './AppParametersProvider'
import { useKiraAssistant } from './KiraAssistantProvider'
import { useAtheneAssistant } from './AtheneAssistantProvider'

const THEME_LINK_ID = 'theme-link'
const THEME_LIGHT = 'lara-light-amber'
const THEME_DARK = 'lara-dark-amber'
const STORAGE_KEY = 'cmms-theme-dark'
const NAV_COLLAPSED_KEY = 'cmms-nav-collapsed'
const NAV_EXPANDED_PREFIX = 'cmms-nav-sections-expanded:'

/**
 * Each page wraps `<AppShell>`, so navigating remounts the shell and resets React state.
 * Persist which nav groups are expanded so multiple sections stay open across routes.
 */
function readNavExpanded(userId: string | undefined): Record<string, boolean> {
  if (typeof window === 'undefined' || !userId) return {}
  try {
    const raw = sessionStorage.getItem(`${NAV_EXPANDED_PREFIX}${userId}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeNavExpanded(
  userId: string | undefined,
  expanded: Record<string, boolean>,
) {
  if (typeof window === 'undefined' || !userId) return
  sessionStorage.setItem(
    `${NAV_EXPANDED_PREFIX}${userId}`,
    JSON.stringify(expanded),
  )
}

function themeHref(theme: string) {
  return `/themes/${theme}/theme.css`
}

/** Resolves after the new theme stylesheet has loaded (PrimeReact `changeTheme` callback). */
function applyThemeCss(
  isDark: boolean,
  changeTheme:
    | ((a: string, b: string, id: string, cb: () => void) => void)
    | undefined,
): Promise<void> {
  if (!changeTheme) return Promise.resolve()
  return new Promise((resolve, reject) => {
    try {
      const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null
      const href = link?.getAttribute('href') ?? ''
      const currentlyDark = href.includes(THEME_DARK)
      if (isDark === currentlyDark) {
        resolve()
        return
      }
      if (isDark) {
        changeTheme(THEME_LIGHT, THEME_DARK, THEME_LINK_ID, () => {
          const el = document.getElementById(THEME_LINK_ID) as HTMLLinkElement
          if (el) el.href = themeHref(THEME_DARK)
          resolve()
        })
      } else {
        changeTheme(THEME_DARK, THEME_LIGHT, THEME_LINK_ID, () => {
          const el = document.getElementById(THEME_LINK_ID) as HTMLLinkElement
          if (el) el.href = themeHref(THEME_LIGHT)
          resolve()
        })
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

const asideFixedStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  height: '100vh',
  maxHeight: '100vh',
  overflow: 'hidden',
  zIndex: 100,
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { openKira, kiraCopilotSending, kiraUnreadReplyDot } = useKiraAssistant()
  const { openAthene, atheneSending, atheneUnreadReplyDot } =
    useAtheneAssistant()
  const showKiraReadyDot = kiraUnreadReplyDot && !kiraCopilotSending
  const showAtheneReadyDot = atheneUnreadReplyDot && !atheneSending

  /** Map a `shellAction`-flagged nav item to its open handler + live state. */
  function getShellActionProps(action: 'kira' | 'athene') {
    if (action === 'athene') {
      return {
        open: openAthene,
        sending: atheneSending,
        showDot: showAtheneReadyDot,
      }
    }
    return {
      open: openKira,
      sending: kiraCopilotSending,
      showDot: showKiraReadyDot,
    }
  }
  const { shiftLoginRecognition } = useAppParameters()
  const location = useLocation()
  const { changeTheme } = useContext(PrimeReactContext)
  const user = getStoredUser()
  const notifications = useWorkOrderNotifications()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const navigateToWorkOrderFromNotification = useCallback(
    (workOrderId: string) => {
      setNotificationsOpen(false)
      navigate(`/work-orders?workOrderId=${encodeURIComponent(workOrderId)}`)
    },
    [navigate],
  )

  const navigateToUserFromNotification = useCallback(
    (userId: string) => {
      setNotificationsOpen(false)
      navigate(`/users?userId=${encodeURIComponent(userId)}`)
    },
    [navigate],
  )

  const navigateToEmployeeFromNotification = useCallback(
    (employeeId: string) => {
      setNotificationsOpen(false)
      navigate(`/employees?employeeId=${encodeURIComponent(employeeId)}`)
    },
    [navigate],
  )

  const userNavKey = user ? `${user.id}:${user.role}` : ''
  const navSections = useMemo(
    () => getNavSectionsForUser(getStoredUser()),
    [userNavKey],
  )

  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  })

  useEffect(() => {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed ? '1' : '0')
  }, [navCollapsed])

  const flyoutRef = useRef<OverlayPanel>(null)
  const [flyoutSection, setFlyoutSection] = useState<NavSection | null>(null)

  const closeFlyout = useCallback(() => {
    flyoutRef.current?.hide()
    setFlyoutSection(null)
  }, [])

  useEffect(() => {
    closeFlyout()
  }, [location.pathname, closeFlyout])

  useEffect(() => {
    if (!navCollapsed) closeFlyout()
  }, [navCollapsed, closeFlyout])

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    const u = getStoredUser()
    const sections = getNavSectionsForUser(u)
    const pathname = window.location.pathname
    const stored = readNavExpanded(u?.id)
    const next: Record<string, boolean> = { ...stored }
    for (const sec of sections) {
      if (isSectionActive(sec, pathname)) next[sec.id] = true
    }
    return next
  })

  useEffect(() => {
    writeNavExpanded(user?.id, expanded)
  }, [expanded, user?.id])

  useEffect(() => {
    setExpanded((prev) => {
      const sections = getNavSectionsForUser(getStoredUser())
      const next = { ...prev }
      for (const sec of sections) {
        if (isSectionActive(sec, location.pathname)) {
          next[sec.id] = true
        }
      }
      return next
    })
  }, [location.pathname])

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, darkMode ? '1' : '0')
  }, [darkMode])

  /** Sync stylesheet to `darkMode` when they disagree (first paint, refresh, external storage). */
  useEffect(() => {
    const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null
    const href = link?.getAttribute('href') ?? ''
    const currentlyDark = href.includes(THEME_DARK)
    if (darkMode === currentlyDark) return
    void applyThemeCss(darkMode, changeTheme)
  }, [darkMode, changeTheme])

  const toggleTheme = useCallback(() => {
    const next = !darkMode

    const runApply = async () => {
      try {
        await applyThemeCss(next, changeTheme)
        flushSync(() => setDarkMode(next))
      } catch {
        /* missing theme link or changeTheme */
      }
    }

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const hasVt = typeof document.startViewTransition === 'function'

    if (reducedMotion) {
      void runApply()
      return
    }

    if (!hasVt) {
      document.documentElement.classList.add('theme-transition-fallback')
      void runApply().finally(() => {
        window.setTimeout(() => {
          document.documentElement.classList.remove('theme-transition-fallback')
        }, 220)
      })
      return
    }

    const startVt = document.startViewTransition
    if (startVt) {
      void startVt.call(document, () => runApply()).finished.catch(() => {})
    } else {
      void runApply()
    }
  }, [darkMode, changeTheme])

  function runLogout(clearShiftPresence: boolean) {
    void postAuthLogout(
      clearShiftPresence ? { clear_shift_presence: true } : undefined,
    )
    clearAuth()
    navigate('/login', { replace: true })
  }

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
        const u = getStoredUser()
        if (shiftLoginRecognition && u?.employee_id) {
          confirmDialog({
            tagKey: 'logout_shift',
            header: t('shell.logout_shift_header'),
            message: t('shell.logout_shift_message'),
            icon: 'pi pi-clock',
            acceptLabel: t('shell.logout_shift_accept'),
            rejectLabel: t('shell.logout_shift_reject'),
            defaultFocus: 'reject',
            dismissableMask: true,
            accept: () => runLogout(true),
            reject: () => runLogout(false),
          })
          return
        }
        runLogout(false)
      },
    })
  }

  function onSectionButtonClick(
    e: React.MouseEvent<HTMLButtonElement>,
    section: NavSection,
  ) {
    if (!navCollapsed) {
      setExpanded((p) => ({
        ...p,
        [section.id]: !(p[section.id] ?? false),
      }))
      return
    }
    if (
      flyoutSection?.id === section.id &&
      flyoutRef.current?.isVisible()
    ) {
      closeFlyout()
      return
    }
    flushSync(() => {
      setFlyoutSection(section)
    })
    flyoutRef.current?.show(e, e.currentTarget)
  }

  const shellClass = [
    'app-shell',
    navCollapsed ? 'app-shell--nav-collapsed' : '',
    darkMode ? 'app-shell--theme-dark' : 'app-shell--theme-light',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClass}>
      <IdleSessionLogoutController />
      <Dialog
        header={t('notifications.window_title')}
        visible={notificationsOpen}
        onHide={() => setNotificationsOpen(false)}
        style={{ width: 'min(42rem, 96vw)' }}
        dismissableMask
      >
        <div className="flex flex-column gap-2">
          {notifications.items.length === 0 ? (
            <p className="m-0 text-sm text-color-secondary">
              {t('notifications.empty')}
            </p>
          ) : (
            notifications.items.map((n) => (
              <div
                key={n.id}
                className="border-1 surface-border border-round px-3 py-2"
              >
                <div className="text-sm">
                  {renderNotificationMessage(n, {
                    onWorkOrderClick: navigateToWorkOrderFromNotification,
                    onActorClick: navigateToUserFromNotification,
                    onEmployeeClick: navigateToEmployeeFromNotification,
                  })}
                </div>
                <div className="text-xs text-color-secondary mt-1">
                  {formatDateTime(n.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </Dialog>
      <ConfirmDialog tagKey="logout" dismissableMask />
      <ConfirmDialog tagKey="logout_shift" dismissableMask />
      <OverlayPanel
        ref={flyoutRef}
        dismissable
        onHide={() => setFlyoutSection(null)}
        className="app-sidebar-flyout shadow-2"
      >
        {flyoutSection ? (
          <div className="flex flex-column gap-1" style={{ minWidth: '12rem' }}>
            <div className="text-xs font-semibold text-color-secondary px-2 py-1 app-sidebar-flyout-heading">
              {t(flyoutSection.labelKey)}
            </div>
            {flyoutSection.children.length === 0 ? (
              <span className="text-xs text-color-secondary px-2 py-2">
                {t('shell.nav_section_empty')}
              </span>
            ) : (
              flyoutSection.children.map((app) => {
                if (app.shellAction) {
                  const sa = getShellActionProps(app.shellAction)
                  return (
                    <button
                      key={app.path}
                      type="button"
                      disabled={sa.sending}
                      className={[
                        'app-sidebar-link',
                        'flex align-items-center gap-2 px-2 py-2 border-round text-sm no-underline transition-colors transition-duration-150',
                        'w-full text-left cursor-pointer border-none bg-transparent',
                        'text-color-secondary',
                      ].join(' ')}
                      onClick={() => {
                        sa.open()
                        closeFlyout()
                      }}
                    >
                      <span className="relative inline-flex align-items-center justify-content-center flex-shrink-0">
                        <i
                          className={
                            sa.sending ? 'pi pi-spin pi-spinner' : app.icon
                          }
                          aria-hidden
                        />
                        {sa.showDot ? (
                          <span
                            className="app-shell-kira-ready-dot app-shell-kira-ready-dot--navicon"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                      <span>{t(app.labelKey)}</span>
                    </button>
                  )
                }
                return (
                  <NavLink
                    key={app.path}
                    to={app.path}
                    className={({ isActive }) =>
                      [
                        'app-sidebar-link',
                        'flex align-items-center gap-2 px-2 py-2 border-round text-sm no-underline transition-colors transition-duration-150',
                        isActive ?
                          'app-sidebar-link--active'
                        : 'text-color-secondary',
                      ].join(' ')
                    }
                    onClick={() => closeFlyout()}
                  >
                    <i className={app.icon} aria-hidden />
                    <span>{t(app.labelKey)}</span>
                  </NavLink>
                )
              })
            )}
          </div>
        ) : null}
      </OverlayPanel>

      <aside className="app-sidebar flex flex-column" style={asideFixedStyle}>
        <div className="app-sidebar-inner flex flex-column h-full w-full overflow-hidden">
          <div className="flex-shrink-0 px-3 pt-3">
            <div
              className={`flex align-items-center mb-3 ${navCollapsed ? 'justify-content-center' : 'justify-content-between'} gap-2`}
            >
              {!navCollapsed ? (
                <span className="text-xl font-semibold min-w-0">
                  {t('shell.brand_name')}
                </span>
              ) : null}
              <Button
                type="button"
                rounded
                text
                className="app-sidebar-nav-toggle text-primary"
                icon={
                  navCollapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'
                }
                onClick={() => setNavCollapsed((c) => !c)}
                aria-label={
                  navCollapsed ? t('shell.nav_expand') : t('shell.nav_collapse')
                }
                aria-expanded={!navCollapsed}
              />
            </div>
          </div>
          <nav
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-2 flex flex-column gap-1"
            aria-label={t('shell.nav_aria')}
          >
            <NavLink
              to={HOME_APP.path}
              end
              aria-label={navCollapsed ? t(HOME_APP.labelKey) : undefined}
              title={navCollapsed ? t(HOME_APP.labelKey) : undefined}
              className={({ isActive }) =>
                [
                  'app-sidebar-link',
                  'flex align-items-center gap-2 px-2 py-2 border-round text-sm no-underline transition-colors transition-duration-150',
                  navCollapsed ? 'justify-content-center' : '',
                  isActive ? 'app-sidebar-link--active' : 'text-color-secondary',
                ].join(' ')
              }
            >
              <i className={HOME_APP.icon} aria-hidden />
              <span
                className={navCollapsed ? 'app-sidebar-visually-hidden' : undefined}
              >
                {t(HOME_APP.labelKey)}
              </span>
            </NavLink>

            {navSections.map((section) => {
              const isOpen = expanded[section.id] ?? false
              const sectionHasActive = isSectionActive(section, location.pathname)
              return (
                <div key={section.id} className="flex flex-column">
                  <button
                    type="button"
                    className={[
                      'app-sidebar-section-toggle',
                      'flex align-items-center gap-2 w-full px-2 py-2 border-round text-sm text-left cursor-pointer border-none bg-transparent transition-colors transition-duration-150',
                      navCollapsed ? 'justify-content-center' : '',
                      sectionHasActive ? 'text-color font-medium' : 'text-color-secondary',
                    ].join(' ')}
                    aria-expanded={navCollapsed ? undefined : isOpen}
                    aria-haspopup={navCollapsed ? 'menu' : undefined}
                    aria-label={navCollapsed ? t(section.labelKey) : undefined}
                    title={navCollapsed ? t(section.labelKey) : undefined}
                    onClick={(e) => onSectionButtonClick(e, section)}
                  >
                    <i
                      className={`pi pi-chevron-right app-sidebar-section-chevron text-xs flex-shrink-0 ${isOpen ? 'app-sidebar-section-chevron--open' : ''}`}
                      aria-hidden
                    />
                    <i className={section.icon} aria-hidden />
                    <span
                      className={`min-w-0 flex-1 ${navCollapsed ? 'app-sidebar-visually-hidden' : ''}`}
                    >
                      {t(section.labelKey)}
                    </span>
                  </button>
                  <div
                    className={`app-sidebar-section-panel ${isOpen ? 'app-sidebar-section-panel--open' : ''}`}
                    aria-hidden={!isOpen}
                  >
                    <div className="app-sidebar-section-panel-inner">
                      <div className="app-sidebar-submenu flex flex-column gap-2 pl-2 ml-3">
                        {section.children.length === 0 ? (
                          <span className="text-xs text-color-secondary px-2 py-1">
                            {t('shell.nav_section_empty')}
                          </span>
                        ) : (
                          section.children.map((app) => {
                            if (app.shellAction) {
                              const sa = getShellActionProps(app.shellAction)
                              return (
                                <button
                                  key={app.path}
                                  type="button"
                                  tabIndex={isOpen ? undefined : -1}
                                  disabled={sa.sending}
                                  className={[
                                    'app-sidebar-link',
                                    'flex align-items-center gap-2 px-2 py-1 border-round text-sm no-underline transition-colors transition-duration-150',
                                    'w-full text-left cursor-pointer border-none bg-transparent',
                                    'text-color-secondary',
                                  ].join(' ')}
                                  onClick={() => sa.open()}
                                >
                                  <span className="relative inline-flex align-items-center justify-content-center flex-shrink-0">
                                    <i
                                      className={
                                        sa.sending
                                          ? 'pi pi-spin pi-spinner'
                                          : app.icon
                                      }
                                      aria-hidden
                                    />
                                    {sa.showDot ? (
                                      <span
                                        className="app-shell-kira-ready-dot app-shell-kira-ready-dot--navicon"
                                        aria-hidden
                                      />
                                    ) : null}
                                  </span>
                                  <span>{t(app.labelKey)}</span>
                                </button>
                              )
                            }
                            return (
                              <NavLink
                                key={app.path}
                                to={app.path}
                                tabIndex={isOpen ? undefined : -1}
                                className={({ isActive }) =>
                                  [
                                    'app-sidebar-link',
                                    'flex align-items-center gap-2 px-2 py-1 border-round text-sm no-underline transition-colors transition-duration-150',
                                    isActive ?
                                      'app-sidebar-link--active'
                                    : 'text-color-secondary',
                                  ].join(' ')
                                }
                              >
                                <i className={app.icon} aria-hidden />
                                <span>{t(app.labelKey)}</span>
                              </NavLink>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </nav>

          <div
            className={`flex-shrink-0 p-3 app-sidebar-footer flex flex-column ${navCollapsed ? 'gap-2 align-items-center' : 'gap-3'}`}
          >
            {user && !navCollapsed ? (
              <div className="text-sm text-color-secondary line-height-3 w-full">
                <div className="font-medium text-color">{user.name}</div>
                <div className="text-xs">{user.login_name}</div>
              </div>
            ) : null}
            {user && navCollapsed ? (
              <div
                className="flex justify-content-center w-full"
                title={`${user.name} (${user.login_name})`}
                aria-label={`${user.name}, ${user.login_name}`}
              >
                <span className="text-lg text-color-secondary" aria-hidden>
                  <i className="pi pi-user" />
                </span>
              </div>
            ) : null}
            <div className="flex justify-content-center w-full gap-2">
              <Button
                type="button"
                icon="pi pi-bell"
                rounded
                text
                severity="secondary"
                badge={
                  notifications.unreadCount > 0
                    ? String(notifications.unreadCount)
                    : undefined
                }
                badgeClassName="p-badge-danger"
                onClick={() => {
                  setNotificationsOpen(true)
                  void notifications.refresh()
                  void notifications.markVisibleAsRead()
                }}
                aria-label={t('notifications.button_aria')}
              />
              <span
                className="relative inline-flex"
                title={
                  showKiraReadyDot ? t('kira.response_ready_detail') : undefined
                }
              >
                <Button
                  type="button"
                  icon="pi pi-sparkles"
                  rounded
                  text
                  severity="secondary"
                  loading={kiraCopilotSending}
                  onClick={() => openKira()}
                  aria-label={t('shell.kira_aria')}
                  aria-busy={kiraCopilotSending}
                />
                {showKiraReadyDot ? (
                  <span className="app-shell-kira-ready-dot" aria-hidden />
                ) : null}
              </span>
              <span
                className="relative inline-flex"
                title={
                  showAtheneReadyDot
                    ? t('athene.response_ready_detail')
                    : undefined
                }
              >
                <Button
                  type="button"
                  icon="pi pi-compass"
                  rounded
                  text
                  severity="secondary"
                  loading={atheneSending}
                  onClick={() => openAthene()}
                  aria-label={t('shell.athene_aria')}
                  aria-busy={atheneSending}
                />
                {showAtheneReadyDot ? (
                  <span className="app-shell-kira-ready-dot" aria-hidden />
                ) : null}
              </span>
              <Button
                type="button"
                icon={darkMode ? 'pi pi-sun' : 'pi pi-moon'}
                rounded
                text
                severity="secondary"
                onClick={() => void toggleTheme()}
                aria-label={
                  darkMode
                    ? t('shell.theme_light_aria')
                    : t('shell.theme_dark_aria')
                }
              />
            </div>
            <Button
              type="button"
              icon="pi pi-sign-out"
              label={navCollapsed ? undefined : t('shell.log_out')}
              severity="secondary"
              outlined
              className={navCollapsed ? 'w-auto' : 'w-full'}
              onClick={confirmLogout}
              aria-label={t('shell.log_out')}
            />
          </div>
        </div>
      </aside>

      <main className="bg-surface-ground app-shell-main">{children}</main>
    </div>
  )
}
