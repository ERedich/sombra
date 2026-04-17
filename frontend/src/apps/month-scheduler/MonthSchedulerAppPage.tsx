import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { ProgressSpinner } from 'primereact/progressspinner'
import { OverlayPanel } from 'primereact/overlaypanel'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser, getToken } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import { useWorkOrderMw } from '../../layout/WorkOrderMwProvider'
import { AppVizBarLegend } from '../../components/visualization/AppVizBarLegend'
import { contrastTextOnHex } from '../../utils/contrastTextOnHex'
import { visualizationBarCssVars } from '../../utils/visualizationBarStyle'
import type { WorkOrder } from '../work-orders/workOrderTypes'
import {
  buildMonthWeeks,
  daysInMonth,
  layoutWeek,
  MONTH_SCHEDULER_LAYOUT,
  toYmd,
  weekdayShortLabels,
  weekRowHeight,
} from './calendarGrid'
import { localCalendarEventToScheduler } from './localSchedulerEvent'
import {
  loadEventsForSite,
  persistEventsForSite,
} from './monthSchedulerStorage'
import {
  EVENT_TYPE_STYLES,
  type CalendarEvent,
  type EventTypeId,
  type SchedulerEvent,
} from './types'
import {
  spanOverlapsRange,
  workOrderToSchedulerEvent,
} from './workOrderCalendar'
import {
  MCAL_WO_DRAG_MIME,
  addDaysToIsoInstant,
  diffYmdDays,
  parseMcalWoDragPayload,
} from './workOrderPlanDrag'
import './MonthSchedulerApp.css'

const { LANE_H, LANE_GAP, TOP_PAD } = MONTH_SCHEDULER_LAYOUT

const fieldLabelClass =
  'block text-sm font-semibold text-color-secondary mb-2 uppercase letter-spacing-1'

