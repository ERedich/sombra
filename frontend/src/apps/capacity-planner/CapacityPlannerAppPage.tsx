/**
 * Capacity Planner: Gantt-style planned WOs + utilization grid.
 * DnD: move WO on timeline; drag a shift-day utilization cell onto a WO bar to assign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { Dropdown } from 'primereact/dropdown'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import { InputNumber } from 'primereact/inputnumber'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import { useWorkOrderMw } from '../../layout/WorkOrderMwProvider'
import { formatDate, formatDateTime } from '../../utils/dateTime'
import { primeDateFormatForDtf } from '../../utils/dateTimeFormatPreference'
import { visualizationBarCssVars } from '../../utils/visualizationBarStyle'
import {
  shiftFirstSegmentLayoutPct,
  woOverlapsAnyShiftFirstSegmentLocal,
} from '../../utils/capacityWoShiftOverlap'
import {
  mergedGridShiftIntervalsLocalMs,
  woShiftHighlightOverlaysInPill,
} from '../../utils/capacityPlannerWoBarAvailability'
import {
  barLayoutIntersectLocalDay,
  DAY_SLOTS_15MIN,
  planStartSnappedToLocal15MinSlot,
  slotIndexFromClientX,
} from '../../utils/capacityPlannerDayLayout'
import {
  mergeDisplayStatusColours,
  WORK_ORDER_STATUS_KEYS,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'

const WO_MOVE_MIME = 'application/x-sombra-capacity-wo-move+json'
/** Employee + calendar day of the dragged utilization cell (shift capacity bucket). */
const SHIFT_SLOT_DRAG_MIME = 'application/x-sombra-capacity-shift-slot+json'

/** Gantt + utilization tables share these so day columns and label columns line up. */
const CP_FIRST_COL_MIN_PX = 220
const CP_DAY_COL_MIN_PX = 120
/** 15-minute slot columns in Gantt day mode (96 per local day). */
const CP_TIMELINE_SLOT_MIN_PX = 12
const HOURS_0_23 = Array.from({ length: 24 }, (_, h) => h)
const QUARTER_SLOTS = Array.from({ length: DAY_SLOTS_15MIN }, (_, i) => i)
/** When PHR is off, InputNumber max if work order has no positive duration. */
const CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED = 9999

const WG_FILTER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const WO_STATUS_I18N_KEYS: Record<string, string> = {
  open: 'wo.status_open',
  assigned: 'wo.status_assigned',
  started: 'wo.status_started',
  continued: 'wo.status_continued',
  on_hold: 'wo.status_on_hold',
  done: 'wo.status_done',
  closed: 'wo.status_closed',
}

type WorkgroupOpt = {
  id: string
  site_id: string
  key: string
  name: string
}

type WorkgroupsListResponse = { workgroups: WorkgroupOpt[] }

function roundPlannedHours(n: number): number {
  return Math.round(n * 100) / 100
}

function dayIndexFromClientX(
  clientX: number,
  trackEl: HTMLElement,
  n: number,
): number {
  if (n <= 0) return 0
  const rect = trackEl.getBoundingClientRect()
  const w = rect.width || 1
  const x = Math.max(0, Math.min(clientX - rect.left, w))
  const idx = Math.floor((x / w) * n)
  return Math.max(0, Math.min(idx, n - 1))
}

/** Keep local clock time; place on target calendar day (browser-local date parts). */
function planStartOnLocalCalendarDay(planStartIso: string, targetYmd: string): Date {
  const o = new Date(planStartIso)
  const [y, m, d] = targetYmd.split('-').map(Number)
  return new Date(
    y,
    m - 1,
    d,
    o.getHours(),
    o.getMinutes(),
    o.getSeconds(),
    o.getMilliseconds(),
  )
}

function dndTypesInclude(dt: DataTransfer, mime: string): boolean {
  return Array.from(dt.types ?? []).includes(mime)
}

type SnapshotWorkOrder = {
  id: string
  wo_key: number
  short_text: string
  plan_start: string | null
  plan_end: string | null
  planned_duration: string
  status: string
  workgroup_id: string
  asset_key: string
  asset_name: string
  work_type_key: string
  work_type_name: string
  work_type_colour: string
  assigned_employee_ids: string[]
}

type ShiftAssignment = {
  id: string
  shift_id: string
  assignment_date: string
  employee_id: string
  shift_key: string
  shift_name: string
  time_start: string
  time_end: string
  employee_key: string
  employee_name: string
}

type CapacityAllocation = {
  work_order_id: string
  employee_id: string
  allocation_date: string
  planned_hours: number
}

type AssignModalPrep = {
  assigns: ShiftAssignment[]
  existing: CapacityAllocation | undefined
  modalHours: number
}

