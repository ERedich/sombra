import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import {
  getShiftAppSettings,
  isPgUndefinedRelationError,
} from '../services/appSettings.js'
import {
  tacHoursForRow,
  tachHoursForRow,
} from '../services/capacityPlanning.js'

const router = Router()
router.use(requireAuth)

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** TAC / TACh for working site from shift plan (SPC-weighted). */
router.get('/shift-capacity', async (req, res) => {
  const siteId = req.authUser?.working_site_id ?? null
  const asOf = new Date().toISOString()
  if (!siteId) {
    res.json({
      tac_hours: 0,
      tach_hours: 0,
      working_site_id: null,
      as_of: asOf,
    })
    return
  }

  try {
    const settings = await getShiftAppSettings(pool)
    const spcFrac = settings.shift_planning_capacity_pct / 100

    const meta = await pool.query<{ today: string; ch: number }>(
      `SELECT CURRENT_DATE::text AS today,
              EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::int AS ch`,
    )
    const today = meta.rows[0]?.today ?? ''
    const curHour = meta.rows[0]?.ch ?? 0
    const yesterday = addDaysToYmd(today, -1)

    const rows = await pool.query<{
      ad: string
      ts: string
      te: string
    }>(
      `SELECT sa.assignment_date::text AS ad,
              COALESCE(sa.override_time_start, sh.time_start)::text AS ts,
              COALESCE(sa.override_time_end, sh.time_end)::text AS te
       FROM shift_assignments sa
       INNER JOIN shifts sh ON sh.id = sa.shift_id
       WHERE sh.site_id = $1::uuid
         AND sa.presence_status IN ('scheduled', 'present', 'not_present')
         AND (
           sa.assignment_date = CURRENT_DATE
           OR (
             sa.assignment_date = CURRENT_DATE - INTERVAL '1 day'
             AND COALESCE(sa.override_time_end, sh.time_end)
               <= COALESCE(sa.override_time_start, sh.time_start)
           )
         )`,
      [siteId],
    )

    let tacHours = 0
    let tachHours = 0
    for (const row of rows.rows) {
      tacHours += tacHoursForRow(
        row.ad,
        row.ts,
        row.te,
        today,
        yesterday,
        spcFrac,
      )
      tachHours += tachHoursForRow(
        row.ad,
        row.ts,
        row.te,
        today,
        yesterday,
        spcFrac,
        curHour,
      )
    }

    res.json({
      tac_hours: tacHours,
      tach_hours: tachHours,
      working_site_id: siteId,
      as_of: asOf,
    })
  } catch (e) {
    if (isPgUndefinedRelationError(e)) {
      res.status(503).json({
        error: 'Shift capacity KPIs require applied migrations.',
      })
      return
    }
    throw e
  }
})

export default router
