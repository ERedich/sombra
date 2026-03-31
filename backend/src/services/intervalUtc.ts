export type IntervalTimeType = 'day' | 'week' | 'month' | 'year'

export function addIntervalUtc(
  d: Date,
  count: number,
  type: IntervalTimeType,
): Date {
  const x = new Date(d.getTime())
  switch (type) {
    case 'day': {
      x.setUTCDate(x.getUTCDate() + count)
      return x
    }
    case 'week': {
      x.setUTCDate(x.getUTCDate() + count * 7)
      return x
    }
    case 'month': {
      const y = x.getUTCFullYear()
      const m = x.getUTCMonth()
      const day = x.getUTCDate()
      const h = x.getUTCHours()
      const min = x.getUTCMinutes()
      const s = x.getUTCSeconds()
      const ms = x.getUTCMilliseconds()
      const nm = m + count
      const target = new Date(Date.UTC(y, nm, 1, h, min, s, ms))
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate()
      const dday = Math.min(day, lastDay)
      target.setUTCDate(dday)
      return target
    }
    case 'year': {
      const y = x.getUTCFullYear() + count
      const m = x.getUTCMonth()
      const day = x.getUTCDate()
      return new Date(
        Date.UTC(
          y,
          m,
          day,
          x.getUTCHours(),
          x.getUTCMinutes(),
          x.getUTCSeconds(),
          x.getUTCMilliseconds(),
        ),
      )
    }
    default:
      return x
  }
}

/** Generation window: today (UTC date) >= next_due date - lead_time_days. */
export function isDueForGeneration(
  nextDueAt: Date,
  leadTimeDays: number,
): boolean {
  const now = new Date()
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const dueDay = Date.UTC(
    nextDueAt.getUTCFullYear(),
    nextDueAt.getUTCMonth(),
    nextDueAt.getUTCDate(),
  )
  const threshold = dueDay - leadTimeDays * 86400000
  return todayUtc >= threshold
}

export function planEndFromStartAndDurationHours(
  planStart: Date,
  durationHours: number,
): Date {
  if (!Number.isFinite(durationHours) || durationHours < 0) {
    return new Date(planStart.getTime())
  }
  return new Date(planStart.getTime() + durationHours * 3600000)
}
