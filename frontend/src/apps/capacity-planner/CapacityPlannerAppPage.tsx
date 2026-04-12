/**
 * Capacity Planner: Gantt-style planned WOs + utilization grid.
 * DnD: move WO on timeline; drag a shift-day utilization cell onto a WO bar to assign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
import { Dialog } from 'primereact/dialog'
import { InputNumber } from 'primereact/inputnumber'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import { formatDate, formatDateTime } from '../../utils/dateTime'
import { primeDateFormatForDtf } from '../../utils/dateTimeFormatPreference'

const WO_MOVE_MIME = 'application/x-sombra-capacity-wo-move+json'
/** Employee + calendar day of the dragged utilization cell (shift capacity bucket). */
const SHIFT_SLOT_DRAG_MIME = 'application/x-sombra-capacity-shift-slot+json'

/** Gantt + utilization tables share these so day columns and label columns line up. */
const CP_FIRST_COL_MIN_PX = 220
const CP_DAY_COL_MIN_PX = 120
/** When PHR is off, InputNumber max if work order has no positive duration. */
const CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED = 9999

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

/** Keep UTC time-of-day; place on target calendar day (UTC date parts). */
function planStartOnCalendarDay(planStartIso: string, targetYmd: string): Date {
  const o = new Date(planStartIso)
  const [y, m, d] = targetYmd.split('-').map(Number)
  return new Date(
    Date.UTC(
      y,
      m - 1,
      d,
      o.getUTCHours(),
      o.getUTCMinutes(),
      o.getUTCSeconds(),
      o.getUTCMilliseconds(),
    ),
  )
}

function dndTypesInclude(dt: DataTransfer, mime: string): boolean {
  return Array.from(dt.types ?? []).includes(mime)
}

/** Six-dot perforated grip (drag affordance). */
function WoPerforatedGrip() {
  return (
    <span className="cp-wo-grip flex align-items-center justify-content-center flex-shrink-0">
      <svg
        width={10}
        height={18}
        viewBox="0 0 10 18"
        fill="currentColor"
        className="text-color-secondary"
        aria-hidden
      >
        <circle cx="2.5" cy="3" r="1.25" />
        <circle cx="7.5" cy="3" r="1.25" />
        <circle cx="2.5" cy="9" r="1.25" />
        <circle cx="7.5" cy="9" r="1.25" />
        <circle cx="2.5" cy="15" r="1.25" />
        <circle cx="7.5" cy="15" r="1.25" />
      </svg>
    </span>
  )
}

