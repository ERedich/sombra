import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { apiJson } from '../api'
import { getToken } from '../auth'
import {
  DEFAULT_GENERAL_FDW,
  isGeneralFdwId,
  type GeneralFdwId,
} from '../utils/firstDayOfWeekPreference'
import {
  DEFAULT_GENERAL_DTF,
  isGeneralDtfId,
  setDateTimeFormatPreference,
  type GeneralDtfId,
} from '../utils/dateTimeFormatPreference'
import {
  DEFAULT_GENERAL_CURRENCIES,
  normalizeGeneralCurrenciesFromApi,
} from '../utils/generalCurrencies'

const IDLE_SESSION_MAX_MINUTES = 10080

/** DOCS: where document uploads are persisted. */
export const GENERAL_DOCS_STORAGE_IDS = ['database', 'application'] as const

export type GeneralDocsStorageId = (typeof GENERAL_DOCS_STORAGE_IDS)[number]

export const DEFAULT_GENERAL_DOCS_STORAGE: GeneralDocsStorageId = 'database'

export function isGeneralDocsStorageId(
  value: unknown,
): value is GeneralDocsStorageId {
  return (
    typeof value === 'string' &&
    (GENERAL_DOCS_STORAGE_IDS as readonly string[]).includes(value)
  )
}

export type AppParametersGeneralSnapshot = {
  idle_session_timeout_minutes: number
  dtf: GeneralDtfId
  fdw: GeneralFdwId
  ask_for_site_change_on_login: boolean
  /** CURR: ordered currency codes; first = default. */
  currencies: string[]
  /** DOCS storage backend (`database` or `application`). */
  docs_storage: GeneralDocsStorageId
  /** Server-side directory used when `docs_storage === 'application'`. */
  docs_application_path: string
}

type AppParametersApiResponse = {
  wo?: {
    planned_hours_restriction?: boolean
  }
  general?: {
    idle_session_timeout_minutes?: number
    dtf?: string
    fdw?: string
    ask_for_site_change_on_login?: boolean
    currencies?: string[]
    docs_storage?: string
    docs_application_path?: string
  }
  shifts?: {
    shift_login_recognition?: boolean
    shift_planning_capacity_pct?: number
    shift_bound_projection?: boolean
    apply_default_shift_plan?: boolean
    default_shift_time_start?: string
    default_shift_time_end?: string
    default_shift_weekdays?: number[]
  }
}

const DEFAULT_DSP_WEEKDAYS: number[] = [1, 2, 3, 4, 5]

export type AppParametersShiftsSnapshot = {
  shiftLoginRecognition: boolean
  /** SPC: 0–100 */
  shiftPlanningCapacityPct: number
  /** SBPR: when true, planner keeps blocks on shift-defined times. */
  shiftBoundProjection: boolean
  /** DSP: capacities from default schedule (one system shift per site). */
  applyDefaultShiftPlan: boolean
  /** HH:mm:ss from server */
  defaultShiftTimeStart: string
  defaultShiftTimeEnd: string
  defaultShiftWeekdays: number[]
}

type AppParametersContextValue = AppParametersGeneralSnapshot &
  AppParametersShiftsSnapshot & {
    /** PHR: when true, Capacity Planner caps planned hours by SPC bucket per employee/day. */
    plannedHoursRestriction: boolean
    /** Apply server `general` after PATCH from app-parameters page. */
    applyGeneralFromApi: (general: AppParametersGeneralSnapshot) => void
    /** Apply server `shifts` after PATCH from app-parameters page. */
    applyShiftParamsFromApi: (shifts: AppParametersShiftsSnapshot) => void
    /** Sync PHR after app-parameters PATCH (or same value from GET). */
    applyPlannedHoursRestrictionFromApi: (plannedHoursRestriction: boolean) => void
  }

const AppParametersContext = createContext<AppParametersContextValue | null>(
  null,
)

function normalizeGeneral(
  raw:
    | AppParametersApiResponse['general']
    | AppParametersGeneralSnapshot
    | undefined,
): AppParametersGeneralSnapshot {
  const idleRaw = raw?.idle_session_timeout_minutes
  const idle =
    typeof idleRaw === 'number' && Number.isInteger(idleRaw) ? idleRaw : 0
  const idleClamped = Math.min(Math.max(0, idle), IDLE_SESSION_MAX_MINUTES)
  const dtf = isGeneralDtfId(raw?.dtf) ? raw.dtf : DEFAULT_GENERAL_DTF
  const fdw = isGeneralFdwId(raw?.fdw) ? raw.fdw : DEFAULT_GENERAL_FDW
  const docsStorage = isGeneralDocsStorageId(raw?.docs_storage)
    ? raw.docs_storage
    : DEFAULT_GENERAL_DOCS_STORAGE
  const docsApplicationPath =
    typeof raw?.docs_application_path === 'string'
      ? raw.docs_application_path
      : ''
  return {
    idle_session_timeout_minutes: idleClamped,
    dtf,
    fdw,
    ask_for_site_change_on_login:
      raw?.ask_for_site_change_on_login === true,
    currencies: normalizeGeneralCurrenciesFromApi(raw?.currencies),
    docs_storage: docsStorage,
    docs_application_path: docsApplicationPath,
  }
}

/** PHR: true = enforce SPC bucket (default). */
function normalizePlannedHoursRestriction(
  raw: AppParametersApiResponse['wo'] | undefined,
): boolean {
  return raw?.planned_hours_restriction !== false
}

function normalizeDefaultShiftWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_DSP_WEEKDAYS]
  const out: number[] = []
  for (const x of raw) {
    if (typeof x !== 'number' || !Number.isInteger(x)) continue
    if (x < 1 || x > 7) continue
    out.push(x)
  }
  if (out.length === 0) return [...DEFAULT_DSP_WEEKDAYS]
  return [...new Set(out)].sort((a, b) => a - b)
}

function normalizeShiftTime(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  return raw.trim()
}

/** Normalize `/api/app-parameters` `shifts` object (GET or PATCH response). */
export function normalizeShiftsSnapshot(
  raw: AppParametersApiResponse['shifts'] | undefined,
): AppParametersShiftsSnapshot {
  const shiftLoginRecognition = raw?.shift_login_recognition !== false
  const pctRaw = raw?.shift_planning_capacity_pct
  const shiftPlanningCapacityPct =
    typeof pctRaw === 'number' && Number.isInteger(pctRaw)
      ? Math.min(100, Math.max(0, pctRaw))
      : 100
  const shiftBoundProjection = raw?.shift_bound_projection !== false
  const applyDefaultShiftPlan = raw?.apply_default_shift_plan === true
  const defaultShiftTimeStart = normalizeShiftTime(
    raw?.default_shift_time_start,
    '08:00:00',
  )
  const defaultShiftTimeEnd = normalizeShiftTime(
    raw?.default_shift_time_end,
    '17:00:00',
  )
  const defaultShiftWeekdays = normalizeDefaultShiftWeekdays(
    raw?.default_shift_weekdays,
  )
  return {
    shiftLoginRecognition,
    shiftPlanningCapacityPct,
    shiftBoundProjection,
    applyDefaultShiftPlan,
    defaultShiftTimeStart,
    defaultShiftTimeEnd,
    defaultShiftWeekdays,
  }
}

export function AppParametersProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState<AppParametersGeneralSnapshot>(() => ({
    idle_session_timeout_minutes: 0,
    dtf: DEFAULT_GENERAL_DTF,
    fdw: DEFAULT_GENERAL_FDW,
    ask_for_site_change_on_login: false,
    currencies: [...DEFAULT_GENERAL_CURRENCIES],
    docs_storage: DEFAULT_GENERAL_DOCS_STORAGE,
    docs_application_path: '',
  }))
  const [shiftsSnapshot, setShiftsSnapshot] = useState<AppParametersShiftsSnapshot>(
    () => normalizeShiftsSnapshot(undefined),
  )
  const [plannedHoursRestriction, setPlannedHoursRestriction] = useState(true)

  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    if (!getToken()) {
      if (!cancelledRef.current) {
        setDateTimeFormatPreference(DEFAULT_GENERAL_DTF)
        setSnapshot({
          idle_session_timeout_minutes: 0,
          dtf: DEFAULT_GENERAL_DTF,
          fdw: DEFAULT_GENERAL_FDW,
          ask_for_site_change_on_login: false,
          currencies: [...DEFAULT_GENERAL_CURRENCIES],
          docs_storage: DEFAULT_GENERAL_DOCS_STORAGE,
          docs_application_path: '',
        })
        setShiftsSnapshot(normalizeShiftsSnapshot(undefined))
        setPlannedHoursRestriction(true)
      }
      return
    }
    try {
      const data = await apiJson<AppParametersApiResponse>('/api/app-parameters')
      if (cancelledRef.current) return
      const next = normalizeGeneral(data.general)
      setDateTimeFormatPreference(next.dtf)
      setSnapshot(next)
      setShiftsSnapshot(normalizeShiftsSnapshot(data.shifts))
      setPlannedHoursRestriction(normalizePlannedHoursRestriction(data.wo))
    } catch {
      if (!cancelledRef.current) {
        setDateTimeFormatPreference(DEFAULT_GENERAL_DTF)
        setSnapshot({
          idle_session_timeout_minutes: 0,
          dtf: DEFAULT_GENERAL_DTF,
          fdw: DEFAULT_GENERAL_FDW,
          ask_for_site_change_on_login: false,
          currencies: [...DEFAULT_GENERAL_CURRENCIES],
          docs_storage: DEFAULT_GENERAL_DOCS_STORAGE,
          docs_application_path: '',
        })
        setShiftsSnapshot(normalizeShiftsSnapshot(undefined))
        setPlannedHoursRestriction(true)
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void load()
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelledRef.current = true
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, location.pathname])

  const applyGeneralFromApi = useCallback((general: AppParametersGeneralSnapshot) => {
    const next = normalizeGeneral(general)
    setDateTimeFormatPreference(next.dtf)
    setSnapshot(next)
  }, [])

  const applyShiftParamsFromApi = useCallback((next: AppParametersShiftsSnapshot) => {
    setShiftsSnapshot(next)
  }, [])

  const applyPlannedHoursRestrictionFromApi = useCallback(
    (next: boolean) => {
      setPlannedHoursRestriction(next)
    },
    [],
  )

  const value = useMemo<AppParametersContextValue>(
    () => ({
      ...snapshot,
      ...shiftsSnapshot,
      plannedHoursRestriction,
      applyGeneralFromApi,
      applyShiftParamsFromApi,
      applyPlannedHoursRestrictionFromApi,
    }),
    [
      snapshot,
      shiftsSnapshot,
      plannedHoursRestriction,
      applyGeneralFromApi,
      applyShiftParamsFromApi,
      applyPlannedHoursRestrictionFromApi,
    ],
  )

  return (
    <AppParametersContext.Provider value={value}>
      {children}
    </AppParametersContext.Provider>
  )
}

export function useAppParameters(): AppParametersContextValue {
  const ctx = useContext(AppParametersContext)
  if (!ctx) {
    throw new Error('useAppParameters must be used within AppParametersProvider')
  }
  return ctx
}
