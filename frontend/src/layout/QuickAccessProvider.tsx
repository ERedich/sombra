import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { getToken, getStoredUser } from '../auth'
import { useHotkeySettings } from '../hotkeys/HotkeySettingsContext'
import { matchesHotkey } from '../hotkeys/matchesHotkey'
import {
  getAppsForUser,
  type RegisteredApp,
} from '../navigation/registeredApps'
import { useKiraAssistant } from './KiraAssistantProvider'

function appMatchesQuery(
  app: RegisteredApp,
  q: string,
  label: string,
): boolean {
  if (!q) return true
  const s = q.trim().toLowerCase()
  return (
    label.toLowerCase().includes(s) ||
    app.path.toLowerCase().includes(s)
  )
}

/**
 * Single-column list navigation (Quick Access uses a vertical list so arrow keys
 * map to one row without column/grid mismatch).
 */
function moveQuickAccessSelection(
  key: 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight',
  i: number,
  n: number,
): number {
  if (n <= 0) return 0
  const iClamped = Math.min(Math.max(0, i), n - 1)
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (iClamped + 1) % n
    case 'ArrowLeft':
    case 'ArrowUp':
      return (iClamped - 1 + n) % n
    default:
      return iClamped
  }
}

export function QuickAccessProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const filteredAppsRef = useRef<RegisteredApp[]>([])
  const selectedIndexRef = useRef(0)
  const navigate = useNavigate()
  const location = useLocation()
  const { openKira } = useKiraAssistant()
  const { quickAccess } = useHotkeySettings()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-capture]'))
        return
      if (!matchesHotkey(e, quickAccess)) return
      if (!getToken() || location.pathname === '/login') return
      e.preventDefault()
      e.stopPropagation()
      setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [quickAccess, location.pathname])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
  }, [open])

  const focusSearch = useCallback(() => {
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const filteredApps = useMemo(() => {
    const allApps = getAppsForUser(getStoredUser())
    const q = query.trim().toLowerCase()
    return allApps
      .filter((a) => appMatchesQuery(a, q, t(a.labelKey)))
      .sort((a, b) =>
        t(a.labelKey).localeCompare(t(b.labelKey), undefined, {
          sensitivity: 'base',
        }),
      )
  }, [query, t])

  filteredAppsRef.current = filteredApps
  selectedIndexRef.current = selectedIndex

  useEffect(() => {
    setSelectedIndex((i) =>
      filteredApps.length === 0 ? 0 : Math.min(i, filteredApps.length - 1),
    )
  }, [filteredApps])

  const choose = useCallback(
    (app: RegisteredApp) => {
      if (app.shellAction === 'kira') {
        openKira()
        setOpen(false)
        return
      }
      navigate(app.path)
      setOpen(false)
    },
    [navigate, openKira],
  )

  useEffect(() => {
    if (!open || filteredApps.length === 0) return
    const el = document.getElementById(
      `quick-access-app-${selectedIndex}`,
    )
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex, open, filteredApps.length])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      const apps = filteredAppsRef.current
      const n = apps.length
      if (n === 0) return

      if (e.key === 'Enter') {
        const el = e.target as HTMLElement | null
        if (el?.closest?.('.p-dialog-header-close')) return
        const fromTile = el?.closest?.('[id^="quick-access-app-"]') as
          | HTMLElement
          | undefined
        if (fromTile?.id) {
          const parsed = Number.parseInt(
            fromTile.id.replace('quick-access-app-', ''),
            10,
          )
          if (
            !Number.isNaN(parsed) &&
            parsed >= 0 &&
            parsed < n &&
            apps[parsed]
          ) {
            e.preventDefault()
            e.stopPropagation()
            choose(apps[parsed])
            return
          }
        }
        e.preventDefault()
        e.stopPropagation()
        const idx =
          n === 1 ? 0 : Math.min(selectedIndexRef.current, n - 1)
        choose(apps[idx])
        return
      }

      const arrow =
        e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' ?
          e.key
        : null
      if (!arrow) return

      e.preventDefault()
      e.stopPropagation()

      setSelectedIndex((prev) => moveQuickAccessSelection(arrow, prev, n))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, choose])

  const onHide = useCallback(() => {
    setOpen(false)
  }, [])

  const header = useMemo(
    () => (
      <div className="app-card-hero flex flex-column gap-1 p-4 md:p-5 w-full">
        <h1 className="app-card-hero-title">{t('quick.title')}</h1>
        <p className="app-card-hero-desc mb-0">{t('quick.description')}</p>
      </div>
    ),
    [t],
  )

  const appTile = (app: RegisteredApp, index: number, isSelected: boolean) => (
    <button
      type="button"
      role="option"
      id={`quick-access-app-${index}`}
      className={[
        'w-full h-full flex flex-column align-items-start gap-2 p-3 border-round-lg text-left cursor-pointer transition-colors transition-duration-150 text-color border-2',
        isSelected ?
          'surface-100 border-primary shadow-1'
        : 'border-transparent surface-hover bg-transparent',
      ].join(' ')}
      aria-selected={isSelected}
      onClick={() => choose(app)}
      onMouseEnter={() => setSelectedIndex(index)}
    >
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className={`${app.icon} text-xl`} />
      </span>
      <span className="min-w-0 flex flex-column gap-1 w-full">
        <span className="font-medium line-height-3 text-sm">
          {t(app.labelKey)}
        </span>
        <span className="text-xs text-color-secondary font-mono line-height-3">
          {app.path === '/' ? '/' : app.path}
        </span>
      </span>
    </button>
  )

  return (
    <>
      {children}
      <Dialog
        visible={open}
        onHide={onHide}
        onShow={focusSearch}
        header={header}
        dismissableMask
        modal
        focusOnShow={false}
        className="app-quick-access-dialog"
        style={{ width: '80vw', maxWidth: '80vw', height: '60vh', maxHeight: '60vh' }}
        contentClassName="pt-0 flex flex-column min-h-0 overflow-hidden"
        contentStyle={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
        }}
        blockScroll
        pt={{
          header: { className: 'p-0 border-none align-items-start flex-shrink-0' },
          headerTitle: { className: 'flex-1 min-w-0 m-0' },
        }}
      >
        <div className="flex flex-column gap-3 flex-1 min-h-0 overflow-hidden">
          <InputText
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('quick.search_placeholder')}
            className="w-full flex-shrink-0"
            aria-label={t('quick.search_aria')}
            autoComplete="off"
          />
          {filteredApps.length === 0 ? (
            <p className="text-sm text-color-secondary m-0 text-center py-3">
              {t('quick.no_match')}
            </p>
          ) : (
            <div
              className="grid flex-1 min-h-0 overflow-y-auto align-content-start"
              role="listbox"
              aria-label={t('quick.apps_aria')}
            >
              {filteredApps.map((app, index) => (
                <div key={app.path} className="col-12">
                  {appTile(app, index, index === selectedIndex)}
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
