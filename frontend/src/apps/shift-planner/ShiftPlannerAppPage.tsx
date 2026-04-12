/**
 * Timetable: View, Planning, by-employee roster, and detailed day timeline.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Checkbox } from 'primereact/checkbox'
import { Card } from 'primereact/card'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { Dialog } from 'primereact/dialog'
import { Divider } from 'primereact/divider'
import { Dropdown } from 'primereact/dropdown'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { RadioButton } from 'primereact/radiobutton'
import { TabPanel, TabView } from 'primereact/tabview'
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import type { Shift } from '../shifts/ShiftsAppPage'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import { formatDate, formatDateTime } from '../../utils/dateTime'
import { primeDateFormatForDtf } from '../../utils/dateTimeFormatPreference'

type EmployeeOpt = {
  id: string
  key: string
  name: string
  site_id: string
}

type ShiftAssignment = {
  id: string
  shift_id: string
  assignment_date: string
  employee_id: string
  presence_status: string
  present_started_at: string | null
  absent_reason: string | null
  absent_remark: string | null
  shift_key: string
  shift_name: string
  employee_key: string
  employee_name: string
  time_start?: string
  time_end?: string
  site_id?: string
}

type DetailedTimelineRow = {
  assignment: ShiftAssignment
  segment: 'first' | 'overnight_tail'
}

type AssignmentsResponse = { shift_assignments: ShiftAssignment[] }
type AssignmentOneResponse = { shift_assignment: ShiftAssignment }
type ShiftsResponse = { shifts: Shift[] }
type EmployeesResponse = { employees: EmployeeOpt[] }

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfIsoWeek(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function enumerateDates(from: Date, to: Date): string[] {
  const out: string[] = []
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  while (cur <= end) {
    out.push(toYmd(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function dateFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const x = new Date(y, m - 1, d)
  x.setHours(0, 0, 0, 0)
  return x
}

function ymdAddDays(ymd: string, delta: number): string {
  return toYmd(addDays(dateFromYmd(ymd), delta))
}

/** POST assignments for one shift across a date range (weekday filter + shift.available_weekdays). */
async function postRolloutForShiftDateRange(
  shift: Shift,
  employeeIds: Set<string>,
  targetFrom: Date,
  targetTo: Date,
  weekdays: Record<number, boolean>,
  genericError: string,
): Promise<{ created: number; skippedDup: number; errors: string[] }> {
  let created = 0
  let skippedDup = 0
  const errors: string[] = []
  if (employeeIds.size === 0) {
    return { created, skippedDup, errors }
  }
  const dates = enumerateDates(targetFrom, targetTo)
  for (const ymd of dates) {
    const w = isoWeekdayFromYmd(ymd)
    if (!weekdays[w]) continue
    if (!shift.available_weekdays.includes(w)) continue
    for (const empId of employeeIds) {
      try {
        await apiJson<AssignmentOneResponse>(
          '/api/shift-assignments',
          {
            method: 'POST',
            body: JSON.stringify({
              shift_id: shift.id,
              assignment_date: ymd,
              employee_id: empId,
            }),
          },
        )
        created += 1
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          skippedDup += 1
        } else if (e instanceof ApiError) {
          errors.push(e.message)
        } else {
          errors.push(genericError)
        }
      }
    }
  }
  return { created, skippedDup, errors }
}

function isoWeekdayFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const j = dt.getDay()
  return j === 0 ? 7 : j
}

const MINUTES_PER_DAY = 24 * 60

function timeHmsToMinutes(hms: string): number {
  const parts = hms.split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  return h * 60 + m
}

