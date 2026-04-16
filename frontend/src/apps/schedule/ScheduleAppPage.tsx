import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
import { OverlayPanel } from 'primereact/overlaypanel'
import { ProgressSpinner } from 'primereact/progressspinner'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import {
  mergeDisplayStatusColours,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'
import { useWorkOrderMw } from '../../layout/WorkOrderMwProvider'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import type { WorkOrder } from '../work-orders/workOrderTypes'
import type { WoMwEvent } from '../../layout/workOrderMwTypes'
import { primeFirstDayOfWeekFromFdw } from '../../utils/firstDayOfWeekPreference'
import { contrastTextOnHex } from '../../utils/contrastTextOnHex'
import {
  buildScheduleMonthGrid,
  scheduleWeekdayShortLabels,
} from '../../utils/scheduleMonthGrid'
import {
  assignBarLanes,
  buildWeekSegments,
  maxLaneIndex,
} from '../../utils/scheduleWoMonthBars'

function sortedWorkOrdersDesc(rows: WorkOrder[]): WorkOrder[] {
  return [...rows].sort((a, b) => (b.wo_key ?? 0) - (a.wo_key ?? 0))
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function ScheduleAppPage() {
  const { t, i18n } = useTranslation()
  const { fdw } = useAppParameters()
  const toastRef = useRef<Toast>(null)
  const jumpRef = useRef<OverlayPanel>(null)

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [woStatusColourOverrides, setWoStatusColourOverrides] = useState<
    Partial<Record<WorkOrderStatusColourKey, string>>
  >({})

  const { mountWoMw, subscribeWorkOrderMwEvents } = useWorkOrderMw()

  const woStatusMergedColours = useMemo(
    () => mergeDisplayStatusColours(woStatusColourOverrides),
    [woStatusColourOverrides],
  )

  const firstDayOfWeek = useMemo(
    () => primeFirstDayOfWeekFromFdw(fdw),
    [fdw],
  )

  const monthGrid = useMemo(
    () => buildScheduleMonthGrid(currentDate, firstDayOfWeek),
    [currentDate, firstDayOfWeek],
  )

  const dowLabels = useMemo(
    () => scheduleWeekdayShortLabels(i18n.language, firstDayOfWeek),
    [i18n.language, firstDayOfWeek],
  )

  const monthTitle = useMemo(() => {
    const d = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    )
    return new Intl.DateTimeFormat(i18n.language || 'en', {
      month: 'long',
      year: 'numeric',
    }).format(d)
  }, [currentDate, i18n.language])

  const weekLayouts = useMemo(() => {
    return monthGrid.map((week) => {
      const segments = buildWeekSegments(week, rows)
      const placed = assignBarLanes(segments)
      const laneCount =
        placed.length === 0 ? 0 : maxLaneIndex(placed) + 1
      return { week, placed, laneCount }
    })
  }, [monthGrid, rows])

  /** DOW row + 2 rows per week (day numbers + bar strip). */
  const scheduleGridRowCount = 1 + weekLayouts.length * 2

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

  const loadWorkOrders = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiJson<{ work_orders: WorkOrder[] }>('/api/work-orders')
      setRows(sortedWorkOrdersDesc(data.work_orders ?? []))
    } catch (e) {
      setRows([])
      const msg =
        e instanceof ApiError ? e.message : t('schedule.load_fail')
      setLoadError(msg)
      toastRef.current?.show({
        severity: 'error',
        summary: t('schedule.load_fail'),
        detail: msg,
        life: 6000,
      })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadWorkOrders()
  }, [loadWorkOrders])

  useEffect(() => {
    const onMw = (ev: WoMwEvent) => {
      if (ev.type === 'merged_row') {
        setRows((prev) => {
          const ix = prev.findIndex((r) => r.id === ev.workOrder.id)
          if (ix < 0) return prev
          const next = [...prev]
          next[ix] = ev.workOrder
          return sortedWorkOrdersDesc(next)
        })
        return
      }
      if (ev.type === 'created_row') {
        setRows((prev) => {
          const map = new Map(prev.map((r) => [r.id, r]))
          map.set(ev.workOrder.id, ev.workOrder)
          return sortedWorkOrdersDesc([...map.values()])
        })
        return
      }
      if (ev.type === 'silent_list_refresh') {
        void loadWorkOrders()
      }
    }
    return subscribeWorkOrderMwEvents(onMw)
  }, [loadWorkOrders, subscribeWorkOrderMwEvents])

  const goPrevMonth = useCallback(() => {
    setCurrentDate((d) => {
      const x = new Date(d)
      x.setMonth(x.getMonth() - 1)
      return x
    })
  }, [])

  const goNextMonth = useCallback(() => {
    setCurrentDate((d) => {
      const x = new Date(d)
      x.setMonth(x.getMonth() + 1)
      return x
    })
  }, [])

  const goToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  const onJumpMonth = useCallback((value: Date | null) => {
    if (!value) return
    setCurrentDate(new Date(value.getFullYear(), value.getMonth(), 1))
    jumpRef.current?.hide()
  }, [])

  const todayYmd = toYmdLocal(new Date())

  return (
    <AppShell>
      <Toast ref={toastRef} position="top-right" />
      <div className="app-schedule-page app-schedule-native">
        <Card title={t('schedule.title')}>
          {loadError ? (
            <p className="app-schedule-error">{loadError}</p>
          ) : null}
          {loading ? (
            <div className="app-schedule-loading">
              <ProgressSpinner />
            </div>
          ) : (
            <>
              <div className="app-schedule-toolbar">
                <h2 className="app-schedule-month-title">{monthTitle}</h2>
                <div className="app-schedule-toolbar-actions">
                  <ButtonGroup>
                    <Button
                      type="button"
                      icon="pi pi-chevron-left"
                      onClick={goPrevMonth}
                      aria-label={t('schedule.prev_month')}
                      tooltip={t('schedule.prev_month')}
                      tooltipOptions={{ position: 'bottom' }}
                    />
                    <Button
                      type="button"
                      label={t('schedule.today')}
                      onClick={goToday}
                    />
                    <Button
                      type="button"
                      icon="pi pi-chevron-right"
                      onClick={goNextMonth}
                      aria-label={t('schedule.next_month')}
                      tooltip={t('schedule.next_month')}
                      tooltipOptions={{ position: 'bottom' }}
                    />
                  </ButtonGroup>
                  <Button
                    type="button"
                    icon="pi pi-calendar"
                    label={t('schedule.jump_month')}
                    onClick={(e) => jumpRef.current?.toggle(e)}
                  />
                </div>
              </div>
              <OverlayPanel ref={jumpRef} dismissable>
                <Calendar
                  value={currentDate}
                  onChange={(e) => onJumpMonth((e.value as Date | null) ?? null)}
                  view="month"
                  dateFormat="mm/yy"
                  showButtonBar
                />
              </OverlayPanel>

              <div
                className="app-schedule-calendar"
                role="grid"
                aria-colcount={7}
                aria-rowcount={scheduleGridRowCount}
                aria-label={t('schedule.title')}
              >
                <div className="app-schedule-head" role="rowgroup">
                  <div className="app-schedule-tr" role="row">
                    {dowLabels.map((label, i) => (
                      <div
                        key={i}
                        className={[
                          'app-schedule-th',
                          i === 0 ? 'app-schedule-col-start' : '',
                          i === 6 ? 'app-schedule-col-end' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        role="columnheader"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="app-schedule-body" role="rowgroup">
                  {weekLayouts.map(({ week, placed, laneCount }, wi) => (
                    <div key={wi} className="app-schedule-week">
                      <div
                        className="app-schedule-tr app-schedule-tr--days"
                        role="row"
                      >
                        {week.map((cell, colIx) => {
                          const isToday = cell.ymd === todayYmd
                          const cellClass = [
                            'app-schedule-td',
                            !cell.inMonth ? 'app-schedule-day-column--muted' : '',
                            isToday ? 'app-schedule-day-column--today' : '',
                            colIx === 0 ? 'app-schedule-col-start' : '',
                            colIx === 6 ? 'app-schedule-col-end' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')
                          return (
                            <div
                              key={cell.ymd}
                              className={cellClass}
                              role="gridcell"
                            >
                              <div className="app-schedule-day-num-row">
                                <span className="app-schedule-day-num">
                                  {cell.date.getDate()}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div
                        className="app-schedule-tr app-schedule-tr--bars"
                        role="row"
                      >
                        <div
                          className="app-schedule-td app-schedule-td--span"
                          role="presentation"
                        >
                          <div
                            className="app-schedule-week-strip"
                            style={
                              {
                                '--schedule-bar-lane-count': String(
                                  Math.max(laneCount, 0),
                                ),
                              } as CSSProperties
                            }
                            aria-hidden={placed.length === 0}
                          >
                            {placed.map((p) => {
                              const st = p.wo.status as WorkOrderStatusColourKey
                              const bg =
                                woStatusMergedColours[st] ??
                                woStatusMergedColours.open
                              const fg = contrastTextOnHex(bg)
                              const label = `${p.wo.wo_key} · ${p.wo.short_text}`
                              const startLine = p.startCol + 1
                              const endLine = p.endCol + 2
                              const continuesLeft = !p.isStart
                              const continuesRight = !p.isEnd
                              const barClass = [
                                'app-schedule-span-bar',
                                p.isStart ? 'app-schedule-span-bar--start' : '',
                                p.isEnd ? 'app-schedule-span-bar--end' : '',
                                continuesLeft
                                  ? 'app-schedule-span-bar--continues-left'
                                  : '',
                                continuesRight
                                  ? 'app-schedule-span-bar--continues-right'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')
                              const a11yLabel = [
                                label,
                                continuesLeft
                                  ? t('schedule.bar_continues_from_prev_week')
                                  : '',
                                continuesRight
                                  ? t('schedule.bar_continues_to_next_week')
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' – ')
                              return (
                                <button
                                  key={`${p.wo.id}-${wi}-${p.lane}-${p.startCol}-${p.endCol}`}
                                  type="button"
                                  className={barClass}
                                  style={{
                                    gridColumn: `${startLine} / ${endLine}`,
                                    gridRow: p.lane + 1,
                                    backgroundColor: bg,
                                    color: fg,
                                  }}
                                  title={label}
                                  aria-label={a11yLabel}
                                  onClick={() => mountWoMw(p.wo.id)}
                                >
                                  {continuesLeft ? (
                                    <span
                                      className="app-schedule-span-bar-cont app-schedule-span-bar-cont--left"
                                      aria-hidden="true"
                                    >
                                      <i className="pi pi-chevron-left" />
                                    </span>
                                  ) : null}
                                  <span className="app-schedule-span-bar-label">
                                    {label}
                                  </span>
                                  {continuesRight ? (
                                    <span
                                      className="app-schedule-span-bar-cont app-schedule-span-bar-cont--right"
                                      aria-hidden="true"
                                    >
                                      <i className="pi pi-chevron-right" />
                                    </span>
                                  ) : null}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
