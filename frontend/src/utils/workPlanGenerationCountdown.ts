const MS_PER_DAY = 86400000

/**
 * Full UTC calendar days until the WO generation window opens for a work plan.
 * Matches backend `isDueForGeneration`: eligible when today (UTC) >= next_due date − lead_time_days.
 *
 * @returns `null` if `nextDueAtIso` is invalid; otherwise a non-negative integer (0 = due / in window).
 */
export function workPlanDaysUntilGenerationOpens(
  nextDueAtIso: string,
  leadTimeDays: number,
): number | null {
  const nextDueAt = new Date(nextDueAtIso)
  if (Number.isNaN(nextDueAt.getTime())) return null
  const lead =
    Number.isFinite(leadTimeDays) && leadTimeDays >= 0
      ? Math.trunc(leadTimeDays)
      : 0
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
  const threshold = dueDay - lead * MS_PER_DAY
  const diffDays = Math.floor((threshold - todayUtc) / MS_PER_DAY)
  return Math.max(0, diffDays)
}
