import type { Pool, PoolClient } from 'pg'
import { getShiftAppSettings, isPgUndefinedRelationError } from './appSettings.js'

/**
 * Wall-clock shift window using minutes from midnight [0, 1440).
 * If end <= start, the interval crosses midnight (overnight shift).
 */
export function isWallTimeInShiftWindow(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  const n = ((nowMinutes % 1440) + 1440) % 1440
  const s = ((startMinutes % 1440) + 1440) % 1440
  const e = ((endMinutes % 1440) + 1440) % 1440
  if (e > s) {
    return n >= s && n < e
  }
  if (e < s) {
    return n >= s || n < e
  }
  return false
}

/**
 * Uses DB session `CURRENT_DATE` / `LOCALTIME` (server timezone).
 *
 * Marks **scheduled** slots as present when the user logs in on a relevant calendar
 * day: same-day assignment, or “tail” of an overnight shift still open after
 * midnight (assignment on yesterday, wall time before shift end).
 *
 * We intentionally do **not** require wall time to fall inside the shift window for
 * same-day rows so early log-ins still count (common expectation for SLR).
 */
export async function applyShiftLoginOnLogin(
  client: Pool | PoolClient,
  args: { userId: string; siteId: string | null; employeeId: string | null },
): Promise<void> {
  const settings = await getShiftAppSettings(client)
  if (!settings.shift_login_recognition) return
  if (!args.siteId || !args.employeeId) return

  try {
    await client.query(
      `UPDATE shift_assignments sa
       SET presence_status = 'present',
           present_started_at = COALESCE(sa.present_started_at, now()),
           updated_at = now(),
           updated_by = $1
       FROM shifts sh
       WHERE sa.shift_id = sh.id
         AND sh.site_id = $2::uuid
         AND sa.employee_id = $3::uuid
         AND sa.presence_status = 'scheduled'
         AND EXTRACT(ISODOW FROM sa.assignment_date)::smallint = ANY (sh.available_weekdays)
         AND (
           sa.assignment_date = CURRENT_DATE
           OR (
             sh.time_end <= sh.time_start
             AND sa.assignment_date = CURRENT_DATE - 1
             AND LOCALTIME < sh.time_end
           )
         )`,
      [args.userId, args.siteId, args.employeeId],
    )
  } catch (e) {
    if (isPgUndefinedRelationError(e)) return
    throw e
  }
}

export async function applyShiftLogoutPresenceClear(
  client: Pool | PoolClient,
  args: { userId: string; siteId: string | null; employeeId: string | null },
): Promise<void> {
  const settings = await getShiftAppSettings(client)
  if (!settings.shift_login_recognition) return
  if (!args.siteId || !args.employeeId) return

  try {
    await client.query(
      `UPDATE shift_assignments sa
       SET presence_status = 'not_present',
           updated_at = now(),
           updated_by = $1
       FROM shifts sh
       WHERE sa.shift_id = sh.id
         AND sh.site_id = $2::uuid
         AND sa.employee_id = $3::uuid
         AND sa.presence_status = 'present'
         AND (
           sa.assignment_date = CURRENT_DATE
           OR (
             sh.time_end <= sh.time_start
             AND sa.assignment_date = CURRENT_DATE - 1
             AND LOCALTIME < sh.time_end
           )
         )`,
      [args.userId, args.siteId, args.employeeId],
    )
  } catch (e) {
    if (isPgUndefinedRelationError(e)) return
    throw e
  }
}