type SnapshotResponse = {
  work_orders: SnapshotWorkOrder[]
  shift_assignments: ShiftAssignment[]
  capacity_allocations: CapacityAllocation[]
  used_hours_by_employee_date: Record<string, Record<string, number>>
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local calendar date at noon (for Calendar value bound to `YYYY-MM-DD`). */
function parseLocalYmdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const d = parseLocalYmdToDate(ymd)
  d.setDate(d.getDate() + deltaDays)
  return toYmd(d)
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

function toLocalYmd(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MS_PER_DAY = 86400000

/** Fraction [0, 1] of local calendar day for `iso` (0 = local midnight that day). */
function localTimeOfDayFraction(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  const sod = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    0,
  ).getTime()
  return Math.max(0, Math.min((d.getTime() - sod) / MS_PER_DAY, 1))
}

function woGanttPillDescription(wo: SnapshotWorkOrder): string {
  const name = wo.short_text.trim()
  const keyPart = `#${wo.wo_key}`
  const head = name ? `${keyPart} — ${name}` : keyPart
  const plan =
    wo.plan_start && wo.plan_end
      ? `${formatDateTime(wo.plan_start)} → ${formatDateTime(wo.plan_end)}`
      : '—'
  return `${head}. ${plan}`
}

const MINUTES_PER_DAY = 24 * 60

function timeHmsToMinutes(hms: string): number {
  const parts = hms.split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  return h * 60 + m
}

function shiftHoursOnAssignmentDay(timeStart: string, timeEnd: string): number {
  const start = timeHmsToMinutes(timeStart)
  const end = timeHmsToMinutes(timeEnd)
  if (end <= start) {
    return (MINUTES_PER_DAY - start) / 60
  }
  return (end - start) / 60
}

function isOvernightShift(timeStart: string, timeEnd: string): boolean {
  return timeHmsToMinutes(timeEnd) <= timeHmsToMinutes(timeStart)
}

/** Utilization bucket for planned (assigned WO) hours vs shift×SPC capacity. */
function utilizationClass(
  capHours: number,
  plannedHours: number,
): 'low' | 'mid' | 'high' | null {
  if (!(capHours > 0)) return null
  const r = plannedHours / capHours
  if (r >= 1) return 'high'
  if (r >= 0.5) return 'mid'
  return 'low'
}

function barLayout(
  wo: SnapshotWorkOrder,
  dateList: string[],
): { leftPct: number; widthPct: number } | null {
  if (!wo.plan_start || !wo.plan_end || dateList.length === 0) return null
  const psY = toLocalYmd(wo.plan_start)
  const peY = toLocalYmd(wo.plan_end)
  const n = dateList.length
  const i0 = dateList.findIndex((d) => d >= psY)
  if (i0 < 0) return null
  let i1 = -1
  for (let i = 0; i < n; i += 1) {
    if (dateList[i]! <= peY) i1 = i
  }
  if (i1 < i0) return null

  const firstColYmd = dateList[i0]!
  const lastColYmd = dateList[i1]!
  /** If plan started on a calendar day before the first visible column, overlap begins at that column’s midnight (left edge), not at plan time-of-day on the wrong day. */
  const rawStartFrac = localTimeOfDayFraction(wo.plan_start)
  const rawEndFrac = localTimeOfDayFraction(wo.plan_end)
  const startFrac = psY < firstColYmd ? 0 : rawStartFrac
  const endFrac = peY > lastColYmd ? 1 : rawEndFrac
  const invN = 100 / n
  let leftPct = (i0 + startFrac) * invN
  let rightPct = (i1 + endFrac) * invN
  if (!(rightPct > leftPct)) return null

  leftPct = Math.max(0, leftPct)
  rightPct = Math.min(100, rightPct)
  if (!(rightPct > leftPct)) return null

  const widthPct = rightPct - leftPct
  return { leftPct, widthPct }
}

/**
 * Square outer corners where the bar is clipped to the visible timeline (not the WO’s true
 * start/end calendar day) — “interim” ends in week view; same idea for day view vs plan span.
 */
function woBarCornerClipFlags(
  wo: SnapshotWorkOrder,
  dateList: string[],
): { clipStart: boolean; clipEnd: boolean } {
  if (!wo.plan_start || !wo.plan_end || dateList.length === 0) {
    return { clipStart: false, clipEnd: false }
  }
  const psY = toLocalYmd(wo.plan_start)
  const peY = toLocalYmd(wo.plan_end)
  const n = dateList.length
  const i0 = dateList.findIndex((d) => d >= psY)
  if (i0 < 0) return { clipStart: false, clipEnd: false }
  let i1 = -1
  for (let i = 0; i < n; i += 1) {
    if (dateList[i]! <= peY) i1 = i
  }
  if (i1 < i0) return { clipStart: false, clipEnd: false }
  const firstColYmd = dateList[i0]!
  const lastColYmd = dateList[i1]!
  return {
    clipStart: psY < firstColYmd,
    clipEnd: peY > lastColYmd,
  }
}

function isWorkOrderStatusColourKey(s: string): s is WorkOrderStatusColourKey {
  return (WORK_ORDER_STATUS_KEYS as readonly string[]).includes(s)
}

function woBarAccentFromStatus(
  status: string,
  merged: Record<WorkOrderStatusColourKey, string>,
): string {
  if (isWorkOrderStatusColourKey(status)) {
    return merged[status]
  }
  return merged.open
}

function woBarCornerClipFlagsDay(
  wo: SnapshotWorkOrder,
  dayYmd: string,
): { clipStart: boolean; clipEnd: boolean } {
  if (!wo.plan_start || !wo.plan_end) return { clipStart: false, clipEnd: false }
  const psY = toLocalYmd(wo.plan_start)
  const peY = toLocalYmd(wo.plan_end)
  return {
    clipStart: psY < dayYmd,
    clipEnd: peY > dayYmd,
  }
}

/** Local calendar day `ymd` (YYYY-MM-DD) within WO plan window (same semantics as barLayout). */
function allocationDateInsideWoPlan(
  wo: SnapshotWorkOrder,
  ymd: string,
): boolean {
  if (!wo.plan_start || !wo.plan_end) return false
  const psY = toLocalYmd(wo.plan_start)
  const peY = toLocalYmd(wo.plan_end)
  return psY <= ymd && ymd <= peY
}

type ModalCtx = {
  workOrder: SnapshotWorkOrder
  employeeId: string
  employeeName: string
  allocationDate: string
  assignments: ShiftAssignment[]
}

export default function CapacityPlannerAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    shiftPlanningCapacityPct,
    dtf,
    plannedHoursRestriction,
  } = useAppParameters()
  const workingSiteId = getStoredUser()?.working_site_id ?? null
  const toast = useRef<Toast>(null)

  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [rangeTo, setRangeTo] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 13)
    return d
  })

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [modalCtx, setModalCtx] = useState<ModalCtx | null>(null)
  const [modalHours, setModalHours] = useState<number | null>(0)
  const [modalSaving, setModalSaving] = useState(false)
  const [woMoveDragActive, setWoMoveDragActive] = useState(false)
  const [shiftSlotDragActive, setShiftSlotDragActive] = useState(false)
  /** Week: `day:<ymd>`. Day mode: `quarter:<0-95>` (15 min). Pill: `wo:<id>`. */
  const [capacityDropHover, setCapacityDropHover] = useState<
    null | `day:${string}` | `quarter:${number}` | `wo:${string}`
  >(null)
  const [workgroups, setWorkgroups] = useState<WorkgroupOpt[]>([])
  const [woStatusColourOverrides, setWoStatusColourOverrides] = useState<
    Partial<Record<WorkOrderStatusColourKey, string>>
  >({})
  /** Empty string = no filter (all workgroups). */
  const [workgroupFilterId, setWorkgroupFilterId] = useState('')
  /** Gantt: week columns vs single local calendar day with hourly columns. */
  const [ganttTimescale, setGanttTimescale] = useState<'week' | 'day'>('week')
  /** Calendar day (same semantics as `dateList`) for Gantt day mode. */
  const [ganttDayYmd, setGanttDayYmd] = useState<string>(() => toYmd(new Date()))

  const ganttScrollRef = useRef<HTMLDivElement>(null)
  const utilScrollRef = useRef<HTMLDivElement>(null)
  const syncingHorizontalScroll = useRef(false)
  const prevGanttTimescaleRef = useRef(ganttTimescale)

  const weekDateList = useMemo(
    () => enumerateDates(rangeFrom, rangeTo),
    [rangeFrom, rangeTo],
  )

  const dateList = useMemo(() => {
    if (ganttTimescale === 'day' && ganttDayYmd) return [ganttDayYmd]
    return weekDateList
  }, [ganttTimescale, ganttDayYmd, weekDateList])

  const plannerCalendarDateFormat = useMemo(
    () => primeDateFormatForDtf(dtf),
    [dtf],
  )

  /** Re-render periodically so the “now” line tracks local time of day. */
  const [nowPulse, setNowPulse] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setNowPulse((n) => n + 1), 30000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<{
          wo?: {
            work_order_status_colours?: Partial<
              Record<WorkOrderStatusColourKey, string>
            >
          }
        }>('/api/app-parameters')
        if (!cancelled) {
          const raw = data.wo?.work_order_status_colours
          setWoStatusColourOverrides(
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Partial<Record<WorkOrderStatusColourKey, string>>)
              : {},
          )
        }
      } catch {
        if (!cancelled) setWoStatusColourOverrides({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const woStatusMergedColours = useMemo(
    () => mergeDisplayStatusColours(woStatusColourOverrides),
    [woStatusColourOverrides],
  )

  const plannerNowMarkers = useMemo(() => {
    void nowPulse
    const now = new Date()
    const todayYmd = toYmd(now)
    const frac = localTimeOfDayFraction(now.toISOString())
    const dayViewToday = ganttTimescale === 'day' && ganttDayYmd === todayYmd
    const weekViewHasToday =
      ganttTimescale === 'week' &&
      dateList.includes(todayYmd) &&
      dateList.length > 0
    let ganttLinePct: number | null = null
    if (dayViewToday) {
      ganttLinePct = frac * 100
    } else if (weekViewHasToday) {
      const i = dateList.indexOf(todayYmd)
      ganttLinePct = ((i + frac) / dateList.length) * 100
    }
    const employeeColLinePct = weekViewHasToday ? frac * 100 : null
    return { ganttLinePct, employeeColLinePct, todayYmd }
  }, [nowPulse, ganttTimescale, ganttDayYmd, dateList])

  const { mountWoMw, subscribeWorkOrderMwEvents } = useWorkOrderMw()

  const workgroupsForSite = useMemo(
    () => workgroups.filter((wg) => wg.site_id === workingSiteId),
    [workgroups, workingSiteId],
  )

  const workgroupFilterOptions = useMemo(
    () => [
      { label: t('capacity_planner.workgroup_all'), value: '' },
      ...workgroupsForSite.map((wg) => ({
        label: `${wg.key} · ${wg.name}`,
        value: wg.id,
      })),
    ],
    [t, workgroupsForSite],
  )

  useEffect(() => {
    if (!workingSiteId) return
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<WorkgroupsListResponse>('/api/workgroups')
        if (!cancelled) setWorkgroups(data.workgroups ?? [])
      } catch {
        if (!cancelled) setWorkgroups([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workingSiteId])

  useEffect(() => {
    if (!workgroupFilterId) return
    if (!workgroupsForSite.some((w) => w.id === workgroupFilterId)) {
      setWorkgroupFilterId('')
    }
  }, [workgroupsForSite, workgroupFilterId])

  /** When switching week → day, keep the focused day inside the last week range if needed. */
  useEffect(() => {
    const prev = prevGanttTimescaleRef.current
    prevGanttTimescaleRef.current = ganttTimescale
    if (prev !== 'week' || ganttTimescale !== 'day') return
    if (weekDateList.length === 0) return
    if (!weekDateList.includes(ganttDayYmd)) {
      setGanttDayYmd(weekDateList[0]!)
    }
  }, [ganttTimescale, weekDateList, ganttDayYmd])

  const loadSnapshot = useCallback(async () => {
    let df: string
    let dt: string
    if (ganttTimescale === 'day' && ganttDayYmd) {
      df = ganttDayYmd
      dt = ganttDayYmd
    } else {
      df = toYmd(rangeFrom)
      dt = toYmd(rangeTo)
      if (df > dt) {
        setLoadError(t('capacity_planner.range_invalid'))
        return
      }
    }
    setLoading(true)
    setLoadError(null)
    const wg =
      workgroupFilterId.trim() && WG_FILTER_UUID_RE.test(workgroupFilterId.trim())
        ? `&workgroup_id=${encodeURIComponent(workgroupFilterId.trim())}`
        : ''
    try {
      const data = await apiJson<SnapshotResponse>(
        `/api/capacity-planner/snapshot?date_from=${encodeURIComponent(df)}&date_to=${encodeURIComponent(dt)}${wg}`,
      )
      setSnapshot(data)
    } catch (e) {
      if (e instanceof ApiError) {
        setLoadError(e.message)
      } else {
        setLoadError(t('capacity_planner.load_fail'))
      }
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [rangeFrom, rangeTo, ganttTimescale, ganttDayYmd, t, workgroupFilterId])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  useEffect(
    () =>
      subscribeWorkOrderMwEvents((ev) => {
        if (
          ev.type === 'merged_row' ||
          ev.type === 'created_row' ||
          ev.type === 'silent_list_refresh'
        ) {
          void loadSnapshot()
        }
      }),
    [subscribeWorkOrderMwEvents, loadSnapshot],
  )

  const onGanttTableScroll = useCallback(() => {
    if (syncingHorizontalScroll.current) return
    const src = ganttScrollRef.current
    const dst = utilScrollRef.current
    if (!src || !dst) return
    syncingHorizontalScroll.current = true
    dst.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => {
      syncingHorizontalScroll.current = false
    })
  }, [])

  const onUtilTableScroll = useCallback(() => {
    if (syncingHorizontalScroll.current) return
    const src = utilScrollRef.current
    const dst = ganttScrollRef.current
    if (!src || !dst) return
    syncingHorizontalScroll.current = true
    dst.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => {
      syncingHorizontalScroll.current = false
    })
  }, [])

  const spcFrac = shiftPlanningCapacityPct / 100

  const employeesInRange = useMemo(() => {
    const m = new Map<
      string,
      { id: string; key: string; name: string }
    >()
    for (const a of snapshot?.shift_assignments ?? []) {
      if (!m.has(a.employee_id)) {
        m.set(a.employee_id, {
          id: a.employee_id,
          key: a.employee_key,
          name: a.employee_name,
        })
      }
    }
    return [...m.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [snapshot])

  /** Union of grid shift windows (epoch ms, local calendar day) for stripes on WO bars. */
  const mergedGridShiftIntervalsLocalMsMemo = useMemo(
    () =>
      mergedGridShiftIntervalsLocalMs(
        snapshot?.shift_assignments ?? [],
        dateList,
      ),
    [snapshot?.shift_assignments, dateList],
  )

  const mergedShiftsGanttDay = useMemo(
    () =>
      ganttTimescale === 'day' && ganttDayYmd
        ? mergedGridShiftIntervalsLocalMs(snapshot?.shift_assignments ?? [], [
            ganttDayYmd,
          ])
        : [],
    [snapshot?.shift_assignments, ganttTimescale, ganttDayYmd],
  )

  function capForCell(employeeId: string, ymd: string): number {
    const assigns = (snapshot?.shift_assignments ?? []).filter(
      (a) => a.employee_id === employeeId && a.assignment_date === ymd,
    )
    let h = 0
    for (const a of assigns) {
      h += shiftHoursOnAssignmentDay(a.time_start, a.time_end) * spcFrac
    }
    return h
  }

  function usedForCell(employeeId: string, ymd: string): number {
    return snapshot?.used_hours_by_employee_date[employeeId]?.[ymd] ?? 0
  }

  /** Per calendar day: sum of shift×SPC capacity and planned hours across employees in the grid. */
  const capacityGridColumnTotals = useMemo(() => {
    const assigns = snapshot?.shift_assignments ?? []
    const usedMap = snapshot?.used_hours_by_employee_date ?? {}
    return dateList.map((ymd) => {
      let totalCap = 0
      let totalPlanned = 0
      for (const emp of employeesInRange) {
        const empAssigns = assigns.filter(
          (a) => a.employee_id === emp.id && a.assignment_date === ymd,
        )
        for (const a of empAssigns) {
          totalCap +=
            shiftHoursOnAssignmentDay(a.time_start, a.time_end) * spcFrac
        }
        totalPlanned += usedMap[emp.id]?.[ymd] ?? 0
      }
      return { cap: totalCap, planned: totalPlanned }
    })
  }, [snapshot, dateList, employeesInRange, spcFrac])

  function computeAssignModalPrep(
    wo: SnapshotWorkOrder,
    employeeId: string,
    allocationDate: string,
  ): AssignModalPrep | null {
    const assigns = (snapshot?.shift_assignments ?? []).filter(
      (a) => a.employee_id === employeeId && a.assignment_date === allocationDate,
    )
    if (assigns.length === 0) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.drop_no_shift'),
        life: 4500,
      })
      return null
    }
    if (!allocationDateInsideWoPlan(wo, allocationDate)) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.drop_outside_plan'),
        life: 5000,
      })
      return null
    }
    const existing = (snapshot?.capacity_allocations ?? []).find(
      (c) =>
        c.work_order_id === wo.id &&
        c.employee_id === employeeId &&
        c.allocation_date === allocationDate,
    )
    const overlapsShiftWo =
      wo.plan_start != null &&
      wo.plan_end != null &&
      woOverlapsAnyShiftFirstSegmentLocal(
        wo.plan_start,
        wo.plan_end,
        allocationDate,
        assigns,
      )
    if (!overlapsShiftWo && !existing) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.drop_shift_wo_time_mismatch'),
        life: 5500,
      })
      return null
    }
    const cap = capForCell(employeeId, allocationDate)
    const used = usedForCell(employeeId, allocationDate)
    const remaining = Math.max(
      0,
      roundPlannedHours(cap - used + (existing?.planned_hours ?? 0)),
    )
    const def = plannedHoursRestriction
      ? Math.min(remaining, Math.max(0.25, remaining))
      : Math.min(
          CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED,
          Math.max(0.25, remaining),
        )
    const modalHours =
      existing ? Math.round(existing.planned_hours * 100) / 100 : Math.round(def * 100) / 100
    return { assigns, existing, modalHours }
  }

  function applyAssignModalFromPrep(
    wo: SnapshotWorkOrder,
    employeeId: string,
    employeeName: string,
    allocationDate: string,
    prep: AssignModalPrep,
  ) {
    setModalCtx({
      workOrder: wo,
      employeeId,
      employeeName,
      allocationDate,
      assignments: prep.assigns,
    })
    setModalHours(prep.modalHours)
  }

  async function saveModal() {
    if (!modalCtx || modalHours === null) return
    setModalSaving(true)
    try {
      await apiJson<{ work_order: SnapshotWorkOrder }>(
        `/api/work-orders/${encodeURIComponent(modalCtx.workOrder.id)}/capacity-allocation`,
        {
          method: 'PUT',
          body: JSON.stringify({
            employee_id: modalCtx.employeeId,
            allocation_date: modalCtx.allocationDate,
            planned_hours: modalHours,
          }),
        },
      )
      toast.current?.show({
        severity: 'success',
        summary: t('capacity_planner.toast_saved'),
        life: 2500,
      })
      setModalCtx(null)
      await loadSnapshot()
    } catch (e) {
      if (e instanceof ApiError) {
        toast.current?.show({
          severity: 'error',
          summary: e.message,
          life: 5000,
        })
      } else {
        toast.current?.show({
          severity: 'error',
          summary: t('capacity_planner.save_fail'),
          life: 5000,
        })
      }
    } finally {
      setModalSaving(false)
    }
  }

  async function clearAllocation() {
    if (!modalCtx) return
    setModalSaving(true)
    try {
      await apiJson(
        `/api/work-orders/${encodeURIComponent(modalCtx.workOrder.id)}/capacity-allocation`,
        {
          method: 'PUT',
          body: JSON.stringify({
            employee_id: modalCtx.employeeId,
            allocation_date: modalCtx.allocationDate,
            planned_hours: 0,
          }),
        },
      )
      toast.current?.show({
        severity: 'success',
        summary: t('capacity_planner.toast_cleared'),
        life: 2500,
      })
      setModalCtx(null)
      await loadSnapshot()
    } catch (e) {
      if (e instanceof ApiError) {
        toast.current?.show({
          severity: 'error',
          summary: e.message,
          life: 5000,
        })
      }
    } finally {
      setModalSaving(false)
    }
  }

  async function patchWoPlanAfterDrag(wo: SnapshotWorkOrder, newStart: Date) {
    const now = Date.now()
    if (newStart.getTime() < now) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.no_past_plan'),
        life: 4000,
      })
      return
    }
    const oldStartMs = new Date(wo.plan_start!).getTime()
    const deltaMs = newStart.getTime() - oldStartMs
    if (deltaMs === 0) return

    const body: Record<string, string> = {
      plan_start: newStart.toISOString(),
    }
    if (wo.plan_end) {
      body.plan_end = new Date(
        new Date(wo.plan_end).getTime() + deltaMs,
      ).toISOString()
    }

    try {
      await apiJson(`/api/work-orders/${encodeURIComponent(wo.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      await loadSnapshot()
    } catch (e) {
      if (e instanceof ApiError) {
        toast.current?.show({
          severity: 'error',
          summary: e.message,
          life: 5000,
        })
      }
    }
  }

  function handleWoMoveDrop(e: React.DragEvent, trackEl: HTMLElement) {
    if (!dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    let workOrderId = ''
    try {
      workOrderId =
        (JSON.parse(e.dataTransfer.getData(WO_MOVE_MIME)) as { workOrderId?: string })
          .workOrderId ?? ''
    } catch {
      return
    }
    const wo = snapshot?.work_orders.find((w) => w.id === workOrderId)
    if (!wo?.plan_start) return

    let clamped: Date
    let fromLabel: string
    let toLabel: string
    const subject = `WO #${wo.wo_key} ${wo.short_text.trim() ? wo.short_text.trim() : '—'}`

    if (ganttTimescale === 'day' && ganttDayYmd) {
      if (toLocalYmd(wo.plan_start) !== ganttDayYmd) {
        return
      }
      const slot = slotIndexFromClientX(
        e.clientX,
        trackEl,
        DAY_SLOTS_15MIN,
      )
      const snapped = planStartSnappedToLocal15MinSlot(ganttDayYmd, slot)
      clamped = new Date(Math.max(snapped.getTime(), Date.now()))
      if (clamped.getTime() === new Date(wo.plan_start).getTime()) return
      fromLabel = formatDateTime(wo.plan_start)
      toLabel = formatDateTime(clamped.toISOString())
    } else {
      if (dateList.length === 0) return
      const psY = toLocalYmd(wo.plan_start)
      const w0 = dateList[0]!
      const w1 = dateList[dateList.length - 1]!
      if (psY < w0 || psY > w1) return
      const idx = dayIndexFromClientX(e.clientX, trackEl, dateList.length)
      const targetYmd = dateList[idx]!
      const newStart = planStartOnLocalCalendarDay(wo.plan_start, targetYmd)
      clamped = new Date(Math.max(newStart.getTime(), Date.now()))
      if (clamped.getTime() === new Date(wo.plan_start).getTime()) return
      const fromYmd = toLocalYmd(wo.plan_start)
      fromLabel = formatDate(parseLocalYmdToDate(fromYmd).toISOString())
      toLabel = formatDate(parseLocalYmdToDate(targetYmd).toISOString())
    }

    confirmDialog({
      header: t('common.dnd_confirm_move_header'),
      message: (
        <Trans
          i18nKey="common.dnd_confirm_move_msg"
          values={{ subject, from: fromLabel, to: toLabel }}
          components={{
            subj: <span className="app-dnd-confirm-subject" />,
            loc: <span className="app-dnd-confirm-location" />,
          }}
        />
      ),
      icon: 'pi pi-exclamation-triangle',
      accept: () => void patchWoPlanAfterDrag(wo, clamped),
    })
  }

  function handleShiftSlotDropOnWo(e: React.DragEvent, wo: SnapshotWorkOrder) {
    if (!dndTypesInclude(e.dataTransfer, SHIFT_SLOT_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    let employeeId = ''
    let employeeName = ''
    let allocationDate = ''
    try {
      const p = JSON.parse(e.dataTransfer.getData(SHIFT_SLOT_DRAG_MIME)) as {
        employeeId?: string
        employeeName?: string
        allocationDate?: string
      }
      employeeId = p.employeeId ?? ''
      employeeName = p.employeeName ?? ''
      allocationDate = p.allocationDate ?? ''
    } catch {
      return
    }
    if (!employeeId || !allocationDate) return
    const prep = computeAssignModalPrep(wo, employeeId, allocationDate)
    if (!prep) return
    applyAssignModalFromPrep(wo, employeeId, employeeName, allocationDate, prep)
  }

  const modalMaxHours = useMemo(() => {
    if (!modalCtx || !snapshot) return 99
    if (!plannedHoursRestriction) {
      return Math.max(0, CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED)
    }
    const cap = capForCell(modalCtx.employeeId, modalCtx.allocationDate)
    const used = usedForCell(modalCtx.employeeId, modalCtx.allocationDate)
    const existing = snapshot.capacity_allocations.find(
      (c) =>
        c.work_order_id === modalCtx.workOrder.id &&
        c.employee_id === modalCtx.employeeId &&
        c.allocation_date === modalCtx.allocationDate,
    )
    const remaining = Math.max(
      0,
      roundPlannedHours(cap - used + (existing?.planned_hours ?? 0)),
    )
    return Math.max(0, remaining)
  }, [modalCtx, snapshot, plannedHoursRestriction])

  const headerNode = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-chart-bar text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('capacity_planner.title')}</h1>
        <p className="app-card-hero-desc">{t('capacity_planner.subtitle')}</p>
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
      <Toast ref={toast} position="top-center" />
      <ConfirmDialog dismissableMask />
      <div
        className="p-4 flex flex-column gap-3 app-capacity-planner"
        style={{ maxWidth: '100%' }}
      >
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={headerNode}
        >
          {loadError ? (
            <Message severity="error" text={loadError} className="w-full mb-3" />
          ) : null}

          <div className="flex flex-wrap align-items-end gap-3 mb-3 w-full">
            {ganttTimescale === 'day' ? (
              <div className="flex flex-column gap-2">
                <label htmlFor="cp-day-filter" className="text-sm font-medium">
                  {t('capacity_planner.day_filter')}
                </label>
                <div
                  className="p-inputgroup cp-day-filter-inputgroup flex-shrink-0"
                  style={{ minWidth: 'min(22rem, 100%)' }}
                >
                  <Button
                    type="button"
                    label="<"
                    onClick={() => setGanttDayYmd((d) => addDaysToYmd(d, -1))}
                    disabled={loading}
                    aria-label={t('capacity_planner.day_prev')}
                    outlined
                  />
                  <Calendar
                    inputId="cp-day-filter"
                    value={parseLocalYmdToDate(ganttDayYmd)}
                    onChange={(e) => {
                      const v = e.value as Date | null
                      if (!v) return
                      setGanttDayYmd(toYmd(v))
                    }}
                    showIcon
                    showButtonBar
                    dateFormat={plannerCalendarDateFormat}
                    disabled={loading}
                    variant="outlined"
                    className="flex-1 min-w-0 cp-day-filter-calendar"
                  />
                  <Button
                    type="button"
                    label=">"
                    onClick={() => setGanttDayYmd((d) => addDaysToYmd(d, 1))}
                    disabled={loading}
                    aria-label={t('capacity_planner.day_next')}
                    outlined
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-column gap-2">
                  <label htmlFor="cp-cal-from" className="text-sm font-medium">
                    {t('capacity_planner.date_from')}
                  </label>
                  <Calendar
                    inputId="cp-cal-from"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom((e.value as Date) ?? rangeFrom)}
                    showIcon
                    showButtonBar
                    dateFormat={plannerCalendarDateFormat}
                    disabled={loading}
                  />
                </div>
                <div className="flex flex-column gap-2">
                  <label htmlFor="cp-cal-to" className="text-sm font-medium">
                    {t('capacity_planner.date_to')}
                  </label>
                  <Calendar
                    inputId="cp-cal-to"
                    value={rangeTo}
                    onChange={(e) => setRangeTo((e.value as Date) ?? rangeTo)}
                    showIcon
                    showButtonBar
                    dateFormat={plannerCalendarDateFormat}
                    disabled={loading}
                  />
                </div>
              </>
            )}
            <div className="flex flex-column gap-2" style={{ minWidth: 'min(22rem, 100%)' }}>
              <label htmlFor="cp-workgroup-filter" className="text-sm font-medium">
                {t('capacity_planner.workgroup_filter')}
              </label>
              <Dropdown
                inputId="cp-workgroup-filter"
                value={workgroupFilterId}
                options={workgroupFilterOptions}
                optionLabel="label"
                optionValue="value"
                onChange={(e) => setWorkgroupFilterId((e.value as string) ?? '')}
                disabled={loading}
                className="w-full"
                showClear={Boolean(workgroupFilterId)}
              />
            </div>
            <Button
              type="button"
              label={t('capacity_planner.reload')}
              icon="pi pi-refresh"
              onClick={() => void loadSnapshot()}
              loading={loading}
            />
            <Button
              type="button"
              label={t('capacity_planner.toggle_timescale')}
              icon="pi pi-calendar"
              onClick={() =>
                setGanttTimescale((s) => (s === 'week' ? 'day' : 'week'))
              }
              disabled={loading}
              outlined
            />
          </div>

          <div className="flex flex-column gap-3">
            <Card
              title={t('capacity_planner.panel_gantt')}
              className="cp-planner-inner-card shadow-none border-none border-round-lg overflow-hidden surface-ground"
              pt={{
                title: { className: 'text-lg font-semibold mb-0' },
                body: { className: 'p-0' },
              }}
            >
              <div
                ref={ganttScrollRef}
                className="cp-planner-scroll overflow-auto border-top-1 surface-border"
                style={{
                  maxHeight:
                    ganttTimescale === 'day'
                      ? 'min(calc(100dvh - 12rem), calc(100vh - 12rem))'
                      : 'min(48vh, 520px)',
                }}
                onScroll={onGanttTableScroll}
              >
              <table className="cp-planner-table w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th
                      className="cp-planner-col-first text-left p-2 border-bottom-1 surface-border white-space-nowrap sticky left-0 bg-surface-ground"
                      style={{
                        width: CP_FIRST_COL_MIN_PX,
                        minWidth: CP_FIRST_COL_MIN_PX,
                      }}
                    >
                      {t('capacity_planner.col_work_order')}
                    </th>
                    <th className="p-0 border-bottom-1 surface-border relative">
                      {ganttTimescale === 'day' ? (
                        <div className="flex flex-column gap-1 px-1 py-2">
                          <div className="px-1">
                            <span className="text-sm font-medium">
                              {formatDate(parseLocalYmdToDate(ganttDayYmd).toISOString())}
                            </span>
                          </div>
                          <div className="flex w-full cp-day-hour-scale">
                            {HOURS_0_23.map((h) => (
                              <div
                                key={h}
                                className="flex-1 text-center text-xs text-color-secondary py-1 min-w-0"
                                style={{ minWidth: CP_TIMELINE_SLOT_MIN_PX * 4 }}
                              >
                                {String(h).padStart(2, '0')}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full cp-planner-week-head-days">
                          {dateList.map((ymd) => (
                            <button
                              key={ymd}
                              type="button"
                              className="flex-1 text-center text-xs text-color-secondary py-2 bg-transparent border-none cursor-pointer outline-none white-space-nowrap hover:surface-hover transition-colors transition-duration-150"
                              style={{ minWidth: CP_DAY_COL_MIN_PX }}
                              aria-label={t('capacity_planner.day_timeline_open_aria', {
                                date: formatDate(parseLocalYmdToDate(ymd).toISOString()),
                              })}
                              onClick={() => {
                                setGanttTimescale('day')
                                setGanttDayYmd(ymd)
                              }}
                            >
                              {formatDate(parseLocalYmdToDate(ymd).toISOString())}
                            </button>
                          ))}
                        </div>
                      )}
                      {plannerNowMarkers.ganttLinePct !== null ? (
                        <div
                          className="cp-planner-now-line"
                          style={{ left: `${plannerNowMarkers.ganttLinePct}%` }}
                          aria-hidden
                        />
                      ) : null}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.work_orders ?? []).map((wo) => {
                    const ganttIsDay = ganttTimescale === 'day'
                    const layout =
                      ganttIsDay && ganttDayYmd
                        ? barLayoutIntersectLocalDay(
                            wo.plan_start,
                            wo.plan_end,
                            ganttDayYmd,
                          )
                        : barLayout(wo, dateList)
                    const mergedForOverlays =
                      ganttIsDay && ganttDayYmd
                        ? mergedShiftsGanttDay
                        : mergedGridShiftIntervalsLocalMsMemo
                    const dateListForOverlays =
                      ganttIsDay && ganttDayYmd ? [ganttDayYmd] : dateList
                    const shiftAvailOverlays =
                      layout &&
                      wo.plan_start &&
                      wo.plan_end &&
                      mergedForOverlays.length > 0
                        ? woShiftHighlightOverlaysInPill(
                            wo.plan_start,
                            wo.plan_end,
                            dateListForOverlays,
                            layout,
                            mergedForOverlays,
                          )
                        : []
                    /** Day mode: only WOs whose planned start (local date) is this day may move here. */
                    const woDayMoveLocked =
                      ganttIsDay &&
                      !!ganttDayYmd &&
                      !!wo.plan_start &&
                      toLocalYmd(wo.plan_start) !== ganttDayYmd
                    const weekFirstYmd = dateList[0]
                    const weekLastYmd = dateList[dateList.length - 1]
                    const planStartYmd = wo.plan_start ? toLocalYmd(wo.plan_start) : ''
                    /** Week mode: start (local date) outside visible columns — bar is clipped; moving would be ambiguous. */
                    const woWeekMoveLocked =
                      !ganttIsDay &&
                      !!weekFirstYmd &&
                      !!weekLastYmd &&
                      planStartYmd !== '' &&
                      (planStartYmd < weekFirstYmd || planStartYmd > weekLastYmd)
                    const woMoveDragLocked = woDayMoveLocked || woWeekMoveLocked
                    const woBarCornerClip =
                      ganttIsDay && ganttDayYmd
                        ? woBarCornerClipFlagsDay(wo, ganttDayYmd)
                        : woBarCornerClipFlags(wo, dateList)
                    const barBg = wo.work_type_colour?.trim()
                      ? wo.work_type_colour
                      : 'var(--primary-color)'
                    const woTypeLabel =
                      wo.work_type_key?.trim() ||
                      wo.work_type_name?.trim() ||
                      ''
                    const woTypeColor = wo.work_type_colour?.trim()
                      ? wo.work_type_colour.trim()
                      : undefined
                    const statusColor = woBarAccentFromStatus(
                      wo.status,
                      woStatusMergedColours,
                    )
                    return (
                      <tr
                        key={wo.id}
                        onDoubleClick={(e) => {
                          if ((e.target as HTMLElement).closest('.cp-wo-pill-drag-handle')) {
                            return
                          }
                          mountWoMw(wo.id)
                        }}
                      >
                        <td
                          className="cp-planner-col-first p-2 align-top border-bottom-1 surface-border sticky left-0 bg-surface-ground cursor-pointer"
                          style={{
                            width: CP_FIRST_COL_MIN_PX,
                            minWidth: CP_FIRST_COL_MIN_PX,
                          }}
                        >
                          <div className="flex flex-column gap-1 line-height-3 text-sm font-medium">
                            <div className="flex align-items-center gap-2 flex-wrap">
                              <span className="white-space-nowrap">#{wo.wo_key}</span>
                              {woTypeLabel ? (
                                <>
                                  <span className="text-color-secondary" aria-hidden>
                                    ·
                                  </span>
                                  <span
                                    className="text-xs font-medium white-space-nowrap"
                                    style={
                                      woTypeColor ? { color: woTypeColor } : undefined
                                    }
                                  >
                                    {woTypeLabel}
                                  </span>
                                </>
                              ) : null}
                              <span className="text-color-secondary" aria-hidden>
                                ·
                              </span>
                              <span
                                className="text-xs font-medium white-space-nowrap"
                                style={{ color: statusColor }}
                              >
                                {WO_STATUS_I18N_KEYS[wo.status]
                                  ? t(WO_STATUS_I18N_KEYS[wo.status])
                                  : wo.status}
                              </span>
                            </div>
                            <div className="break-word white-space-normal">
                              {wo.short_text.trim() ? wo.short_text : '—'}
                            </div>
                            <div className="break-word white-space-normal">
                              {wo.asset_name.trim() ? wo.asset_name : '—'}
                            </div>
                          </div>
                        </td>
                        <td
                          className="p-0 align-middle border-bottom-1 surface-border relative"
                          style={{ height: 68, minHeight: 68 }}
                        >
                          <div
                            className={[
                              'relative w-full h-full flex cp-timeline',
                              ganttTimescale === 'day' ? 'cp-timeline--q15' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{ minHeight: 62 }}
                          >
                            {ganttTimescale === 'day'
                              ? QUARTER_SLOTS.map((q) => {
                                  const quarterKey = `quarter:${q}` as const
                                  return (
                                    <div
                                      key={q}
                                      className={[
                                        'cp-timeline-day flex-1 opacity-40 align-self-stretch min-h-full',
                                        woMoveDragActive ? 'app-viz-droppable-zone' : '',
                                        woMoveDragActive &&
                                        capacityDropHover === quarterKey
                                          ? 'app-viz-droppable-zone--over'
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      style={{ minWidth: CP_TIMELINE_SLOT_MIN_PX }}
                                      onDragEnter={(e) => {
                                        if (
                                          !dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)
                                        )
                                          return
                                        e.preventDefault()
                                        setCapacityDropHover(quarterKey)
                                      }}
                                      onDragLeave={(e) => {
                                        const rel = e.relatedTarget as Node | null
                                        if (rel && e.currentTarget.contains(rel)) return
                                        setCapacityDropHover((prev) =>
                                          prev === quarterKey ? null : prev,
                                        )
                                      }}
                                      onDragOver={(e) => {
                                        if (
                                          !dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)
                                        )
                                          return
                                        e.preventDefault()
                                        e.dataTransfer.dropEffect = 'move'
                                        setCapacityDropHover(quarterKey)
                                      }}
                                      onDrop={(e) => {
                                        const track = (
                                          e.currentTarget as HTMLElement
                                        ).parentElement
                                        if (!track?.classList.contains('cp-timeline'))
                                          return
                                        handleWoMoveDrop(e, track as HTMLElement)
                                      }}
                                    />
                                  )
                                })
                              : dateList.map((ymd) => {
                                  const dayKey = `day:${ymd}` as const
                                  return (
                                    <div
                                      key={ymd}
                                      className={[
                                        'cp-timeline-day flex-1 opacity-40 align-self-stretch min-h-full',
                                        woMoveDragActive ? 'app-viz-droppable-zone' : '',
                                        woMoveDragActive &&
                                        capacityDropHover === dayKey
                                          ? 'app-viz-droppable-zone--over'
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      style={{ minWidth: CP_DAY_COL_MIN_PX }}
                                      onDragEnter={(e) => {
                                        if (
                                          !dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)
                                        )
                                          return
                                        e.preventDefault()
                                        setCapacityDropHover(dayKey)
                                      }}
                                      onDragLeave={(e) => {
                                        const rel = e.relatedTarget as Node | null
                                        if (rel && e.currentTarget.contains(rel)) return
                                        setCapacityDropHover((prev) =>
                                          prev === dayKey ? null : prev,
                                        )
                                      }}
                                      onDragOver={(e) => {
                                        if (
                                          !dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)
                                        )
                                          return
                                        e.preventDefault()
                                        e.dataTransfer.dropEffect = 'move'
                                        setCapacityDropHover(dayKey)
                                      }}
                                      onDrop={(e) => {
                                        const track = (
                                          e.currentTarget as HTMLElement
                                        ).parentElement
                                        if (!track?.classList.contains('cp-timeline'))
                                          return
                                        handleWoMoveDrop(e, track as HTMLElement)
                                      }}
                                    />
                                  )
                                })}
                            {plannerNowMarkers.ganttLinePct !== null ? (
                              <div
                                className="cp-planner-now-line"
                                style={{ left: `${plannerNowMarkers.ganttLinePct}%` }}
                                aria-hidden
                              />
                            ) : null}
                            {layout ? (
                              <div
                                className={[
                                  'absolute cp-wo-pill app-viz-bar flex align-items-stretch overflow-hidden cursor-pointer',
                                  woBarCornerClip.clipStart ? 'cp-wo-pill--clip-start' : '',
                                  woBarCornerClip.clipEnd ? 'cp-wo-pill--clip-end' : '',
                                  shiftSlotDragActive ||
                                  (woMoveDragActive &&
                                    capacityDropHover === `wo:${wo.id}`)
                                    ? 'app-viz-droppable-zone'
                                    : '',
                                  capacityDropHover === `wo:${wo.id}` &&
                                  (shiftSlotDragActive || woMoveDragActive)
                                    ? 'app-viz-droppable-zone--over'
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                style={{
                                  left: `${layout.leftPct}%`,
                                  width: `${layout.widthPct}%`,
                                  top: 6,
                                  bottom: 6,
                                  minWidth: 8,
                                  zIndex: 1,
                                  ...visualizationBarCssVars(barBg),
                                }}
                                title={`${woGanttPillDescription(wo)} · ${
                                  woDayMoveLocked
                                    ? t('capacity_planner.day_timeline_wo_locked_tooltip')
                                    : woWeekMoveLocked
                                      ? t('capacity_planner.week_timeline_wo_locked_tooltip')
                                      : ganttIsDay
                                        ? t('capacity_planner.day_timeline_wo_move_tooltip')
                                        : t('capacity_planner.wo_move_tooltip')
                                }`}
                                onDragEnter={(e) => {
                                  if (
                                    dndTypesInclude(
                                      e.dataTransfer,
                                      SHIFT_SLOT_DRAG_MIME,
                                    ) ||
                                    dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)
                                  ) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setCapacityDropHover(`wo:${wo.id}`)
                                  }
                                }}
                                onDragLeave={(e) => {
                                  const rel = e.relatedTarget as Node | null
                                  if (rel && e.currentTarget.contains(rel)) return
                                  const idKey = `wo:${wo.id}`
                                  setCapacityDropHover((h) =>
                                    h === idKey ? null : h,
                                  )
                                }}
                                onDragOver={(e) => {
                                  if (dndTypesInclude(e.dataTransfer, SHIFT_SLOT_DRAG_MIME)) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    e.dataTransfer.dropEffect = 'copy'
                                    setCapacityDropHover(`wo:${wo.id}`)
                                  }
                                  if (dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    e.dataTransfer.dropEffect = 'move'
                                    const trackEl = (e.currentTarget as HTMLElement)
                                      .parentElement
                                    if (
                                      ganttIsDay &&
                                      ganttDayYmd &&
                                      trackEl?.classList.contains('cp-timeline')
                                    ) {
                                      const q = slotIndexFromClientX(
                                        e.clientX,
                                        trackEl as HTMLElement,
                                        DAY_SLOTS_15MIN,
                                      )
                                      setCapacityDropHover(`quarter:${q}`)
                                    } else {
                                      setCapacityDropHover(`wo:${wo.id}`)
                                    }
                                  }
                                }}
                                onDrop={(e) => {
                                  const track = (e.currentTarget as HTMLElement).parentElement
                                  if (!track) return
                                  if (dndTypesInclude(e.dataTransfer, SHIFT_SLOT_DRAG_MIME)) {
                                    handleShiftSlotDropOnWo(e, wo)
                                    return
                                  }
                                  if (dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)) {
                                    handleWoMoveDrop(e, track)
                                  }
                                }}
                                aria-label={
                                  woMoveDragLocked
                                    ? woGanttPillDescription(wo)
                                    : `${woGanttPillDescription(wo)}. ${t('capacity_planner.wo_move_aria')}`
                                }
                              >
                                {!woMoveDragLocked ? (
                                  <div
                                    className="cp-wo-pill-drag-handle app-viz-bar__handle flex-shrink-0 flex align-items-center justify-content-center cursor-grab"
                                    draggable
                                    title={`${woGanttPillDescription(wo)} · ${
                                      ganttIsDay
                                        ? t('capacity_planner.day_timeline_wo_move_tooltip')
                                        : t('capacity_planner.wo_move_tooltip')
                                    }`}
                                    onDragStart={(ev) => {
                                      ev.dataTransfer.setData(
                                        WO_MOVE_MIME,
                                        JSON.stringify({ workOrderId: wo.id }),
                                      )
                                      ev.dataTransfer.effectAllowed = 'move'
                                      setWoMoveDragActive(true)
                                    }}
                                    onDragEnd={() => {
                                      setWoMoveDragActive(false)
                                      setCapacityDropHover(null)
                                    }}
                                  >
                                    <i className="pi pi-ellipsis-v" aria-hidden />
                                  </div>
                                ) : null}
                                <div
                                  className="cp-wo-pill-body flex-1 min-w-0 min-h-0 relative"
                                  aria-hidden
                                />
                                {shiftAvailOverlays.map((seg, segIdx) => (
                                  <div
                                    key={segIdx}
                                    className="cp-wo-pill-shift-avail absolute top-0 bottom-0"
                                    style={{
                                      left: `${seg.leftPct}%`,
                                      width: `${seg.widthPct}%`,
                                      zIndex: 2,
                                    }}
                                    aria-hidden
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!loading && (snapshot?.work_orders?.length ?? 0) === 0 ? (
                <div className="cp-planner-empty p-5 text-center text-color-secondary text-sm border-top-1 surface-border">
                  {t('capacity_planner.empty_gantt')}
                </div>
              ) : null}
              </div>
            </Card>

            {ganttTimescale === 'week' ? (
            <Card
              title={t('capacity_planner.panel_capacity')}
              subTitle={t('capacity_planner.spc_hint', {
                pct: shiftPlanningCapacityPct,
              })}
              className="cp-planner-inner-card shadow-none border-none border-round-lg overflow-hidden surface-ground"
              pt={{
                title: { className: 'text-lg font-semibold mb-0' },
                subTitle: {
                  className: 'text-sm text-color-secondary line-height-3 mt-2 mb-0',
                },
                body: { className: 'p-0' },
              }}
            >
              <div
                ref={utilScrollRef}
                className="cp-planner-scroll overflow-auto border-top-1 surface-border"
                style={{ maxHeight: 'min(44vh, 480px)' }}
                onScroll={onUtilTableScroll}
              >
              <table className="cp-planner-table w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th
                      className="cp-planner-col-first text-left p-2 border-bottom-1 surface-border white-space-nowrap sticky left-0 bg-surface-ground"
                      style={{
                        width: CP_FIRST_COL_MIN_PX,
                        minWidth: CP_FIRST_COL_MIN_PX,
                      }}
                    >
                      {t('capacity_planner.col_employee')}
                    </th>
                    {dateList.map((ymd) => (
                      <th
                        key={ymd}
                        className="p-2 border-bottom-1 border-left-1 surface-border text-center white-space-nowrap relative"
                        style={{ minWidth: CP_DAY_COL_MIN_PX }}
                      >
                        {formatDate(parseLocalYmdToDate(ymd).toISOString())}
                        {plannerNowMarkers.employeeColLinePct !== null &&
                        ymd === plannerNowMarkers.todayYmd ? (
                          <div
                            className="cp-planner-now-line"
                            style={{ left: `${plannerNowMarkers.employeeColLinePct}%` }}
                            aria-hidden
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employeesInRange.map((emp) => (
                    <tr key={emp.id}>
                      <td
                        className="cp-planner-col-first p-2 border-bottom-1 surface-border font-medium sticky left-0 bg-surface-ground"
                        style={{
                          width: CP_FIRST_COL_MIN_PX,
                          minWidth: CP_FIRST_COL_MIN_PX,
                        }}
                      >
                        {emp.name}{' '}
                        <span className="text-color-secondary font-normal">
                          ({emp.key})
                        </span>
                      </td>
                      {dateList.map((ymd) => {
                            const cap = capForCell(emp.id, ymd)
                            const planned = usedForCell(emp.id, ymd)
                            const hasShiftCapacity = cap > 1e-6
                            const util = utilizationClass(cap, planned)
                            const utilClass =
                              util === 'low'
                                ? 'capacity-planner-util--low'
                                : util === 'mid'
                                  ? 'capacity-planner-util--mid'
                                  : util === 'high'
                                    ? 'capacity-planner-util--high'
                                    : ''
                            const cellShiftAssignments = (
                              snapshot?.shift_assignments ?? []
                            ).filter(
                              (a) =>
                                a.employee_id === emp.id &&
                                a.assignment_date === ymd,
                            )
                            const shiftTimesSummary = cellShiftAssignments
                              .map((a) => `${a.time_start}–${a.time_end}`)
                              .join(' · ')
                            return (
                              <td
                                key={ymd}
                                className={`p-1 border-bottom-1 border-left-1 surface-border text-center align-middle relative${hasShiftCapacity ? ' cp-shift-slot-drag-source cursor-grab' : ''}`}
                                style={{
                                  minWidth: CP_DAY_COL_MIN_PX,
                                  minHeight: hasShiftCapacity ? 44 : undefined,
                                }}
                                draggable={hasShiftCapacity}
                                onDragStart={
                                  hasShiftCapacity
                                    ? (e) => {
                                        e.dataTransfer.setData(
                                          SHIFT_SLOT_DRAG_MIME,
                                          JSON.stringify({
                                            employeeId: emp.id,
                                            employeeName: emp.name,
                                            allocationDate: ymd,
                                          }),
                                        )
                                        e.dataTransfer.effectAllowed = 'copy'
                                        setShiftSlotDragActive(true)
                                      }
                                    : undefined
                                }
                                onDragEnd={
                                  hasShiftCapacity
                                    ? () => {
                                        setShiftSlotDragActive(false)
                                        setCapacityDropHover(null)
                                      }
                                    : undefined
                                }
                                onDoubleClick={
                                  hasShiftCapacity
                                    ? (e) => {
                                        e.stopPropagation()
                                        navigate(
                                          `/shift-planner?detailed=${encodeURIComponent(ymd)}`,
                                        )
                                      }
                                    : undefined
                                }
                                title={
                                  hasShiftCapacity && shiftTimesSummary.length > 0
                                    ? shiftTimesSummary
                                    : undefined
                                }
                              >
                                {plannerNowMarkers.employeeColLinePct !== null &&
                                ymd === plannerNowMarkers.todayYmd ? (
                                  <div
                                    className="cp-planner-now-line"
                                    style={{ left: `${plannerNowMarkers.employeeColLinePct}%` }}
                                    aria-hidden
                                  />
                                ) : null}
                                {!hasShiftCapacity ? (
                                  <span className="text-color-secondary">—</span>
                                ) : (
                                  <div className="cp-capacity-cell-track">
                                    <div
                                      className="cp-capacity-shift-rows"
                                      aria-hidden
                                    >
                                      {(snapshot?.shift_assignments ?? [])
                                        .filter(
                                          (a) =>
                                            a.employee_id === emp.id &&
                                            a.assignment_date === ymd,
                                        )
                                        .map((a) => {
                                          const { leftPct, widthPct } =
                                            shiftFirstSegmentLayoutPct(
                                              a.time_start,
                                              a.time_end,
                                            )
                                          return (
                                            <div
                                              key={a.id}
                                              className="cp-capacity-shift-row"
                                            >
                                              <div
                                                className="cp-capacity-shift-bar"
                                                style={{
                                                  left: `${leftPct}%`,
                                                  width: `${Math.max(widthPct, 0.35)}%`,
                                                  ...visualizationBarCssVars(
                                                    'var(--surface-400)',
                                                  ),
                                                }}
                                              />
                                            </div>
                                          )
                                        })}
                                    </div>
                                    <div
                                      className={`cp-capacity-cell-label capacity-planner-util text-sm ${utilClass}`.trim()}
                                    >
                                      {t('capacity_planner.cell_planned_total', {
                                        planned: planned.toFixed(2),
                                        total: cap.toFixed(2),
                                      })}
                                    </div>
                                  </div>
                                )}
                              </td>
                            )
                          })}
                    </tr>
                  ))}
                  {employeesInRange.length > 0 ? (
                    <tr className="cp-planner-util-sum-row">
                      <td
                        className="cp-planner-col-first p-2 border-bottom-1 surface-border font-semibold sticky left-0 bg-surface-ground border-top-2"
                        style={{
                          width: CP_FIRST_COL_MIN_PX,
                          minWidth: CP_FIRST_COL_MIN_PX,
                        }}
                      >
                        {t('capacity_planner.row_sum_label')}
                      </td>
                      {dateList.map((ymd, idx) => {
                            const { cap, planned } = capacityGridColumnTotals[idx]!
                            const hasShiftCapacity = cap > 1e-6
                            const util = utilizationClass(cap, planned)
                            const utilClass =
                              util === 'low'
                                ? 'capacity-planner-util--low'
                                : util === 'mid'
                                  ? 'capacity-planner-util--mid'
                                  : util === 'high'
                                    ? 'capacity-planner-util--high'
                                    : ''
                            return (
                              <td
                                key={ymd}
                                className={`p-1 border-bottom-1 border-left-1 surface-border text-center align-middle border-top-2 relative${hasShiftCapacity ? ' cursor-pointer' : ''}`}
                                style={{
                                  minWidth: CP_DAY_COL_MIN_PX,
                                  minHeight: hasShiftCapacity ? 44 : undefined,
                                }}
                                onDoubleClick={
                                  hasShiftCapacity
                                    ? (e) => {
                                        e.stopPropagation()
                                        navigate(
                                          `/shift-planner?detailed=${encodeURIComponent(ymd)}`,
                                        )
                                      }
                                    : undefined
                                }
                                title={
                                  hasShiftCapacity
                                    ? t('capacity_planner.shift_cell_open_shift_planner')
                                    : undefined
                                }
                              >
                                {plannerNowMarkers.employeeColLinePct !== null &&
                                ymd === plannerNowMarkers.todayYmd ? (
                                  <div
                                    className="cp-planner-now-line"
                                    style={{ left: `${plannerNowMarkers.employeeColLinePct}%` }}
                                    aria-hidden
                                  />
                                ) : null}
                                {!hasShiftCapacity ? (
                                  <span className="text-color-secondary">—</span>
                                ) : (
                                  <div className="cp-capacity-cell-track cp-capacity-cell-track--sum">
                                    <div
                                      className={`cp-capacity-cell-label cp-capacity-cell-label--sum capacity-planner-util text-sm font-semibold ${utilClass}`.trim()}
                                    >
                                      {t('capacity_planner.cell_planned_total', {
                                        planned: planned.toFixed(2),
                                        total: cap.toFixed(2),
                                      })}
                                    </div>
                                  </div>
                                )}
                              </td>
                            )
                          })}
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {!loading && employeesInRange.length === 0 ? (
                <div className="cp-planner-empty p-5 text-center text-color-secondary text-sm border-top-1 surface-border">
                  {t('capacity_planner.empty_capacity')}
                </div>
              ) : null}
              </div>
            </Card>
            ) : null}
          </div>
        </Card>
      </div>

      <AppCrudDialog
        title={t('capacity_planner.modal_title')}
        visible={Boolean(modalCtx)}
        dismissableMask={!modalSaving}
        onHide={() => !modalSaving && setModalCtx(null)}
        style={{ width: 'min(520px, 95vw)' }}
        footer={
          <div className="flex flex-wrap gap-2 justify-content-end">
            <Button
              type="button"
              label={t('capacity_planner.modal_clear')}
              severity="secondary"
              text
              disabled={modalSaving}
              onClick={() => void clearAllocation()}
            />
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              disabled={modalSaving}
              onClick={() => setModalCtx(null)}
            />
            <Button
              type="button"
              label={t('common.save')}
              loading={modalSaving}
              disabled={modalHours === null || modalHours < 0}
              onClick={() => void saveModal()}
            />
          </div>
        }
      >
        {modalCtx ? (
          <div className="flex flex-column gap-3">
            <Card
              title={t('capacity_planner.modal_wo_section')}
              className="shadow-none border-1 surface-border border-round-lg surface-section"
              pt={{
                title: { className: 'text-base font-semibold mb-0' },
                body: { className: 'pt-2' },
              }}
            >
              <div className="text-sm line-height-3">
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_wo_key')}:
                  </span>{' '}
                  #{modalCtx.workOrder.wo_key}
                </div>
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_wo_text')}:
                  </span>{' '}
                  {modalCtx.workOrder.short_text}
                </div>
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_wo_status')}:
                  </span>{' '}
                  {modalCtx.workOrder.status}
                </div>
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_wo_plan')}:
                  </span>{' '}
                  {modalCtx.workOrder.plan_start
                    ? formatDateTime(modalCtx.workOrder.plan_start)
                    : '—'}{' '}
                  →{' '}
                  {modalCtx.workOrder.plan_end
                    ? formatDateTime(modalCtx.workOrder.plan_end)
                    : '—'}
                </div>
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_wo_duration')}:
                  </span>{' '}
                  {modalCtx.workOrder.planned_duration} h
                </div>
              </div>
            </Card>
            <Card
              title={t('capacity_planner.modal_shift_section')}
              className="shadow-none border-1 surface-border border-round-lg surface-section"
              pt={{
                title: { className: 'text-base font-semibold mb-0' },
                body: { className: 'pt-2' },
              }}
            >
              <div className="text-sm line-height-3">
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_employee')}:
                  </span>{' '}
                  {modalCtx.employeeName}
                </div>
                <div>
                  <span className="text-color-secondary">
                    {t('capacity_planner.modal_date')}:
                  </span>{' '}
                  {formatDate(parseLocalYmdToDate(modalCtx.allocationDate).toISOString())}
                </div>
                {modalCtx.assignments.map((a) => (
                  <div key={a.id}>
                    {a.shift_name} ({a.shift_key}): {a.time_start}–{a.time_end}
                    {isOvernightShift(a.time_start, a.time_end)
                      ? ` (${t('capacity_planner.overnight')})`
                      : ''}
                  </div>
                ))}
              </div>
            </Card>
            <Card
              title={t('capacity_planner.modal_planned_hours')}
              className="shadow-none border-1 surface-border border-round-lg surface-section"
              pt={{
                title: { className: 'text-base font-semibold mb-0' },
                body: { className: 'pt-2' },
              }}
            >
              <div className="flex flex-column gap-2">
                <InputNumber
                  inputId="cp-planned-hours"
                  value={modalHours}
                  onValueChange={(e) =>
                    setModalHours(
                      e.value === null || e.value === undefined ? null : e.value,
                    )
                  }
                  min={0}
                  max={modalMaxHours}
                  minFractionDigits={0}
                  maxFractionDigits={2}
                  step={0.25}
                  className="w-full"
                  disabled={modalSaving}
                />
                <span className="text-xs text-color-secondary">
                  {plannedHoursRestriction
                    ? t('capacity_planner.modal_hours_max', {
                        max: modalMaxHours.toFixed(2),
                      })
                    : t('capacity_planner.modal_hours_max_no_bucket')}
                </span>
              </div>
            </Card>
          </div>
        ) : null}
      </AppCrudDialog>
    </AppShell>
  )
}