export default function MonthSchedulerAppPage() {
  const { t, i18n } = useTranslation()
  const { fdw } = useAppParameters()
  const { openEditWorkOrderMw, subscribeWorkOrderMwEvents } = useWorkOrderMw()
  const toast = useRef<Toast>(null)
  const woPopoverRef = useRef<OverlayPanel>(null)
  const woPopoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const woPopoverShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const woPopoverPendingRef = useRef<{
    wo: WorkOrder
    target: HTMLElement
  } | null>(null)
  const [woPopoverWo, setWoPopoverWo] = useState<WorkOrder | null>(null)

  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [form, setForm] = useState({
    title: '',
    start: '',
    end: '',
    type: 'work' as EventTypeId,
  })

  const [workingSiteId, setWorkingSiteId] = useState<string | null>(() =>
    getStoredUser()?.working_site_id ?? null,
  )
  const [storageHydrated, setStorageHydrated] = useState(false)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [woListLoading, setWoListLoading] = useState(false)
  const [woLockEndByDuration, setWoLockEndByDuration] = useState(false)
  const [dropHighlightYmd, setDropHighlightYmd] = useState<string | null>(null)
  /** After a native drag, some browsers still emit `click` on the bar — skip WO navigation. */
  const skipNextWoBarClickRef = useRef(false)
  const woBarDragStartedRef = useRef(false)

  const syncSiteAndReload = useCallback(() => {
    const ws = getStoredUser()?.working_site_id ?? null
    setWorkingSiteId(ws)
    setStorageHydrated(false)
    if (!ws) {
      setEvents([])
      setStorageHydrated(true)
      return
    }
    setEvents(loadEventsForSite(ws))
    setStorageHydrated(true)
  }, [])

  useEffect(() => {
    syncSiteAndReload()
    const onFocus = () => syncSiteAndReload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [syncSiteAndReload])

  useEffect(() => {
    if (!storageHydrated || !workingSiteId) return
    persistEventsForSite(workingSiteId, events)
  }, [storageHydrated, workingSiteId, events])

  useEffect(() => {
    if (!workingSiteId) {
      setWorkOrders([])
      return
    }
    let cancelled = false
    setWoListLoading(true)
    setWorkOrders([])
    void (async () => {
      try {
        const data = await apiJson<{ work_orders: WorkOrder[] }>(
          '/api/work-orders',
        )
        if (cancelled) return
        const list = data.work_orders ?? []
        setWorkOrders(list.filter((w) => w.site_id === workingSiteId))
      } catch (e) {
        if (cancelled) return
        setWorkOrders([])
        const detail =
          e instanceof ApiError ? e.message : t('mcal.wo_load_fail')
        toast.current?.show({
          severity: 'error',
          summary: t('common.toast_error'),
          detail,
          life: 5000,
        })
      } finally {
        if (!cancelled) setWoListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workingSiteId, t])

  const reloadWorkOrdersSilent = useCallback(async () => {
    const ws = workingSiteId
    if (!ws || !getToken()) return
    try {
      const data = await apiJson<{ work_orders: WorkOrder[] }>(
        '/api/work-orders',
      )
      setWorkOrders((data.work_orders ?? []).filter((w) => w.site_id === ws))
    } catch {
      /* keep list on silent refresh */
    }
  }, [workingSiteId])

  useEffect(
    () =>
      subscribeWorkOrderMwEvents((ev) => {
        if (
          ev.type === 'merged_row' ||
          ev.type === 'created_row' ||
          ev.type === 'silent_list_refresh'
        ) {
          void reloadWorkOrdersSilent()
        }
      }),
    [subscribeWorkOrderMwEvents, reloadWorkOrdersSilent],
  )

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<{
          wo?: { lock_end_date_by_duration?: boolean }
        }>('/api/app-parameters')
        if (!cancelled) {
          setWoLockEndByDuration(
            data.wo?.lock_end_date_by_duration === true,
          )
        }
      } catch {
        if (!cancelled) setWoLockEndByDuration(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const clear = () => setDropHighlightYmd(null)
    window.addEventListener('dragend', clear)
    return () => window.removeEventListener('dragend', clear)
  }, [])

  const cancelWoPopoverHide = useCallback(() => {
    if (woPopoverHideTimer.current != null) {
      window.clearTimeout(woPopoverHideTimer.current)
      woPopoverHideTimer.current = null
    }
  }, [])

  const cancelWoPopoverShow = useCallback(() => {
    if (woPopoverShowTimer.current != null) {
      window.clearTimeout(woPopoverShowTimer.current)
      woPopoverShowTimer.current = null
    }
    woPopoverPendingRef.current = null
  }, [])

  useEffect(
    () => () => {
      cancelWoPopoverHide()
      cancelWoPopoverShow()
    },
    [cancelWoPopoverHide, cancelWoPopoverShow],
  )

  const weeks = useMemo(
    () => buildMonthWeeks(year, month, fdw),
    [year, month, fdw],
  )

  /** Include leading/trailing grid days (adjacent months) so bars show on preview cells. */
  const gridVisibleYmdRange = useMemo(() => {
    if (!weeks.length) {
      return {
        rangeStart: toYmd(year, month, 1),
        rangeEnd: toYmd(year, month, daysInMonth(year, month)),
      }
    }
    const lastRow = weeks[weeks.length - 1]
    return {
      rangeStart: weeks[0][0].dateStr,
      rangeEnd: lastRow[lastRow.length - 1].dateStr,
    }
  }, [weeks, year, month])

  const mergedSchedulerEvents = useMemo((): SchedulerEvent[] => {
    const { rangeStart, rangeEnd } = gridVisibleYmdRange
    const fromWo = workOrders
      .map(workOrderToSchedulerEvent)
      .filter((e): e is SchedulerEvent => e != null)
      .filter((e) =>
        spanOverlapsRange(e.start, e.end, rangeStart, rangeEnd),
      )
    const fromLocal = events
      .map(localCalendarEventToScheduler)
      .filter((e) =>
        spanOverlapsRange(e.start, e.end, rangeStart, rangeEnd),
      )
    return [...fromWo, ...fromLocal]
  }, [workOrders, events, gridVisibleYmdRange])

  /** Distinct work types from loaded WOs — bar colours match `work_type_colour`. */
  const woTypeLegend = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; label: string; color: string }
    >()
    for (const wo of workOrders) {
      const id = wo.work_type_id?.trim()
      if (!id) continue
      const color =
        typeof wo.work_type_colour === 'string' &&
        wo.work_type_colour.trim() !== ''
          ? wo.work_type_colour.trim()
          : '#64748b'
      const label =
        wo.work_type_name?.trim() ||
        wo.work_type_key?.trim() ||
        id.slice(0, 8)
      if (!byId.has(id)) byId.set(id, { id, label, color })
    }
    return [...byId.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    )
  }, [workOrders])

  const todayStr = useMemo(
    () => toYmd(today.getFullYear(), today.getMonth(), today.getDate()),
    [today],
  )

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'long',
        year: 'numeric',
      }).format(new Date(year, month, 1)),
    [i18n.language, year, month],
  )

  const weekdayLabels = useMemo(
    () => weekdayShortLabels(i18n.language, fdw),
    [i18n.language, fdw],
  )

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1)
      setMonth(11)
    } else {
      setMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1)
      setMonth(0)
    } else {
      setMonth((m) => m + 1)
    }
  }

  const showError = useCallback((detail: string) => {
    toast.current?.show({
      severity: 'error',
      summary: t('common.toast_error'),
      detail,
      life: 5000,
    })
  }, [t])

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

  const applyWoPlanMove = useCallback(
    async (woId: string, dropYmd: string) => {
      const wo = workOrders.find((w) => w.id === woId)
      if (!wo?.plan_start) return
      const span = workOrderToSchedulerEvent(wo)
      if (!span) return
      const delta = diffYmdDays(dropYmd, span.start)
      if (delta === 0) return

      const newStartIso = addDaysToIsoInstant(wo.plan_start, delta)
      const newEndIso = wo.plan_end
        ? addDaysToIsoInstant(wo.plan_end, delta)
        : newStartIso

      const body: Record<string, unknown> = { plan_start: newStartIso }
      if (!woLockEndByDuration) {
        body.plan_end = newEndIso
      }

      try {
        const data = await apiJson<{ work_order: WorkOrder }>(
          `/api/work-orders/${encodeURIComponent(woId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setWorkOrders((list) =>
          list.map((w) => (w.id === woId ? data.work_order : w)),
        )
        showSuccess(t('mcal.dnd_wo_moved'))
      } catch (e) {
        showError(
          e instanceof ApiError ? e.message : t('mcal.dnd_wo_failed'),
        )
      }
    },
    [workOrders, woLockEndByDuration, showError, showSuccess, t],
  )

  function handleWoDragStart(ev: SchedulerEvent, e: React.DragEvent) {
    if (ev.source !== 'work_order' || !ev.woId) return
    e.stopPropagation()
    cancelWoPopoverShow()
    cancelWoPopoverHide()
    woPopoverRef.current?.hide()
    setWoPopoverWo(null)
    woBarDragStartedRef.current = true
    const payload = {
      woId: ev.woId,
      spanStartYmd: ev.start,
      spanEndYmd: ev.end,
    }
    e.dataTransfer.setData(MCAL_WO_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDayDragOver(e: React.DragEvent, ymd: string) {
    if (!Array.from(e.dataTransfer.types).includes(MCAL_WO_DRAG_MIME)) {
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHighlightYmd(ymd)
  }

  function handleDayDrop(e: React.DragEvent, ymd: string) {
    e.preventDefault()
    setDropHighlightYmd(null)
    const raw = e.dataTransfer.getData(MCAL_WO_DRAG_MIME)
    const payload = parseMcalWoDragPayload(raw)
    if (!payload) return
    void applyWoPlanMove(payload.woId, ymd)
  }

  const openEdit = useCallback((ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation()
    setForm({
      title: ev.title,
      start: ev.start,
      end: ev.end,
      type: ev.type,
    })
    setEditingEvent(ev)
  }, [])

  const handleBarClick = useCallback(
    (se: SchedulerEvent, e: React.MouseEvent) => {
      if (se.source === 'work_order' && se.woId) {
        if (skipNextWoBarClickRef.current) {
          skipNextWoBarClickRef.current = false
          e.stopPropagation()
          e.preventDefault()
          return
        }
        e.stopPropagation()
        return
      }
      if (se.source === 'local' && se.localNumericId != null) {
        const row = events.find((x) => x.id === se.localNumericId)
        if (row) openEdit(row, e)
      }
    },
    [events, openEdit],
  )

  const handleWoBarDoubleClick = useCallback(
    (se: SchedulerEvent, e: React.MouseEvent) => {
      if (se.source !== 'work_order' || !se.woId) return
      if ((e.target as HTMLElement).closest('.app-viz-bar__handle')) return
      e.stopPropagation()
      e.preventDefault()
      const wo = workOrders.find((w) => w.id === se.woId)
      if (!wo) return
      cancelWoPopoverShow()
      cancelWoPopoverHide()
      woPopoverRef.current?.hide()
      setWoPopoverWo(null)
      void openEditWorkOrderMw(wo)
    },
    [
      workOrders,
      openEditWorkOrderMw,
      cancelWoPopoverShow,
      cancelWoPopoverHide,
    ],
  )

  const scheduleWoPopoverHide = useCallback(() => {
    cancelWoPopoverShow()
    cancelWoPopoverHide()
    woPopoverHideTimer.current = window.setTimeout(() => {
      woPopoverRef.current?.hide()
      setWoPopoverWo(null)
      woPopoverHideTimer.current = null
    }, 200)
  }, [cancelWoPopoverHide, cancelWoPopoverShow])

  const WO_POPOVER_SHOW_DELAY_MS = 500

  const showWoPopoverAtTarget = useCallback(
    (wo: WorkOrder, target: HTMLElement) => {
      cancelWoPopoverHide()
      setWoPopoverWo(wo)
      woPopoverRef.current?.show(undefined, target)
    },
    [cancelWoPopoverHide],
  )

  const scheduleWoPopoverOpen = useCallback(
    (wo: WorkOrder, e: React.MouseEvent<HTMLElement>) => {
      cancelWoPopoverShow()
      cancelWoPopoverHide()
      const target = e.currentTarget
      woPopoverPendingRef.current = { wo, target }
      woPopoverShowTimer.current = window.setTimeout(() => {
        woPopoverShowTimer.current = null
        const pending = woPopoverPendingRef.current
        woPopoverPendingRef.current = null
        if (!pending) return
        showWoPopoverAtTarget(pending.wo, pending.target)
      }, WO_POPOVER_SHOW_DELAY_MS)
    },
    [cancelWoPopoverHide, cancelWoPopoverShow, showWoPopoverAtTarget],
  )

  function closeModal() {
    setEditingEvent(null)
  }

  function saveEvent() {
    if (!workingSiteId) {
      showError(t('mcal.err_no_working_site'))
      return
    }
    if (!editingEvent) return
    if (
      !form.title.trim() ||
      !form.start ||
      !form.end ||
      form.end < form.start
    ) {
      showError(t('mcal.err_invalid_range'))
      return
    }
    setEvents((evs) =>
      evs.map((ev) =>
        ev.id === editingEvent.id ? { ...ev, ...form } : ev,
      ),
    )
    closeModal()
  }

  function deleteEvent() {
    if (!editingEvent) return
    setEvents((evs) => evs.filter((ev) => ev.id !== editingEvent.id))
    closeModal()
  }

  const dialogFooter = (
    <div className="flex flex-wrap gap-2 justify-content-end w-full">
      {editingEvent && (
        <Button
          type="button"
          label={t('mcal.delete')}
          icon="pi pi-trash"
          severity="danger"
          outlined
          onClick={deleteEvent}
          className="mr-auto"
        />
      )}
      <Button
        type="button"
        label={t('mcal.cancel')}
        severity="secondary"
        outlined
        onClick={closeModal}
      />
      <Button
        type="button"
        label={t('mcal.save')}
        icon="pi pi-check"
        onClick={saveEvent}
        disabled={!form.title.trim()}
      />
    </div>
  )

  const calendarBody = (
    <div className="mcal-calendar shadow-1">
        <div className="mcal-month-nav">
          <Button
            type="button"
            icon="pi pi-angle-left"
            rounded
            outlined
            onClick={prevMonth}
            aria-label={t('mcal.aria_prev_month')}
          />
          <h2 className="mcal-month-title">{monthTitle}</h2>
          <Button
            type="button"
            icon="pi pi-angle-right"
            rounded
            outlined
            onClick={nextMonth}
            aria-label={t('mcal.aria_next_month')}
          />
        </div>

        <div className="mcal-weekday-row">
          {weekdayLabels.map((d) => (
            <div key={d} className="mcal-weekday-cell">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => {
          const { placed, maxLane } = layoutWeek(week, mergedSchedulerEvents)
          const rowH = weekRowHeight(maxLane)

          return (
            <div key={wi} className="mcal-week-row">
              <div className="mcal-day-grid">
                {week.map((cell, di) => {
                  const { dateStr, displayDay, isCurrentMonth } = cell
                  const isToday = dateStr === todayStr
                  return (
                    <div
                      key={di}
                      className={[
                        'mcal-day-cell',
                        isCurrentMonth
                          ? 'mcal-day-cell--day'
                          : 'mcal-day-cell--muted',
                        dateStr === dropHighlightYmd
                          ? 'mcal-day-cell--drop-target'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ height: rowH }}
                      onDragOver={(e) => handleDayDragOver(e, dateStr)}
                      onDrop={(e) => handleDayDrop(e, dateStr)}
                    >
                      <span
                        className={[
                          'mcal-day-num',
                          isToday
                            ? 'mcal-day-num--today'
                            : !isCurrentMonth
                              ? 'mcal-day-num--adjacent-month'
                              : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {displayDay}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div
                className="absolute left-0 right-0 z-1"
                style={{
                  top: TOP_PAD,
                  pointerEvents: 'none',
                }}
              >
                {placed.map(
                  ({ ev, colStart, colSpan, lane, isStart, isEnd }) => {
                    const COL = 100 / 7
                    const left = `calc(${colStart * COL}% + ${isStart ? 4 : 0}px)`
                    const width = `calc(${colSpan * COL}% - ${(isStart ? 4 : 0) + (isEnd ? 4 : 0)}px)`
                    const top = lane * (LANE_H + LANE_GAP)
                    const barColor = ev.color
                    const isWo = ev.source === 'work_order'
                    const fgLocal = contrastTextOnHex(barColor)

                    return (
                      <div
                        key={`${ev.id}-w${wi}`}
                        draggable={isWo}
                        onDragStart={
                          isWo
                            ? (e) => handleWoDragStart(ev, e)
                            : undefined
                        }
                        onDragEnd={
                          isWo
                            ? () => {
                                if (woBarDragStartedRef.current) {
                                  woBarDragStartedRef.current = false
                                  skipNextWoBarClickRef.current = true
                                }
                              }
                            : undefined
                        }
                        onClick={(e) => handleBarClick(ev, e)}
                        onDoubleClick={
                          isWo
                            ? (e) => handleWoBarDoubleClick(ev, e)
                            : undefined
                        }
                        title={isWo ? undefined : ev.title}
                        aria-label={
                          isWo && ev.woKey != null
                            ? `#${ev.woKey}`
                            : isWo
                              ? ev.title
                              : undefined
                        }
                        className={[
                          'mcal-event-bar flex align-items-center',
                          isWo
                            ? 'app-viz-bar mcal-event-bar--wo text-sm font-semibold text-color'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          ...(isWo ? visualizationBarCssVars(barColor) : {}),
                          position: 'absolute',
                          left,
                          width,
                          top,
                          height: LANE_H,
                          ...(isWo
                            ? {}
                            : {
                                background: barColor,
                                boxShadow: '0 1px 5px rgba(0,0,0,0.18)',
                              }),
                          borderRadius:
                            isStart && isEnd
                              ? 6
                              : isStart
                                ? '6px 0 0 6px'
                                : isEnd
                                  ? '0 6px 6px 0'
                                  : 0,
                          paddingLeft: isWo ? 0 : isStart ? 8 : 2,
                          paddingRight: isEnd ? 4 : 2,
                          ...(isWo
                            ? {}
                            : {
                                fontSize: 11,
                                fontWeight: 600,
                                color: fgLocal,
                              }),
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          pointerEvents: 'auto',
                          cursor: isWo ? 'grab' : 'pointer',
                          zIndex: 3,
                          ...(isWo
                            ? {}
                            : {
                                opacity: 0.93,
                                transition: 'opacity 0.15s, filter 0.15s',
                              }),
                        }}
                        onMouseEnter={
                          isWo
                            ? (e) => {
                                if (!ev.woId) return
                                const wo = workOrders.find((w) => w.id === ev.woId)
                                if (wo) scheduleWoPopoverOpen(wo, e)
                              }
                            : (e) => {
                                e.currentTarget.style.opacity = '1'
                                e.currentTarget.style.filter =
                                  'brightness(1.06)'
                              }
                        }
                        onMouseLeave={
                          isWo
                            ? scheduleWoPopoverHide
                            : (e) => {
                                e.currentTarget.style.opacity = '0.93'
                                e.currentTarget.style.filter = ''
                              }
                        }
                      >
                        {isWo ? (
                          <>
                            <div className="app-viz-bar__handle" aria-hidden>
                              <i className="pi pi-ellipsis-v" />
                            </div>
                            <div className="app-viz-bar__body min-w-0 flex-1 overflow-hidden text-overflow-ellipsis pr-1 text-xs font-semibold">
                              {ev.woKey != null ? `#${ev.woKey}` : ''}
                            </div>
                            {!isEnd && (
                              <span
                                className="opacity-70 text-xs flex-shrink-0 ml-auto pr-1"
                                aria-hidden
                              >
                                ▶
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {!isStart && (
                              <span
                                className="opacity-70 text-xs flex-shrink-0 mr-1"
                                aria-hidden
                              >
                                ◀
                              </span>
                            )}
                            {isStart && (
                              <span className="overflow-hidden text-overflow-ellipsis">
                                {ev.title}
                              </span>
                            )}
                            {!isEnd && (
                              <span
                                className="opacity-70 text-xs flex-shrink-0 ml-auto pr-1"
                                aria-hidden
                              >
                                ▶
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )
                  },
                )}
              </div>
            </div>
          )
        })}
      </div>
  )

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <OverlayPanel
        ref={woPopoverRef}
        dismissable={false}
        onHide={() => setWoPopoverWo(null)}
        className="mcal-wo-popover shadow-2"
        onMouseEnter={cancelWoPopoverHide}
        onMouseLeave={scheduleWoPopoverHide}
        pt={{ content: { className: 'p-0' } }}
      >
        {woPopoverWo ? (
          <div
            key={woPopoverWo.id}
            className="p-3 flex flex-column gap-3 text-sm line-height-3"
          >
            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase letter-spacing-1 mb-1">
                {t('wo.col_short_text')}
              </div>
              <div className="mcal-wo-popover__value">
                {woPopoverWo.short_text?.trim() || t('common.em_dash')}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase letter-spacing-1 mb-1">
                {t('wo.col_asset')}
              </div>
              <div className="mcal-wo-popover__value">
                {(() => {
                  const k = woPopoverWo.asset_key?.trim()
                  const n = woPopoverWo.asset_name?.trim()
                  const dash = t('common.em_dash')
                  if (k && n) return `${k} — ${n}`
                  if (n) return n
                  if (k) return k
                  return dash
                })()}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase letter-spacing-1 mb-1">
                {t('common.col_instruction')}
              </div>
              <div className="mcal-wo-popover__instruction text-color">
                {woPopoverWo.instruction_text?.trim() || t('common.em_dash')}
              </div>
            </div>
          </div>
        ) : null}
      </OverlayPanel>
      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        {!workingSiteId ? (
          <Message severity="warn" text={t('mcal.err_no_working_site')} />
        ) : (
          <Card
            className="shadow-1 border-round-xl overflow-hidden"
            pt={{ header: { className: 'p-0 border-none' } }}
            header={
              <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5 w-full">
                <span
                  className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
                  aria-hidden
                >
                  <i className="pi pi-calendar text-xl" />
                </span>
                <div className="min-w-0 pt-0 flex-1">
                  <h1 className="app-card-hero-title">{t('mcal.title')}</h1>
                  <p className="app-card-hero-desc">{t('mcal.subtitle')}</p>
                  {woListLoading && (
                    <div className="flex align-items-center gap-2 mt-2 text-sm text-color-secondary">
                      <ProgressSpinner
                        style={{ width: '1.5rem', height: '1.5rem' }}
                      />
                      <span>{t('mcal.wo_loading')}</span>
                    </div>
                  )}
                </div>
              </div>
            }
          >
            <div className="px-1 md:px-2 pb-3 flex flex-column gap-3">
              {woListLoading ? null : (
                <AppVizBarLegend
                  title={t('mcal.legend_wo_types_head')}
                  ariaLabel={t('mcal.legend_wo_types_head')}
                  items={woTypeLegend.map((row) => ({
                    id: row.id,
                    label: row.label,
                    accent: row.color,
                  }))}
                  empty={
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('mcal.legend_wo_types_empty')}
                    </p>
                  }
                />
              )}
              {calendarBody}
            </div>
          </Card>
        )}
      </div>

      <Dialog
        visible={editingEvent !== null}
        onHide={closeModal}
        header={t('mcal.dialog_edit')}
        modal
        dismissableMask
        draggable={false}
        resizable={false}
        style={{ width: 'min(100vw - 2rem, 28rem)' }}
        footer={dialogFooter}
      >
        {editingEvent && (
          <div className="flex flex-column gap-3 pt-1">
            <div>
              <label htmlFor="mcal-title" className={fieldLabelClass}>
                {t('mcal.field_title')}
              </label>
              <InputText
                id="mcal-title"
                autoFocus
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t('mcal.field_title_ph')}
                className="w-full"
              />
            </div>

            <div className="grid">
              <div className="col-12 md:col-6">
                <label htmlFor="mcal-start" className={fieldLabelClass}>
                  {t('mcal.field_from')}
                </label>
                <input
                  id="mcal-start"
                  type="date"
                  value={form.start}
                  className="p-inputtext p-component w-full"
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      start: e.target.value,
                      end:
                        e.target.value > f.end ? e.target.value : f.end,
                    }))
                  }
                />
              </div>
              <div className="col-12 md:col-6">
                <label htmlFor="mcal-end" className={fieldLabelClass}>
                  {t('mcal.field_to')}
                </label>
                <input
                  id="mcal-end"
                  type="date"
                  value={form.end}
                  min={form.start}
                  className="p-inputtext p-component w-full"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end: e.target.value }))
                  }
                />
              </div>
            </div>

            <div>
              <span className={fieldLabelClass}>{t('mcal.field_category')}</span>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPE_STYLES.map((ty) => (
                  <Button
                    key={ty.id}
                    type="button"
                    label={t(ty.labelKey)}
                    size="small"
                    outlined={form.type !== ty.id}
                    onClick={() =>
                      setForm((f) => ({ ...f, type: ty.id }))
                    }
                    style={
                      form.type === ty.id
                        ? {
                            borderColor: ty.color,
                            backgroundColor: `${ty.color}22`,
                            color: ty.color,
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </AppShell>
  )
}