type SnapshotWorkOrder = {
  id: string
  wo_key: number
  short_text: string
  plan_start: string | null
  plan_end: string | null
  duration: string
  status: string
  workgroup_id: string
  asset_key: string
  asset_name: string
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

function toUtcYmd(iso: string): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const psY = toUtcYmd(wo.plan_start)
  const peY = toUtcYmd(wo.plan_end)
  const n = dateList.length
  let i0 = dateList.findIndex((d) => d >= psY)
  if (i0 < 0) return null
  let i1 = -1
  for (let i = 0; i < n; i += 1) {
    if (dateList[i]! <= peY) i1 = i
  }
  if (i1 < i0) return null
  const leftPct = (i0 / n) * 100
  const widthPct = ((i1 - i0 + 1) / n) * 100
  return { leftPct, widthPct }
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

  const dateList = useMemo(
    () => enumerateDates(rangeFrom, rangeTo),
    [rangeFrom, rangeTo],
  )

  const plannerCalendarDateFormat = useMemo(
    () => primeDateFormatForDtf(dtf),
    [dtf],
  )

  const loadSnapshot = useCallback(async () => {
    const df = toYmd(rangeFrom)
    const dt = toYmd(rangeTo)
    if (df > dt) {
      setLoadError(t('capacity_planner.range_invalid'))
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiJson<SnapshotResponse>(
        `/api/capacity-planner/snapshot?date_from=${encodeURIComponent(df)}&date_to=${encodeURIComponent(dt)}`,
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
  }, [rangeFrom, rangeTo, t])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

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

  function openAssignModal(
    wo: SnapshotWorkOrder,
    employeeId: string,
    employeeName: string,
    allocationDate: string,
  ) {
    const assigns = (snapshot?.shift_assignments ?? []).filter(
      (a) => a.employee_id === employeeId && a.assignment_date === allocationDate,
    )
    if (assigns.length === 0) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.drop_no_shift'),
        life: 4500,
      })
      return
    }
    const cap = capForCell(employeeId, allocationDate)
    const used = usedForCell(employeeId, allocationDate)
    const existing = (snapshot?.capacity_allocations ?? []).find(
      (c) =>
        c.work_order_id === wo.id &&
        c.employee_id === employeeId &&
        c.allocation_date === allocationDate,
    )
    const dur = Number(wo.duration)
    const maxFromWo = Number.isFinite(dur) ? dur : cap
    const remaining = Math.max(
      0,
      roundPlannedHours(cap - used + (existing?.planned_hours ?? 0)),
    )
    const woDurCap =
      Number.isFinite(dur) && dur > 0
        ? dur
        : CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED
    const def = plannedHoursRestriction
      ? Math.min(
          maxFromWo > 0 ? maxFromWo : remaining,
          remaining,
          Math.max(0.25, remaining),
        )
      : Math.min(woDurCap, 0.25)
    setModalCtx({
      workOrder: wo,
      employeeId,
      employeeName,
      allocationDate,
      assignments: assigns,
    })
    setModalHours(
      existing ? Math.round(existing.planned_hours * 100) / 100 : Math.round(def * 100) / 100,
    )
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

  async function patchPlanStart(wo: SnapshotWorkOrder, newStart: Date) {
    const now = Date.now()
    if (newStart.getTime() < now) {
      toast.current?.show({
        severity: 'warn',
        summary: t('capacity_planner.no_past_plan'),
        life: 4000,
      })
      return
    }
    try {
      await apiJson(`/api/work-orders/${encodeURIComponent(wo.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ plan_start: newStart.toISOString() }),
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
    if (!wo?.plan_start || dateList.length === 0) return
    const idx = dayIndexFromClientX(e.clientX, trackEl, dateList.length)
    const targetYmd = dateList[idx]!
    const newStart = planStartOnCalendarDay(wo.plan_start, targetYmd)
    const clamped = new Date(Math.max(newStart.getTime(), Date.now()))
    if (clamped.getTime() === new Date(wo.plan_start).getTime()) return
    void patchPlanStart(wo, clamped)
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
    openAssignModal(wo, employeeId, employeeName, allocationDate)
  }

  const modalMaxHours = useMemo(() => {
    if (!modalCtx || !snapshot) return 99
    const dur = Number(modalCtx.workOrder.duration)
    const woOnlyCap =
      Number.isFinite(dur) && dur > 0
        ? roundPlannedHours(dur)
        : CP_PLANNED_HOURS_INPUT_MAX_UNRESTRICTED
    if (!plannedHoursRestriction) {
      return Math.max(0, woOnlyCap)
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
    const woCap =
      Number.isFinite(dur) && dur > 0 ? roundPlannedHours(dur) : remaining
    return Math.max(0, Math.min(remaining, woCap))
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
            <Button
              type="button"
              label={t('capacity_planner.reload')}
              icon="pi pi-refresh"
              onClick={() => void loadSnapshot()}
              loading={loading}
            />
          </div>

          <div className="flex flex-column gap-3">
            <Card
              title={t('capacity_planner.panel_gantt')}
              className="shadow-none border-1 surface-border border-round-lg overflow-hidden surface-ground"
              pt={{
                title: { className: 'text-lg font-semibold mb-0' },
                body: { className: 'p-0' },
              }}
            >
              <div
                className="overflow-auto border-top-1 surface-border"
                style={{ maxHeight: 'min(48vh, 520px)' }}
              >
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th
                      className="text-left p-2 border-bottom-1 surface-border white-space-nowrap"
                      style={{
                        width: CP_FIRST_COL_MIN_PX,
                        minWidth: CP_FIRST_COL_MIN_PX,
                      }}
                    >
                      {t('capacity_planner.col_work_order')}
                    </th>
                    <th className="p-0 border-bottom-1 surface-border">
                      <div className="flex w-full">
                        {dateList.map((ymd) => (
                          <div
                            key={ymd}
                            className="flex-1 text-center text-xs text-color-secondary border-left-1 surface-border py-2"
                            style={{ minWidth: CP_DAY_COL_MIN_PX }}
                          >
                            {formatDate(`${ymd}T12:00:00.000Z`)}
                          </div>
                        ))}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.work_orders ?? []).map((wo) => {
                    const layout = barLayout(wo, dateList)
                    const bg = wo.work_type_colour?.trim()
                      ? wo.work_type_colour
                      : 'var(--primary-color)'
                    return (
                      <tr key={wo.id}>
                        <td
                          className="p-2 align-top border-bottom-1 surface-border"
                          style={{
                            width: CP_FIRST_COL_MIN_PX,
                            minWidth: CP_FIRST_COL_MIN_PX,
                          }}
                        >
                          <div className="font-medium">
                            #{wo.wo_key}{' '}
                            <span className="font-normal">{wo.short_text}</span>
                          </div>
                          <div className="text-xs text-color-secondary">
                            {wo.asset_key} — {wo.asset_name}
                          </div>
                        </td>
                        <td
                          className="p-0 align-middle border-bottom-1 surface-border relative"
                          style={{ height: 58, minHeight: 58 }}
                        >
                          <div
                            className={`relative w-full h-full flex cp-timeline${woMoveDragActive ? ' cp-timeline--wo-move-active' : ''}`}
                            style={{ minHeight: 54 }}
                            onDragOver={(e) => {
                              if (dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)) {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                              }
                            }}
                            onDrop={(e) => handleWoMoveDrop(e, e.currentTarget as HTMLElement)}
                          >
                            {dateList.map((ymd) => (
                              <div
                                key={ymd}
                                className="flex-1 border-left-1 surface-border opacity-40"
                                style={{ minWidth: CP_DAY_COL_MIN_PX }}
                              />
                            ))}
                            {layout ? (
                              <div
                                className="absolute border-round-md flex align-items-stretch overflow-hidden shadow-1 cp-wo-pill cursor-grab"
                                style={{
                                  left: `${layout.leftPct}%`,
                                  width: `${layout.widthPct}%`,
                                  top: 6,
                                  bottom: 6,
                                  minWidth: 8,
                                  background: `color-mix(in srgb, ${bg} 55%, var(--surface-card))`,
                                  border: `1px solid color-mix(in srgb, ${bg} 70%, var(--surface-border))`,
                                  zIndex: 1,
                                }}
                                title={t('capacity_planner.wo_move_tooltip')}
                                draggable
                                onDragStart={(ev) => {
                                  ev.dataTransfer.setData(
                                    WO_MOVE_MIME,
                                    JSON.stringify({ workOrderId: wo.id }),
                                  )
                                  ev.dataTransfer.effectAllowed = 'move'
                                  setWoMoveDragActive(true)
                                }}
                                onDragEnd={() => setWoMoveDragActive(false)}
                                onDragOver={(e) => {
                                  if (dndTypesInclude(e.dataTransfer, SHIFT_SLOT_DRAG_MIME)) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    e.dataTransfer.dropEffect = 'copy'
                                  }
                                  if (dndTypesInclude(e.dataTransfer, WO_MOVE_MIME)) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    e.dataTransfer.dropEffect = 'move'
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
                                aria-label={t('capacity_planner.wo_move_aria')}
                              >
                                <div className="flex-shrink-0 surface-100 border-right-1 surface-border flex align-items-center justify-content-center">
                                  <WoPerforatedGrip />
                                </div>
                                <div className="flex-1 min-w-0" aria-hidden />
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
                <div className="p-5 text-center text-color-secondary text-sm border-top-1 surface-border">
                  {t('capacity_planner.empty_gantt')}
                </div>
              ) : null}
              </div>
            </Card>

            <Card
              title={t('capacity_planner.panel_capacity')}
              subTitle={t('capacity_planner.spc_hint', {
                pct: shiftPlanningCapacityPct,
              })}
              className="shadow-none border-1 surface-border border-round-lg overflow-hidden surface-ground"
              pt={{
                title: { className: 'text-lg font-semibold mb-0' },
                subTitle: {
                  className: 'text-sm text-color-secondary line-height-3 mt-2 mb-0',
                },
                body: { className: 'p-0' },
              }}
            >
              <div
                className="overflow-auto border-top-1 surface-border"
                style={{ maxHeight: 'min(44vh, 480px)' }}
              >
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th
                      className="text-left p-2 border-bottom-1 surface-border white-space-nowrap sticky left-0 bg-surface-ground z-1"
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
                        className="p-2 border-bottom-1 surface-border text-center white-space-nowrap"
                        style={{ minWidth: CP_DAY_COL_MIN_PX }}
                      >
                        {formatDate(`${ymd}T12:00:00.000Z`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employeesInRange.map((emp) => (
                    <tr key={emp.id}>
                      <td
                        className="p-2 border-bottom-1 surface-border font-medium sticky left-0 bg-surface-ground z-1"
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
                        return (
                          <td
                            key={ymd}
                            className={`p-2 border-bottom-1 surface-border text-center align-middle${hasShiftCapacity ? ' cp-shift-slot-drag-source cursor-grab' : ''}`}
                            style={{ minWidth: CP_DAY_COL_MIN_PX }}
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
                                  }
                                : undefined
                            }
                            title={
                              hasShiftCapacity
                                ? t('capacity_planner.shift_slot_drag_hint')
                                : undefined
                            }
                          >
                            {!hasShiftCapacity ? (
                              <span className="text-color-secondary">—</span>
                            ) : (
                              <span
                                className={`capacity-planner-util text-sm ${utilClass}`.trim()}
                              >
                                {t('capacity_planner.cell_planned_total', {
                                  planned: planned.toFixed(2),
                                  total: cap.toFixed(2),
                                })}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && employeesInRange.length === 0 ? (
                <div className="p-5 text-center text-color-secondary text-sm border-top-1 surface-border">
                  {t('capacity_planner.empty_capacity')}
                </div>
              ) : null}
              </div>
            </Card>
          </div>
        </Card>
      </div>

      <Dialog
        header={t('capacity_planner.modal_title')}
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
                  {modalCtx.workOrder.duration} h
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
                  {formatDate(`${modalCtx.allocationDate}T12:00:00.000Z`)}
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
      </Dialog>
    </AppShell>
  )
}
