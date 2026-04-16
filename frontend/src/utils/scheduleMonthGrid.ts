/** One cell in the month matrix (always local midnight). */
export type ScheduleMonthCell = {
  date: Date
  /** YYYY-MM-DD in local calendar. */
  ymd: string
  /** True when `date` is in the anchor month (same year+month as view). */
  inMonth: boolean
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 6×7 month matrix for a calendar month view.
 * `firstDayOfWeek`: 0 = Sunday, 1 = Monday (Prime / DevExtreme convention).
 */
export function buildScheduleMonthGrid(
  viewAnchor: Date,
  firstDayOfWeek: 0 | 1,
): ScheduleMonthCell[][] {
  const y = viewAnchor.getFullYear()
  const m = viewAnchor.getMonth()
  const firstOfMonth = new Date(y, m, 1)
  firstOfMonth.setHours(0, 0, 0, 0)
  const firstDow = firstOfMonth.getDay()
  const back = (firstDow - firstDayOfWeek + 7) % 7
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(firstOfMonth.getDate() - back)
  gridStart.setHours(0, 0, 0, 0)

  const weeks: ScheduleMonthCell[][] = []
  const cur = new Date(gridStart)
  for (let w = 0; w < 6; w += 1) {
    const row: ScheduleMonthCell[] = []
    for (let d = 0; d < 7; d += 1) {
      row.push({
        date: new Date(cur),
        ymd: toYmdLocal(cur),
        inMonth: cur.getMonth() === m && cur.getFullYear() === y,
      })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(row)
  }
  return weeks
}

/** Short weekday labels for header row, column order = `firstDayOfWeek` … +6. */
export function scheduleWeekdayShortLabels(
  locale: string,
  firstDayOfWeek: 0 | 1,
): string[] {
  const fmt = new Intl.DateTimeFormat(locale || 'en', { weekday: 'short' })
  const out: string[] = []
  for (let c = 0; c < 7; c += 1) {
    const dow = (firstDayOfWeek + c) % 7
    const ref = new Date(2023, 0, 1)
    while (ref.getDay() !== dow) ref.setDate(ref.getDate() + 1)
    out.push(fmt.format(ref))
  }
  return out
}