function minutesToHmsForApi(totalMin: number): string {
  const mm = Math.min(Math.max(0, Math.round(totalMin)), MINUTES_PER_DAY - 1)
  const h = Math.floor(mm / 60)
  const m = mm % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/** Slide same-day block by timeline delta; preserves duration; returns null if invalid. */
function computeSlidSameDayTimes(
  origTs: string,
  origTe: string,
  trackWidthPx: number,
  dxPx: number,
): { start: string; end: string } | null {
  const startM = timeHmsToMinutes(origTs)
  const endM = timeHmsToMinutes(origTe)
  const dur = endM - startM
  if (dur <= 0 || trackWidthPx <= 0) return null
  const delta = (dxPx / trackWidthPx) * MINUTES_PER_DAY
  let ns = Math.round(startM + delta)
  const maxStart = MINUTES_PER_DAY - 1 - dur
  if (maxStart < 0) return null
  ns = Math.min(Math.max(0, ns), maxStart)
  const ne = ns + dur
  return {
    start: minutesToHmsForApi(ns),
    end: minutesToHmsForApi(ne),
  }
}

/** Bar segment on the assignment date (overnight: start → midnight only). */
function dayBarPercents(
  timeStart: string,
  timeEnd: string,
): { leftPct: number; widthPct: number } {
  const start = timeHmsToMinutes(timeStart)
  const end = timeHmsToMinutes(timeEnd)
  if (end <= start) {
    const widthMin = MINUTES_PER_DAY - start
    return {
      leftPct: (start / MINUTES_PER_DAY) * 100,
      widthPct: (widthMin / MINUTES_PER_DAY) * 100,
    }
  }
  return {
    leftPct: (start / MINUTES_PER_DAY) * 100,
    widthPct: ((end - start) / MINUTES_PER_DAY) * 100,
  }
}

function isOvernightShift(timeStart: string, timeEnd: string): boolean {
  return timeHmsToMinutes(timeEnd) <= timeHmsToMinutes(timeStart)
}

/** Post-midnight segment (00:00 → time_end) on the calendar day after shift start. */
function overnightTailBarPercents(timeEnd: string): {
  leftPct: number
  widthPct: number
} {
  const endMin = timeHmsToMinutes(timeEnd)
  if (endMin <= 0) {
    return { leftPct: 0, widthPct: 0 }
  }
  return {
    leftPct: 0,
    widthPct: (endMin / MINUTES_PER_DAY) * 100,
  }
}

const TIMELINE_HOUR_TICKS = [
  0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22,
] as const

/** TabView index for Detailed planner (keep in sync with TabPanel order). */
const SHIFT_PLANNER_TAB_DETAILED = 4

function presenceSeverity(
  s: string,
): 'success' | 'info' | 'warning' | 'danger' | null {
  if (s === 'present') return 'success'
  if (s === 'scheduled') return 'info'
  if (s === 'not_present') return 'warning'
  if (s === 'absent') return 'danger'
  return null
}

/** Theme-aware accent (tags, mixed into pastel surfaces). */
function presenceAccentColor(status: string): string {
  if (status === 'present') return 'var(--green-500)'
  if (status === 'scheduled') return 'var(--blue-500)'
  if (status === 'not_present') return 'var(--orange-500)'
  if (status === 'absent') return 'var(--red-500)'
  return 'var(--surface-300)'
}

/** Pastel fill + outline for View cards and Detailed timeline bars. */
function presencePastelCardStyle(status: string): CSSProperties {
  const accent = presenceAccentColor(status)
  return {
    backgroundColor: `color-mix(in srgb, ${accent} 20%, var(--surface-card))`,
    border: `1px solid color-mix(in srgb, ${accent} 34%, var(--surface-border))`,
  }
}

const SHIFT_PLANNER_DND_MIME = 'application/x-sombra-shift-assignment+json'

type ShiftPlannerDragPayload = {
  assignmentId: string
  shiftId: string
  fromYmd: string
}

const PRESENCE_LEGEND_STATUSES = [
  'scheduled',
  'present',
  'not_present',
  'absent',
] as const

function PresenceStatusLegend() {
  const { t } = useTranslation()
  return (
    <div
      className="shift-planner-presence-legend"
      role="group"
      aria-label={t('shift_planner.presence_legend_title')}
    >
      <span className="text-xs font-medium text-color-secondary white-space-nowrap">
        {t('shift_planner.presence_legend_title')}
      </span>
      {PRESENCE_LEGEND_STATUSES.map((status) => (
        <div
          key={status}
          className="flex align-items-center gap-2 white-space-nowrap"
        >
          <span
            className="shift-planner-legend-swatch border-round-sm flex-shrink-0"
            style={presencePastelCardStyle(status)}
            aria-hidden
          />
          <span className="text-xs line-height-3">
            {t(`shift_planner.presence_${status}` as const)}
          </span>
        </div>
      ))}
    </div>
  )
}

function truncateTooltipLine(
  text: string,
  maxLen: number,
): { display: string; title: string } {
  const s = text.trim()
  if (s.length <= maxLen) return { display: s, title: s }
  return { display: `${s.slice(0, maxLen)}…`, title: s }
}

/** Tiny inline SVG (no extra request); uses currentColor for theme. */
function PlannerEmptySlotGraphic() {
  return (
    <svg
      className="shift-planner-empty-slot-svg"
      width={44}
      height={36}
      viewBox="0 0 48 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="1.5"
        y="5"
        width="45"
        height="30"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity={0.3}
      />
      <path
        d="M6 5V2.5M42 5V2.5M1.5 12h45"
        stroke="currentColor"
        strokeWidth="1"
        opacity={0.22}
        strokeLinecap="round"
      />
      <circle
        cx="24"
        cy="23"
        r="4"
        stroke="currentColor"
        strokeWidth="1"
        opacity={0.26}
      />
    </svg>
  )
}

function PlannerEmptySlot({ caption }: { caption: string }) {
  return (
    <div className="shift-planner-empty-slot flex flex-column align-items-center justify-content-center gap-2 px-1 py-2 min-h-[3.75rem] text-color-secondary">
      <PlannerEmptySlotGraphic />
      <span className="text-xs text-center line-height-3">{caption}</span>
    </div>
  )
}

export default function ShiftPlannerAppPage() {
  const { t } = useTranslation()
  const { shiftLoginRecognition, dtf, shiftBoundProjection } = useAppParameters()
  const toast = useRef<Toast>(null)
  const workingSiteId = getStoredUser()?.working_site_id ?? null

  const [rangeFrom, setRangeFrom] = useState<Date | null>(() =>
    startOfIsoWeek(new Date()),
  )
  const [rangeTo, setRangeTo] = useState<Date | null>(() =>
    addDays(startOfIsoWeek(new Date()), 6),
  )

  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<EmployeeOpt[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [loading, setLoading] = useState(false)

  const [pickEmployeeByCell, setPickEmployeeByCell] = useState<
    Record<string, string | null>
  >({})

  const [absentOpen, setAbsentOpen] = useState(false)
  const [absentAssignmentId, setAbsentAssignmentId] = useState<string | null>(
    null,
  )
  const [absentReason, setAbsentReason] = useState<
    'sick' | 'holiday' | 'unknown'
  >('sick')
  const [absentRemark, setAbsentRemark] = useState('')

  /** 0 View, 1 Planning, 2 Roll out, 3 By employee, 4 Detailed */
  const [plannerTab, setPlannerTab] = useState(0)
  const [selectedDetailYmd, setSelectedDetailYmd] = useState<string | null>(
    null,
  )

  const [plannerDrag, setPlannerDrag] = useState<ShiftPlannerDragPayload | null>(
    null,
  )

  const [planningCellModal, setPlanningCellModal] = useState<{
    shiftId: string
    ymd: string
  } | null>(null)

  const [rolloutTargetFrom, setRolloutTargetFrom] = useState<Date | null>(null)
  const [rolloutTargetTo, setRolloutTargetTo] = useState<Date | null>(null)
  const [rolloutWeekdays, setRolloutWeekdays] = useState<
    Record<number, boolean>
  >(() =>
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [d, true]),
    ) as Record<number, boolean>,
  )
  const [rolloutApplying, setRolloutApplying] = useState(false)

  const [modalRolloutTargetFrom, setModalRolloutTargetFrom] =
    useState<Date | null>(null)
  const [modalRolloutTargetTo, setModalRolloutTargetTo] =
    useState<Date | null>(null)
  const [modalRolloutWeekdays, setModalRolloutWeekdays] = useState<
    Record<number, boolean>
  >(() =>
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [d, true]),
    ) as Record<number, boolean>,
  )

  const shiftsHere = useMemo(() => {
    if (!workingSiteId) return []
    return shifts.filter((s) => s.site_id === workingSiteId)
  }, [shifts, workingSiteId])

  const shiftsById = useMemo(() => {
    const m = new Map<string, Shift>()
    for (const s of shiftsHere) m.set(s.id, s)
    return m
  }, [shiftsHere])

  const shiftIdsHereSet = useMemo(
    () => new Set(shiftsHere.map((s) => s.id)),
    [shiftsHere],
  )

  const assignmentsHere = useMemo(
    () => assignments.filter((a) => shiftIdsHereSet.has(a.shift_id)),
    [assignments, shiftIdsHereSet],
  )

  const employeesHere = useMemo(() => {
    if (!workingSiteId) return []
    return employees.filter((e) => e.site_id === workingSiteId)
  }, [employees, workingSiteId])

  const employeesSorted = useMemo(
    () =>
      [...employeesHere].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [employeesHere],
  )

  const dateColumns = useMemo(() => {
    if (!rangeFrom || !rangeTo) return []
    return enumerateDates(rangeFrom, rangeTo)
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    if (dateColumns.length === 0) {
      setSelectedDetailYmd(null)
      return
    }
    setSelectedDetailYmd((prev) =>
      prev && dateColumns.includes(prev) ? prev : dateColumns[0]!,
    )
  }, [dateColumns])

  useEffect(() => {
    if (!rangeTo) return
    setRolloutTargetFrom((f) => (f == null ? addDays(rangeTo, 1) : f))
    setRolloutTargetTo((t) => (t == null ? addDays(rangeTo, 7) : t))
  }, [rangeTo])

  const plannerCalendarDateFormat = useMemo(
    () => primeDateFormatForDtf(dtf),
    [dtf],
  )

  const todayYmd = toYmd(new Date())

  const assignmentsByKey = useMemo(() => {
    const m = new Map<string, ShiftAssignment[]>()
    for (const a of assignmentsHere) {
      const k = `${a.shift_id}\t${a.assignment_date}`
      const list = m.get(k) ?? []
      list.push(a)
      m.set(k, list)
    }
    for (const list of m.values()) {
      list.sort((a, b) =>
        a.employee_name.localeCompare(b.employee_name, undefined, {
          sensitivity: 'base',
        }),
      )
    }
    return m
  }, [assignmentsHere])

  const assignmentsByEmployeeDate = useMemo(() => {
    const m = new Map<string, ShiftAssignment[]>()
    for (const a of assignmentsHere) {
      const k = `${a.employee_id}\t${a.assignment_date}`
      const list = m.get(k) ?? []
      list.push(a)
      m.set(k, list)
    }
    const startMin = (a: ShiftAssignment) => {
      const ts =
        a.time_start ?? shiftsById.get(a.shift_id)?.time_start ?? '00:00:00'
      return timeHmsToMinutes(ts)
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const c = startMin(a) - startMin(b)
        if (c !== 0) return c
        return a.shift_name.localeCompare(b.shift_name, undefined, {
          sensitivity: 'base',
        })
      })
    }
    return m
  }, [assignmentsHere, shiftsById])

  const detailedTimelineRows = useMemo((): DetailedTimelineRow[] => {
    if (!selectedDetailYmd) return []

    const resolveTsTe = (a: ShiftAssignment) => {
      const sh = shiftsById.get(a.shift_id)
      const ts = a.time_start ?? sh?.time_start ?? '00:00:00'
      const te = a.time_end ?? sh?.time_end ?? '00:00:00'
      return { ts, te }
    }

    const prevYmd = ymdAddDays(selectedDetailYmd, -1)

    const tailRows: DetailedTimelineRow[] = []
    for (const a of assignmentsHere) {
      if (a.assignment_date !== prevYmd) continue
      const { ts, te } = resolveTsTe(a)
      if (!isOvernightShift(ts, te)) continue
      if (timeHmsToMinutes(te) <= 0) continue
      tailRows.push({ assignment: a, segment: 'overnight_tail' })
    }

    const firstRows: DetailedTimelineRow[] = []
    for (const a of assignmentsHere) {
      if (a.assignment_date !== selectedDetailYmd) continue
      firstRows.push({ assignment: a, segment: 'first' })
    }

    const startMin = (a: ShiftAssignment) =>
      timeHmsToMinutes(resolveTsTe(a).ts)

    tailRows.sort((x, y) =>
      x.assignment.employee_name.localeCompare(y.assignment.employee_name, undefined, {
        sensitivity: 'base',
      }),
    )
    firstRows.sort((x, y) => {
      const c = startMin(x.assignment) - startMin(y.assignment)
      if (c !== 0) return c
      return x.assignment.employee_name.localeCompare(
        y.assignment.employee_name,
        undefined,
        { sensitivity: 'base' },
      )
    })

    return [...tailRows, ...firstRows]
  }, [assignmentsHere, selectedDetailYmd, shiftsById])

  /** (shift_id, ISO weekday 1–7) → employee ids from current loaded range */
  const rolloutPattern = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const a of assignmentsHere) {
      const wd = isoWeekdayFromYmd(a.assignment_date)
      const sh = shiftsById.get(a.shift_id)
      if (!sh || !sh.available_weekdays.includes(wd)) continue
      const key = `${a.shift_id}\t${wd}`
      let set = m.get(key)
      if (!set) {
        set = new Set()
        m.set(key, set)
      }
      set.add(a.employee_id)
    }
    return m
  }, [assignmentsHere, shiftsById])

  const planningModalShift = useMemo(() => {
    if (!planningCellModal) return null
    return shiftsHere.find((s) => s.id === planningCellModal.shiftId) ?? null
  }, [planningCellModal, shiftsHere])

  const planningModalAssignments = useMemo(() => {
    if (!planningCellModal) return []
    const k = `${planningCellModal.shiftId}\t${planningCellModal.ymd}`
    return assignmentsByKey.get(k) ?? []
  }, [planningCellModal, assignmentsByKey])

  const showError = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'error',
        summary: t('common.toast_error'),
        detail,
        life: 5000,
      })
    },
    [t],
  )

  const showSuccess = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'success',
        summary: t('common.toast_success'),
        detail,
        life: 3000,
      })
    },
    [t],
  )

  const reload = useCallback(async () => {
    if (!rangeFrom || !rangeTo || !workingSiteId) {
      setAssignments([])
      return
    }
    const from = toYmd(rangeFrom)
    const to = toYmd(rangeTo)
    if (from > to) {
      showError(t('shift_planner.load_fail'))
      return
    }
    const fetchFrom = toYmd(addDays(rangeFrom, -1))
    setLoading(true)
    try {
      const [shData, emData, asData] = await Promise.all([
        apiJson<ShiftsResponse>('/api/shifts'),
        apiJson<EmployeesResponse>('/api/employees'),
        apiJson<AssignmentsResponse>(
          `/api/shift-assignments?date_from=${encodeURIComponent(fetchFrom)}&date_to=${encodeURIComponent(to)}`,
        ),
      ])
      setShifts(shData.shifts ?? [])
      setEmployees(emData.employees ?? [])
      setAssignments(asData.shift_assignments ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('shift_planner.load_fail'))
      }
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }, [rangeFrom, rangeTo, workingSiteId, showError, t])

  const shiftDateRangeByWeeks = useCallback(
    (weekDelta: number) => {
      if (!rangeFrom || !rangeTo) return
      setRangeFrom(addDays(rangeFrom, weekDelta * 7))
      setRangeTo(addDays(rangeTo, weekDelta * 7))
    },
    [rangeFrom, rangeTo],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  function cellKey(shiftId: string, ymd: string): string {
    return `${shiftId}\t${ymd}`
  }

  function getPick(shiftId: string, ymd: string): string | null {
    return pickEmployeeByCell[cellKey(shiftId, ymd)] ?? null
  }

  function setPick(shiftId: string, ymd: string, v: string | null) {
    const k = cellKey(shiftId, ymd)
    setPickEmployeeByCell((prev) => ({ ...prev, [k]: v }))
  }

  async function patchAssignment(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const data = await apiJson<AssignmentOneResponse>(
        `/api/shift-assignments/${id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
      setAssignments((prev) =>
        prev.map((x) => (x.id === id ? data.shift_assignment : x)),
      )
      return true
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('common.toast_error'))
      }
      return false
    }
  }

  const moveAssignmentToDate = useCallback(
    async (assignmentId: string, targetYmd: string) => {
      if (loading) return false
      try {
        await apiJson<AssignmentOneResponse>(
          `/api/shift-assignments/${assignmentId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              presence_status: 'scheduled',
              assignment_date: targetYmd,
            }),
          },
        )
        await reload()
        showSuccess(t('common.toast_success'))
        return true
      } catch (e) {
        if (e instanceof ApiError) {
          showError(e.message)
        } else {
          showError(t('shift_planner.move_assignment_fail'))
        }
        return false
      }
    },
    [loading, reload, showError, showSuccess, t],
  )

  const onDetailedTimePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      a: ShiftAssignment,
      ts: string,
      te: string,
    ) => {
      if (e.button !== 0 || loading) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget
      const track = el.closest('.shift-planner-timeline-track-inner')
      const rect = track?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return
      el.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const trackWidth = rect.width
      let finished = false
      const onMove = (_ev: PointerEvent) => {
        /* reserved for live preview */
      }
      const finish = async (upEv: PointerEvent) => {
        if (finished) return
        finished = true
        try {
          el.releasePointerCapture(upEv.pointerId)
        } catch {
          /* ignore */
        }
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', finish)
        el.removeEventListener('pointercancel', finish)
        const dx = upEv.clientX - startX
        const next = computeSlidSameDayTimes(ts, te, trackWidth, dx)
        if (!next) {
          showError(t('shift_planner.unbound_time_drag_invalid'))
          return
        }
        const ok = await patchAssignment(a.id, {
          presence_status: 'scheduled',
          override_time_start: next.start,
          override_time_end: next.end,
        })
        if (ok) showSuccess(t('common.save'))
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', finish)
      el.addEventListener('pointercancel', finish)
    },
    [loading, patchAssignment, showError, showSuccess, t],
  )

  function parsePlannerDragPayload(dt: DataTransfer): ShiftPlannerDragPayload | null {
    const raw =
      dt.getData(SHIFT_PLANNER_DND_MIME) || dt.getData('text/plain')
    if (!raw) return null
    try {
      const o = JSON.parse(raw) as ShiftPlannerDragPayload
      if (
        typeof o.assignmentId === 'string' &&
        typeof o.shiftId === 'string' &&
        typeof o.fromYmd === 'string'
      ) {
        return o
      }
    } catch {
      /* ignore */
    }
    return null
  }

  function onAssignmentDragStart(
    e: DragEvent,
    a: ShiftAssignment,
    rowShiftId: string,
  ) {
    if (loading || a.presence_status !== 'scheduled') {
      e.preventDefault()
      return
    }
    const payload: ShiftPlannerDragPayload = {
      assignmentId: a.id,
      shiftId: rowShiftId,
      fromYmd: a.assignment_date,
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(SHIFT_PLANNER_DND_MIME, JSON.stringify(payload))
    e.dataTransfer.setData('text/plain', JSON.stringify(payload))
    setPlannerDrag(payload)
  }

  async function addAssignment(shiftId: string, ymd: string) {
    const empId = getPick(shiftId, ymd)
    if (!empId) return
    try {
      const data = await apiJson<AssignmentOneResponse>(
        '/api/shift-assignments',
        {
          method: 'POST',
          body: JSON.stringify({
            shift_id: shiftId,
            assignment_date: ymd,
            employee_id: empId,
          }),
        },
      )
      setAssignments((prev) => [...prev, data.shift_assignment])
      setPick(shiftId, ymd, null)
      showSuccess(t('common.save'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('common.toast_error'))
      }
    }
  }

  function confirmRemove(a: ShiftAssignment) {
    confirmDialog({
      header: t('common.delete'),
      message: t('shift_planner.remove'),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void removeAssignment(a.id),
    })
  }

  async function removeAssignment(id: string) {
    try {
      await apiJson<undefined>(`/api/shift-assignments/${id}`, {
        method: 'DELETE',
      })
      setAssignments((prev) => prev.filter((x) => x.id !== id))
      showSuccess(t('common.toast_success'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('common.toast_error'))
      }
    }
  }

  function openAbsent(a: ShiftAssignment) {
    setAbsentAssignmentId(a.id)
    setAbsentReason('sick')
    setAbsentRemark(a.absent_remark ?? '')
    setAbsentOpen(true)
  }

  async function saveAbsent() {
    if (!absentAssignmentId) return
    const ok = await patchAssignment(absentAssignmentId, {
      presence_status: 'absent',
      absent_reason: absentReason,
      absent_remark: absentRemark.trim() || null,
    })
    if (!ok) return
    showSuccess(t('common.toast_success'))
    setAbsentOpen(false)
    setAbsentAssignmentId(null)
  }

  const applyRollout = useCallback(async () => {
    if (!rolloutTargetFrom || !rolloutTargetTo) {
      showError(t('shift_planner.rollout_need_dates'))
      return
    }
    const tf = toYmd(rolloutTargetFrom)
    const tt = toYmd(rolloutTargetTo)
    if (tf > tt) {
      showError(t('shift_planner.load_fail'))
      return
    }
    if (rolloutPattern.size === 0) {
      showError(t('shift_planner.rollout_no_pattern'))
      return
    }

    const genericErr = t('common.toast_error')
    setRolloutApplying(true)
    try {
      let created = 0
      let skippedDup = 0
      const errors: string[] = []
      for (const sh of shiftsHere) {
        for (let wd = 1; wd <= 7; wd += 1) {
          const pKey = `${sh.id}\t${wd}`
          const emps = rolloutPattern.get(pKey)
          if (!emps?.size) continue
          const weekdaysForPattern: Record<number, boolean> =
            Object.fromEntries(
              [1, 2, 3, 4, 5, 6, 7].map((d) => [
                d,
                d === wd && rolloutWeekdays[d] === true,
              ]),
            ) as Record<number, boolean>
          const part = await postRolloutForShiftDateRange(
            sh,
            emps,
            rolloutTargetFrom,
            rolloutTargetTo,
            weekdaysForPattern,
            genericErr,
          )
          created += part.created
          skippedDup += part.skippedDup
          errors.push(...part.errors)
        }
      }
      await reload()
      showSuccess(
        t('shift_planner.rollout_done', { created, skipped: skippedDup }),
      )
      if (errors.length > 0) {
        const unique = [...new Set(errors)].slice(0, 5)
        showError(
          t('shift_planner.rollout_partial_errors', {
            detail: unique.join('; '),
          }),
        )
      }
    } finally {
      setRolloutApplying(false)
    }
  }, [
    rolloutTargetFrom,
    rolloutTargetTo,
    rolloutWeekdays,
    rolloutPattern,
    shiftsHere,
    reload,
    showError,
    showSuccess,
    t,
  ])

  const applyModalCellRollout = useCallback(async () => {
    if (!modalRolloutTargetFrom || !modalRolloutTargetTo) {
      showError(t('shift_planner.rollout_need_dates'))
      return
    }
    const tf = toYmd(modalRolloutTargetFrom)
    const tt = toYmd(modalRolloutTargetTo)
    if (tf > tt) {
      showError(t('shift_planner.load_fail'))
      return
    }
    if (!planningModalShift) return
    const employeeIds = new Set(
      planningModalAssignments.map((a) => a.employee_id),
    )
    if (employeeIds.size === 0) {
      showError(t('shift_planner.modal_rollout_no_assignments'))
      return
    }

    const genericErr = t('common.toast_error')
    setRolloutApplying(true)
    try {
      const part = await postRolloutForShiftDateRange(
        planningModalShift,
        employeeIds,
        modalRolloutTargetFrom,
        modalRolloutTargetTo,
        modalRolloutWeekdays,
        genericErr,
      )
      await reload()
      showSuccess(
        t('shift_planner.rollout_done', {
          created: part.created,
          skipped: part.skippedDup,
        }),
      )
      if (part.errors.length > 0) {
        const unique = [...new Set(part.errors)].slice(0, 5)
        showError(
          t('shift_planner.rollout_partial_errors', {
            detail: unique.join('; '),
          }),
        )
      }
    } finally {
      setRolloutApplying(false)
    }
  }, [
    modalRolloutTargetFrom,
    modalRolloutTargetTo,
    modalRolloutWeekdays,
    planningModalShift,
    planningModalAssignments,
    reload,
    showError,
    showSuccess,
    t,
  ])

  useEffect(() => {
    if (planningCellModal && !planningModalShift) {
      setPlanningCellModal(null)
    }
  }, [planningCellModal, planningModalShift])

  useEffect(() => {
    if (!planningCellModal) return
    const base = dateFromYmd(planningCellModal.ymd)
    setModalRolloutTargetFrom(addDays(base, 1))
    setModalRolloutTargetTo(addDays(base, 7))
    setModalRolloutWeekdays(
      Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((d) => [d, true]),
      ) as Record<number, boolean>,
    )
  }, [planningCellModal])

  const employeeOptions = employeesHere.map((e) => ({
    label: `${e.key} — ${e.name}`,
    value: e.id,
  }))

  const absentReasonOptions = [
    { label: t('shift_planner.absent_reason_sick'), value: 'sick' as const },
    {
      label: t('shift_planner.absent_reason_holiday'),
      value: 'holiday' as const,
    },
    {
      label: t('shift_planner.absent_reason_unknown'),
      value: 'unknown' as const,
    },
  ]

  function empCellKey(employeeId: string, ymd: string): string {
    return `${employeeId}\t${ymd}`
  }

  function employeeScheduleTable() {
    return (
      <div className="overflow-auto border-1 surface-border border-round">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="surface-100">
              <th
                scope="col"
                className="text-left p-2 border-bottom-1 surface-border sticky left-0 bg-inherit z-1 min-w-[10rem]"
              >
                {t('shift_planner.column_employee')}
              </th>
              {dateColumns.map((ymd) => (
                <th
                  key={ymd}
                  scope="col"
                  className="text-left p-2 border-bottom-1 surface-border white-space-nowrap min-w-[12rem]"
                >
                  <div className="font-semibold">
                    {formatDate(`${ymd}T12:00:00`)}
                  </div>
                  <div className="text-xs text-color-secondary font-normal">
                    {t(`shifts.weekday_${isoWeekdayFromYmd(ymd)}` as const)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employeesSorted.map((emp) => (
              <tr key={emp.id}>
                <th
                  scope="row"
                  className="p-2 border-bottom-1 surface-border align-top sticky left-0 surface-card z-1 text-left font-normal"
                >
                  <div className="font-medium">{emp.name}</div>
                  <div className="text-xs text-color-secondary">{emp.key}</div>
                </th>
                {dateColumns.map((ymd) => {
                  const list =
                    assignmentsByEmployeeDate.get(
                      empCellKey(emp.id, ymd),
                    ) ?? []
                  return (
                    <td
                      key={ymd}
                      className="border-bottom-1 surface-border align-top p-2"
                    >
                      <div className="flex flex-column gap-2">
                        {list.length === 0 ? (
                          <PlannerEmptySlot
                            caption={t('shift_planner.view_empty_slot')}
                          />
                        ) : (
                          list.map((a) => {
                            const sh = shiftsById.get(a.shift_id)
                            const tsRaw =
                              a.time_start ?? sh?.time_start ?? ''
                            const teRaw = a.time_end ?? sh?.time_end ?? ''
                            const ts = tsRaw.slice(0, 5)
                            const te = teRaw.slice(0, 5)
                            const timeLine =
                              ts && te ? `${ts}–${te}` : ''
                            const absentLine = a.absent_reason
                              ? a.absent_remark
                                ? `${a.absent_reason}: ${a.absent_remark}`
                                : a.absent_reason
                              : ''
                            const absentTip = absentLine
                              ? truncateTooltipLine(absentLine, 72)
                              : null
                            return (
                              <div
                                key={a.id}
                                className="surface-card border-round p-2 shadow-1 flex flex-column gap-1"
                                style={{
                                  borderLeft: `4px solid ${presenceAccentColor(a.presence_status)}`,
                                }}
                              >
                                <div className="flex align-items-start justify-content-between gap-2 flex-wrap">
                                  <span className="font-semibold text-sm line-height-3">
                                    {a.shift_name}
                                  </span>
                                  <Tag
                                    value={t(
                                      `shift_planner.presence_${a.presence_status}` as const,
                                    )}
                                    severity={presenceSeverity(
                                      a.presence_status,
                                    )}
                                    className="text-xs flex-shrink-0"
                                  />
                                </div>
                                {timeLine ? (
                                  <div className="text-xs text-color-secondary line-height-3">
                                    {timeLine}
                                  </div>
                                ) : null}
                                {a.present_started_at ? (
                                  <div className="text-xs text-color-secondary line-height-3">
                                    {t('shift_planner.started_at')}:{' '}
                                    {formatDateTime(a.present_started_at)}
                                  </div>
                                ) : null}
                                {absentTip ? (
                                  <div
                                    className="text-xs text-color-secondary line-height-3"
                                    title={absentTip.title}
                                  >
                                    {absentTip.display}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {employeesSorted.length === 0 && !loading ? (
          <div className="p-4 text-color-secondary text-sm">
            {t('common.empty')}
          </div>
        ) : null}
      </div>
    )
  }

  function detailedPlannerPanel() {
    return (
      <div className="flex flex-column gap-3">
        <p className="text-sm text-color-secondary m-0 line-height-3">
          {t('shift_planner.detailed_hint')}
        </p>
        <div className="shift-planner-day-chip-row flex flex-wrap gap-2">
          {dateColumns.map((ymd) => {
            const chipDow = isoWeekdayFromYmd(ymd)
            const dragShift =
              plannerDrag ? shiftsById.get(plannerDrag.shiftId) : undefined
            const chipDropActive =
              !!plannerDrag &&
              !loading &&
              ymd >= todayYmd &&
              ymd !== plannerDrag.fromYmd &&
              !!dragShift &&
              dragShift.available_weekdays.includes(chipDow)
            return (
              <Button
                key={ymd}
                type="button"
                className={
                  chipDropActive
                    ? 'p-button-sm shift-planner-drop-target--active'
                    : 'p-button-sm'
                }
                label={`${t(`shifts.weekday_${chipDow}` as const)} · ${formatDate(`${ymd}T12:00:00`)}`}
                outlined={selectedDetailYmd !== ymd}
                onClick={() => setSelectedDetailYmd(ymd)}
                disabled={loading}
                onDragOver={(e) => {
                  if (!chipDropActive) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const p = parsePlannerDragPayload(e.dataTransfer)
                  if (!p || loading) return
                  if (ymd < todayYmd || ymd === p.fromYmd) return
                  const shP = shiftsById.get(p.shiftId)
                  if (!shP || !shP.available_weekdays.includes(chipDow)) return
                  void moveAssignmentToDate(p.assignmentId, ymd).then((ok) => {
                    if (ok) setPlannerDrag(null)
                  })
                }}
              />
            )
          })}
        </div>
        {selectedDetailYmd ? (
          detailedTimelineRows.length === 0 ? (
            <div className="flex flex-column align-items-center gap-3 py-3">
              <div className="text-color-secondary flex align-items-center justify-content-center">
                <PlannerEmptySlotGraphic />
              </div>
              <Message
                severity="info"
                className="m-0"
                text={t('shift_planner.detailed_empty')}
              />
            </div>
          ) : (
            <div className="shift-planner-timeline border-1 surface-border border-round p-3">
              {!shiftBoundProjection ? (
                <Message
                  severity="info"
                  className="mb-3 w-full"
                  text={t('shift_planner.unbound_time_drag_hint')}
                />
              ) : null}
              <div className="shift-planner-timeline-hour-row">
                <div className="shift-planner-timeline-gutter" aria-hidden />
                <div className="shift-planner-timeline-track shift-planner-timeline-track--axis">
                  {TIMELINE_HOUR_TICKS.map((h) => (
                    <span
                      key={h}
                      className="shift-planner-timeline-tick"
                      style={{ left: `${(h / 24) * 100}%` }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>
              </div>
              {detailedTimelineRows.map((row) => {
                const a = row.assignment
                const sh = shiftsById.get(a.shift_id)
                const ts = a.time_start ?? sh?.time_start ?? '00:00:00'
                const te = a.time_end ?? sh?.time_end ?? '00:00:00'
                const { leftPct, widthPct } =
                  row.segment === 'first'
                    ? dayBarPercents(ts, te)
                    : overnightTailBarPercents(te)
                const titleBase = `${a.shift_name} (${ts.slice(0, 5)}–${te.slice(0, 5)})`
                const barTitle =
                  row.segment === 'overnight_tail'
                    ? `${titleBase} — ${t('shift_planner.detailed_overnight_continuation')}`
                    : titleBase
                const canDragDateDetailed =
                  !loading &&
                  a.presence_status === 'scheduled' &&
                  shiftBoundProjection
                const canTimeDragDetailed =
                  !loading &&
                  a.presence_status === 'scheduled' &&
                  !shiftBoundProjection &&
                  row.segment === 'first' &&
                  !isOvernightShift(ts, te)
                const showGrip = canDragDateDetailed || canTimeDragDetailed
                const barCursor = canTimeDragDetailed
                  ? 'grab'
                  : canDragDateDetailed
                    ? 'grab'
                    : undefined
                return (
                  <div
                    key={`${a.id}-${row.segment}`}
                    className="shift-planner-timeline-row"
                  >
                    <div className="shift-planner-timeline-label">
                      <div className="font-medium text-sm line-height-3">
                        {a.employee_name}
                      </div>
                      <div className="text-xs text-color-secondary">
                        {a.shift_name}
                      </div>
                    </div>
                    <div className="shift-planner-timeline-track-inner">
                      <div
                        className="shift-planner-timeline-bar flex align-items-center"
                        style={{
                          left: `${leftPct}%`,
                          width: `${Math.max(widthPct, 0.35)}%`,
                          ...presencePastelCardStyle(a.presence_status),
                          touchAction: canTimeDragDetailed ? 'none' : undefined,
                          cursor: barCursor,
                          paddingLeft: showGrip ? '2px' : undefined,
                          gap: showGrip ? '2px' : undefined,
                        }}
                        draggable={canDragDateDetailed}
                        onDragStart={(e) =>
                          onAssignmentDragStart(e, a, a.shift_id)
                        }
                        onDragEnd={() => setPlannerDrag(null)}
                        onPointerDown={
                          canTimeDragDetailed
                            ? (e) => onDetailedTimePointerDown(e, a, ts, te)
                            : undefined
                        }
                        title={
                          canTimeDragDetailed
                            ? `${barTitle} — ${t('shift_planner.unbound_time_drag_hint')}`
                            : canDragDateDetailed
                              ? `${barTitle} — ${t('shift_planner.drag_reschedule_hint')}`
                              : barTitle
                        }
                        aria-grabbed={
                          canDragDateDetailed &&
                          plannerDrag?.assignmentId === a.id
                            ? true
                            : undefined
                        }
                      >
                        {showGrip ? (
                          <span
                            className="shift-planner-dnd-grip flex-shrink-0"
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : null}
      </div>
    )
  }

  function rolloutPanel() {
    const templateFrom = rangeFrom ? toYmd(rangeFrom) : ''
    const templateTo = rangeTo ? toYmd(rangeTo) : ''
    return (
      <div className="flex flex-column gap-4">
        <p className="text-sm text-color-secondary m-0 line-height-3">
          {t('shift_planner.rollout_hint')}
        </p>
        <div className="text-sm surface-50 border-round p-3 border-1 surface-border">
          <div className="font-medium">{t('shift_planner.rollout_template_range')}</div>
          <div className="mt-2">
            {templateFrom && templateTo
              ? `${formatDate(`${templateFrom}T12:00:00`)} – ${formatDate(`${templateTo}T12:00:00`)}`
              : '—'}
          </div>
          <div className="text-xs text-color-secondary mt-2">
            {t('shift_planner.rollout_pattern_rules', {
              count: rolloutPattern.size,
            })}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">
            {t('shift_planner.rollout_weekdays')}
          </div>
          <div className="flex flex-wrap gap-3">
            {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => (
              <div key={d} className="flex align-items-center gap-2">
                <Checkbox
                  inputId={`rollout_wd_${d}`}
                  checked={rolloutWeekdays[d] === true}
                  onChange={(e) =>
                    setRolloutWeekdays((prev) => ({
                      ...prev,
                      [d]: !!e.checked,
                    }))
                  }
                  disabled={rolloutApplying || loading}
                />
                <label
                  htmlFor={`rollout_wd_${d}`}
                  className="text-sm cursor-pointer"
                >
                  {t(`shifts.weekday_${d}` as const)}
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap align-items-end gap-3">
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">
              {t('shift_planner.rollout_target_from')}
            </label>
            <Calendar
              value={rolloutTargetFrom}
              onChange={(e) =>
                setRolloutTargetFrom(e.value as Date | null)
              }
              showIcon
              showButtonBar
              dateFormat={plannerCalendarDateFormat}
              disabled={rolloutApplying || loading}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">
              {t('shift_planner.rollout_target_to')}
            </label>
            <Calendar
              value={rolloutTargetTo}
              onChange={(e) => setRolloutTargetTo(e.value as Date | null)}
              showIcon
              showButtonBar
              dateFormat={plannerCalendarDateFormat}
              disabled={rolloutApplying || loading}
            />
          </div>
          <Button
            type="button"
            label={t('shift_planner.rollout_apply')}
            icon="pi pi-arrow-circle-right"
            onClick={() => void applyRollout()}
            loading={rolloutApplying}
            disabled={loading}
          />
        </div>
      </div>
    )
  }

  function scheduleTable(mode: 'view' | 'planning') {
    const isView = mode === 'view'
    return (
      <div className="overflow-auto border-1 surface-border border-round">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="surface-100">
              <th
                scope="col"
                className="text-left p-2 border-bottom-1 surface-border sticky left-0 bg-inherit z-1 min-w-[10rem]"
              >
                {t('shifts.title')}
              </th>
              {dateColumns.map((ymd) => (
                <th
                  key={ymd}
                  scope="col"
                  className="text-left p-2 border-bottom-1 surface-border white-space-nowrap min-w-[12rem]"
                >
                  {isView ? (
                    <button
                      type="button"
                      className="w-full text-left border-none bg-transparent cursor-pointer text-color p-0 font-inherit line-height-3 border-round hover:surface-100 focus:outline-none focus:shadow-none"
                      title={t('shift_planner.view_day_open_detailed')}
                      aria-label={t('shift_planner.view_day_open_detailed')}
                      onClick={() => {
                        setSelectedDetailYmd(ymd)
                        setPlannerTab(SHIFT_PLANNER_TAB_DETAILED)
                      }}
                    >
                      <div className="font-semibold">
                        {formatDate(`${ymd}T12:00:00`)}
                      </div>
                      <div className="text-xs text-color-secondary font-normal">
                        {t(`shifts.weekday_${isoWeekdayFromYmd(ymd)}` as const)}
                      </div>
                    </button>
                  ) : (
                    <>
                      <div className="font-semibold">
                        {formatDate(`${ymd}T12:00:00`)}
                      </div>
                      <div className="text-xs text-color-secondary font-normal">
                        {t(`shifts.weekday_${isoWeekdayFromYmd(ymd)}` as const)}
                      </div>
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shiftsHere.map((sh) => (
              <tr key={sh.id}>
                <th
                  scope="row"
                  className="p-2 border-bottom-1 surface-border align-top sticky left-0 surface-card z-1 text-left font-normal"
                >
                  <div className="font-medium">{sh.name}</div>
                  <div className="text-xs text-color-secondary">
                    {sh.key} · {sh.time_start.slice(0, 5)}–
                    {sh.time_end.slice(0, 5)}
                  </div>
                </th>
                {dateColumns.map((ymd) => {
                  const dow = isoWeekdayFromYmd(ymd)
                  if (!sh.available_weekdays.includes(dow)) {
                    return (
                      <td
                        key={ymd}
                        className={[
                          'border-bottom-1 surface-border align-top surface-ground opacity-60',
                          isView ? 'p-2' : 'p-1',
                        ].join(' ')}
                      >
                        <span className="text-xs text-color-secondary inline-block">
                          {t('shift_planner.not_applicable_day')}
                        </span>
                      </td>
                    )
                  }
                  const list =
                    assignmentsByKey.get(cellKey(sh.id, ymd)) ?? []
                  const viewDropHighlight =
                    isView &&
                    plannerDrag &&
                    !loading &&
                    plannerDrag.shiftId === sh.id &&
                    ymd >= todayYmd &&
                    sh.available_weekdays.includes(dow) &&
                    ymd !== plannerDrag.fromYmd
                  return (
                    <td
                      key={ymd}
                      className={[
                        'border-bottom-1 surface-border align-top',
                        isView ? 'p-2' : 'p-1',
                        viewDropHighlight ? 'shift-planner-drop-target--active' : '',
                      ].join(' ')}
                      onDragOver={
                        isView
                          ? (e) => {
                              if (!plannerDrag || loading) return
                              if (plannerDrag.shiftId !== sh.id) return
                              if (ymd < todayYmd) return
                              if (!sh.available_weekdays.includes(dow)) return
                              if (ymd === plannerDrag.fromYmd) return
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                            }
                          : undefined
                      }
                      onDrop={
                        isView
                          ? (e) => {
                              e.preventDefault()
                              const p = parsePlannerDragPayload(e.dataTransfer)
                              if (!p || loading) return
                              if (p.shiftId !== sh.id) return
                              if (ymd < todayYmd) return
                              if (!sh.available_weekdays.includes(dow)) return
                              if (ymd === p.fromYmd) return
                              void moveAssignmentToDate(
                                p.assignmentId,
                                ymd,
                              ).then((ok) => {
                                if (ok) setPlannerDrag(null)
                              })
                            }
                          : undefined
                      }
                    >
                      {isView ? (
                        <div className="flex flex-column gap-2">
                          {list.length === 0 ? (
                            <PlannerEmptySlot
                              caption={t('shift_planner.view_empty_slot')}
                            />
                          ) : (
                            list.map((a) => {
                              const absentLine = a.absent_reason
                                ? a.absent_remark
                                  ? `${a.absent_reason}: ${a.absent_remark}`
                                  : a.absent_reason
                                : ''
                              const absentTip = absentLine
                                ? truncateTooltipLine(absentLine, 72)
                                : null
                              const canDragView =
                                !loading && a.presence_status === 'scheduled'
                              return (
                                <div
                                  key={a.id}
                                  draggable={canDragView}
                                  onDragStart={(e) =>
                                    onAssignmentDragStart(e, a, sh.id)
                                  }
                                  onDragEnd={() => setPlannerDrag(null)}
                                  className="border-round p-2 flex flex-column gap-1"
                                  style={{
                                    ...presencePastelCardStyle(
                                      a.presence_status,
                                    ),
                                    cursor: canDragView ? 'grab' : undefined,
                                  }}
                                  aria-grabbed={
                                    canDragView &&
                                    plannerDrag?.assignmentId === a.id
                                      ? true
                                      : undefined
                                  }
                                  title={
                                    canDragView
                                      ? t('shift_planner.drag_reschedule_hint')
                                      : undefined
                                  }
                                >
                                  <div className="flex align-items-start gap-2">
                                    {canDragView ? (
                                      <span
                                        className="shift-planner-dnd-grip flex-shrink-0 align-self-center"
                                        aria-hidden
                                      />
                                    ) : null}
                                    <div className="min-w-0 flex-1 flex flex-column gap-1">
                                      <span className="font-semibold text-sm line-height-3">
                                        {a.employee_name}
                                      </span>
                                      {a.present_started_at ? (
                                        <div className="text-xs text-color-secondary line-height-3">
                                          {t('shift_planner.started_at')}:{' '}
                                          {formatDateTime(
                                            a.present_started_at,
                                          )}
                                        </div>
                                      ) : null}
                                      {absentTip ? (
                                        <div
                                          className="text-xs text-color-secondary line-height-3"
                                          title={absentTip.title}
                                        >
                                          {absentTip.display}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-column align-items-stretch gap-2 p-2">
                          <Button
                            type="button"
                            className="p-button-lg w-full justify-content-center"
                            style={{ minHeight: '3.75rem' }}
                            label={
                              list.length === 0
                                ? t('shift_planner.cell_add')
                                : t('shift_planner.cell_manage')
                            }
                            icon={
                              list.length === 0 ? 'pi pi-plus' : 'pi pi-pencil'
                            }
                            onClick={() =>
                              setPlanningCellModal({
                                shiftId: sh.id,
                                ymd,
                              })
                            }
                            disabled={loading}
                          />
                          {list.length > 0 ? (
                            <span className="text-xs text-color-secondary text-center line-height-3">
                              {t('shift_planner.assigned_count', {
                                count: list.length,
                              })}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {shiftsHere.length === 0 && !loading ? (
          <div className="p-4 text-color-secondary text-sm">
            {t('common.empty')}
          </div>
        ) : null}
      </div>
    )
  }

  const headerNode = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-table text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('shift_planner.title')}</h1>
        <p className="app-card-hero-desc">{t('shift_planner.subtitle')}</p>
      </div>
    </div>
  )

  if (!workingSiteId) {
    return (
      <AppShell>
        <div className="p-4">
          <Message severity="warn" text={t('work_types.subtitle_no_sites')} />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog dismissableMask />

      <div className="p-4 flex flex-column gap-3" style={{ maxWidth: '100%' }}>
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={headerNode}
        >
          {shiftLoginRecognition ? (
            <Message
              severity="info"
              className="mb-3"
              text={t('shift_planner.slr_banner')}
            />
          ) : null}

          <div className="flex flex-wrap align-items-end gap-3 mb-3 w-full">
            <div className="flex flex-column gap-2">
              <label className="text-sm font-medium">
                {t('shift_planner.date_from')}
              </label>
              <Calendar
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.value as Date | null)}
                showIcon
                showButtonBar
                dateFormat={plannerCalendarDateFormat}
                disabled={loading}
              />
            </div>
            <div className="flex flex-column gap-2">
              <label className="text-sm font-medium">
                {t('shift_planner.date_to')}
              </label>
              <Calendar
                value={rangeTo}
                onChange={(e) => setRangeTo(e.value as Date | null)}
                showIcon
                showButtonBar
                dateFormat={plannerCalendarDateFormat}
                disabled={loading}
              />
            </div>
            <Button
              type="button"
              label={t('shift_planner.prev_week')}
              icon="pi pi-angle-left"
              className="p-button-secondary"
              onClick={() => shiftDateRangeByWeeks(-1)}
              disabled={loading || !rangeFrom || !rangeTo}
            />
            <Button
              type="button"
              label={t('shift_planner.next_week')}
              icon="pi pi-angle-right"
              iconPos="right"
              className="p-button-secondary"
              onClick={() => shiftDateRangeByWeeks(1)}
              disabled={loading || !rangeFrom || !rangeTo}
            />
            <Button
              type="button"
              label={t('shift_planner.reload')}
              icon="pi pi-refresh"
              onClick={() => void reload()}
              loading={loading}
            />
            <PresenceStatusLegend />
          </div>

          <TabView
            activeIndex={plannerTab}
            onTabChange={(e) => setPlannerTab(e.index)}
            className="shift-planner-tabview pt-2"
          >
            <TabPanel header={t('shift_planner.tab_view')}>
              <p className="text-sm text-color-secondary m-0 mb-3 line-height-3">
                {t('shift_planner.view_readonly_hint')}
              </p>
              {scheduleTable('view')}
            </TabPanel>
            <TabPanel header={t('shift_planner.tab_planning')}>
              {scheduleTable('planning')}
            </TabPanel>
            <TabPanel header={t('shift_planner.tab_rollout')}>
              {rolloutPanel()}
            </TabPanel>
            <TabPanel header={t('shift_planner.tab_by_employee')}>
              <p className="text-sm text-color-secondary m-0 mb-3 line-height-3">
                {t('shift_planner.by_employee_hint')}
              </p>
              {employeeScheduleTable()}
            </TabPanel>
            <TabPanel header={t('shift_planner.tab_detailed')}>
              {detailedPlannerPanel()}
            </TabPanel>
          </TabView>
        </Card>
      </div>

      <Dialog
        visible={!!planningCellModal}
        onHide={() => setPlanningCellModal(null)}
        dismissableMask={!rolloutApplying && !loading}
        style={{ width: 'min(40rem, 96vw)' }}
        header={
          planningCellModal && planningModalShift ? (
            <div className="flex flex-column gap-1 pr-3">
              <span className="text-lg font-semibold line-height-3">
                {planningModalShift.name}
              </span>
              <span className="text-sm text-color-secondary font-normal line-height-3">
                {planningModalShift.key} ·{' '}
                {planningModalShift.time_start.slice(0, 5)}–
                {planningModalShift.time_end.slice(0, 5)}
              </span>
              <span className="text-sm font-medium line-height-3">
                {formatDate(`${planningCellModal.ymd}T12:00:00`)}{' '}
                (
                {t(
                  `shifts.weekday_${isoWeekdayFromYmd(planningCellModal.ymd)}` as const,
                )}
                )
              </span>
            </div>
          ) : (
            <span />
          )
        }
        footer={
          <div className="flex justify-content-end">
            <Button
              type="button"
              label={t('common.close')}
              severity="secondary"
              onClick={() => setPlanningCellModal(null)}
            />
          </div>
        }
      >
        {planningCellModal && planningModalShift ? (
          <div className="flex flex-column gap-2 pt-1">
            {planningModalAssignments.map((a) => (
              <div
                key={a.id}
                className="border-1 surface-border border-round p-2 flex flex-column gap-2"
              >
                <div className="flex align-items-center justify-content-between gap-2 flex-wrap">
                  <span className="font-medium text-sm">{a.employee_name}</span>
                  <Tag
                    value={t(
                      `shift_planner.presence_${a.presence_status}` as const,
                    )}
                    severity={presenceSeverity(a.presence_status)}
                    className="text-xs"
                  />
                </div>
                {a.present_started_at ? (
                  <div className="text-xs text-color-secondary">
                    {t('shift_planner.started_at')}:{' '}
                    {formatDateTime(a.present_started_at)}
                  </div>
                ) : null}
                {a.absent_reason ? (
                  <div className="text-xs text-color-secondary">
                    {a.absent_remark
                      ? `${a.absent_reason}: ${a.absent_remark}`
                      : a.absent_reason}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    className="p-button-sm p-button-text"
                    label={t('shift_planner.set_present')}
                    onClick={() =>
                      void patchAssignment(a.id, {
                        presence_status: 'present',
                      })
                    }
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    className="p-button-sm p-button-text"
                    label={t('shift_planner.set_not_present')}
                    onClick={() =>
                      void patchAssignment(a.id, {
                        presence_status: 'not_present',
                      })
                    }
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    className="p-button-sm p-button-text"
                    label={t('shift_planner.set_absent')}
                    onClick={() => openAbsent(a)}
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    className="p-button-sm p-button-text"
                    label={t('shift_planner.set_scheduled')}
                    onClick={() =>
                      void patchAssignment(a.id, {
                        presence_status: 'scheduled',
                      })
                    }
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    className="p-button-sm p-button-danger p-button-text"
                    icon="pi pi-trash"
                    onClick={() => confirmRemove(a)}
                    disabled={loading}
                    aria-label={t('shift_planner.remove')}
                  />
                </div>
              </div>
            ))}
            <Divider className="my-1" />
            <Dropdown
              value={getPick(planningCellModal.shiftId, planningCellModal.ymd)}
              options={employeeOptions}
              onChange={(e) =>
                setPick(
                  planningCellModal.shiftId,
                  planningCellModal.ymd,
                  e.value as string | null,
                )
              }
              placeholder={t('shift_planner.pick_employee')}
              className="w-full text-sm"
              showClear
              disabled={loading}
            />
            <Button
              type="button"
              className="p-button-sm w-full"
              label={t('shift_planner.add_assignment')}
              icon="pi pi-plus"
              onClick={() =>
                void addAssignment(
                  planningCellModal.shiftId,
                  planningCellModal.ymd,
                )
              }
              disabled={
                loading ||
                !getPick(planningCellModal.shiftId, planningCellModal.ymd)
              }
            />
            <Divider className="my-2" />
            <div className="text-sm font-medium mb-2">
              {t('shift_planner.modal_rollout_title')}
            </div>
            <p className="text-sm text-color-secondary m-0 mb-2 line-height-3">
              {t('shift_planner.modal_rollout_hint')}
            </p>
            {planningModalAssignments.length === 0 ? (
              <p className="text-sm text-color-secondary m-0 mb-2 line-height-3">
                {t('shift_planner.modal_rollout_no_assignments')}
              </p>
            ) : (
              <p className="text-sm m-0 mb-2 line-height-3">
                {t('shift_planner.modal_rollout_assignees', {
                  count: planningModalAssignments.length,
                })}
              </p>
            )}
            <div className="text-sm font-medium mb-2">
              {t('shift_planner.rollout_weekdays')}
            </div>
            <div className="flex flex-wrap gap-3 mb-3">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => (
                <div key={d} className="flex align-items-center gap-2">
                  <Checkbox
                    inputId={`modal_rollout_wd_${d}`}
                    checked={modalRolloutWeekdays[d] === true}
                    onChange={(e) =>
                      setModalRolloutWeekdays((prev) => ({
                        ...prev,
                        [d]: !!e.checked,
                      }))
                    }
                    disabled={rolloutApplying || loading}
                  />
                  <label
                    htmlFor={`modal_rollout_wd_${d}`}
                    className="text-sm cursor-pointer"
                  >
                    {t(`shifts.weekday_${d}` as const)}
                  </label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap align-items-end gap-3">
              <div className="flex flex-column gap-2">
                <label className="text-sm font-medium">
                  {t('shift_planner.rollout_target_from')}
                </label>
                <Calendar
                  value={modalRolloutTargetFrom}
                  onChange={(e) =>
                    setModalRolloutTargetFrom(e.value as Date | null)
                  }
                  showIcon
                  showButtonBar
                  dateFormat={plannerCalendarDateFormat}
                  disabled={rolloutApplying || loading}
                />
              </div>
              <div className="flex flex-column gap-2">
                <label className="text-sm font-medium">
                  {t('shift_planner.rollout_target_to')}
                </label>
                <Calendar
                  value={modalRolloutTargetTo}
                  onChange={(e) =>
                    setModalRolloutTargetTo(e.value as Date | null)
                  }
                  showIcon
                  showButtonBar
                  dateFormat={plannerCalendarDateFormat}
                  disabled={rolloutApplying || loading}
                />
              </div>
              <Button
                type="button"
                label={t('shift_planner.modal_rollout_apply')}
                icon="pi pi-arrow-circle-right"
                onClick={() => void applyModalCellRollout()}
                loading={rolloutApplying}
                disabled={
                  loading ||
                  planningModalAssignments.length === 0 ||
                  rolloutApplying
                }
              />
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        header={t('shift_planner.absent_dialog_title')}
        visible={absentOpen}
        onHide={() => setAbsentOpen(false)}
        style={{ width: 'min(28rem, 96vw)' }}
        dismissableMask
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              onClick={() => setAbsentOpen(false)}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveAbsent()}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <span className="text-sm font-medium">
            {t('shift_planner.absent_reason')}
          </span>
          <div className="flex flex-column gap-2">
            {absentReasonOptions.map((opt) => (
              <div key={opt.value} className="flex align-items-center gap-2">
                <RadioButton
                  inputId={`absent_${opt.value}`}
                  name="absent_reason"
                  value={opt.value}
                  onChange={() => setAbsentReason(opt.value)}
                  checked={absentReason === opt.value}
                />
                <label
                  htmlFor={`absent_${opt.value}`}
                  className="text-sm cursor-pointer"
                >
                  {opt.label}
                </label>
              </div>
            ))}
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="absent_remark" className="text-sm font-medium">
              {t('shift_planner.absent_remark')}
            </label>
            <InputTextarea
              id="absent_remark"
              value={absentRemark}
              onChange={(e) => setAbsentRemark(e.target.value)}
              rows={3}
              className="w-full"
              maxLength={2000}
            />
          </div>
        </div>
      </Dialog>
    </AppShell>
  )
}
