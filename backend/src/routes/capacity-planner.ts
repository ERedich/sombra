import { Router } from 'express'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { WORK_ORDERS_LIST_SQL } from './workOrderListSql.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AssignmentRow = {
  id: string
  shift_id: string
  assignment_date: string
  employee_id: string
  presence_status: string
  present_started_at: Date | null
  absent_reason: string | null
  absent_remark: string | null
  shift_key: string
  shift_name: string
  time_start: string
  time_end: string
  available_weekdays: number[]
  site_id: string
  employee_key: string
  employee_name: string
}

const SHIFT_ASSIGNMENTS_LIST_SQL = `
SELECT sa.id, sa.shift_id, sa.assignment_date::text AS assignment_date,
       sa.employee_id, sa.presence_status, sa.present_started_at,
       sa.absent_reason, sa.absent_remark,
       sa.created_at, sa.updated_at, sa.created_by, sa.updated_by,
       sh.key AS shift_key, sh.name AS shift_name,
       COALESCE(sa.override_time_start, sh.time_start)::text AS time_start,
       COALESCE(sa.override_time_end, sh.time_end)::text AS time_end,
       sh.available_weekdays,
       sh.site_id,
       e.key AS employee_key, e.name AS employee_name
FROM shift_assignments sa
INNER JOIN shifts sh ON sh.id = sa.shift_id
INNER JOIN employees e ON e.id = sa.employee_id
`

const router = Router()
router.use(requireAuth)

router.get('/snapshot', async (req, res) => {
  const dateFrom =
    typeof req.query.date_from === 'string' ? req.query.date_from.trim() : ''
  const dateTo =
    typeof req.query.date_to === 'string' ? req.query.date_to.trim() : ''
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    res.status(400).json({
      error: 'Query params date_from and date_to are required (YYYY-MM-DD).',
    })
    return
  }
  if (dateFrom > dateTo) {
    res.status(400).json({ error: 'date_from must be <= date_to.' })
    return
  }

  const workgroupIdRaw =
    typeof req.query.workgroup_id === 'string' ? req.query.workgroup_id.trim() : ''
  const workgroupId =
    workgroupIdRaw && UUID_RE.test(workgroupIdRaw) ? workgroupIdRaw : null
  if (workgroupIdRaw && !workgroupId) {
    res.status(400).json({
      error: 'workgroup_id query param must be a valid UUID when provided.',
    })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  if (workgroupId) {
    const wgR = await pool.query<{ site_id: string }>(
      `SELECT site_id FROM workgroups WHERE id = $1`,
      [workgroupId],
    )
    const wgSite = wgR.rows[0]?.site_id
    if (!wgSite) {
      res.status(404).json({ error: 'Workgroup not found.' })
      return
    }
    if (!canAccessSite(scope, wgSite)) {
      res.status(403).json({ error: 'You cannot access this workgroup.' })
      return
    }
  }

  let siteFilterWo = ''
  let siteFilterSa = ''
  let wgFilterWo = ''
  let wgFilterSa = ''
  let wgFilterAlloc = ''
  const woParams: unknown[] = [dateFrom, dateTo]
  const saParams: unknown[] = [dateFrom, dateTo]
  let allocParams: unknown[] = [dateFrom, dateTo]

  if (auth.role === 'admin') {
    siteFilterWo = ''
    siteFilterSa = ''
  } else {
    const allowed = accessibleSiteIds(scope)
    if (allowed === null || allowed.length === 0) {
      res.json({
        work_orders: [],
        shift_assignments: [],
        capacity_allocations: [],
        used_hours_by_employee_date: {},
      })
      return
    }
    siteFilterWo = ' AND w.site_id = ANY($3::uuid[])'
    siteFilterSa = ' AND sh.site_id = ANY($3::uuid[])'
    woParams.push(allowed)
    saParams.push(allowed)
    allocParams = [dateFrom, dateTo, allowed]
  }

  if (workgroupId) {
    wgFilterWo = ` AND w.workgroup_id = $${woParams.length + 1}::uuid`
    woParams.push(workgroupId)
    wgFilterSa = ` AND EXISTS (
      SELECT 1 FROM workgroup_employees we
      WHERE we.employee_id = sa.employee_id
        AND we.workgroup_id = $${saParams.length + 1}::uuid
    )`
    saParams.push(workgroupId)
    wgFilterAlloc = ` AND w.workgroup_id = $${allocParams.length + 1}::uuid`
    allocParams.push(workgroupId)
  }

  /** WO included if planned window overlaps [date_from, date_to] on UTC calendar dates (inclusive). */
  const woOverlap = `
    w.plan_start IS NOT NULL
    AND w.plan_end IS NOT NULL
    AND w.plan_start <> w.plan_end
    AND (w.plan_start AT TIME ZONE 'UTC')::date <= $2::date
    AND (w.plan_end AT TIME ZONE 'UTC')::date >= $1::date
  `

  const workOrdersR = await pool.query(
    `${WORK_ORDERS_LIST_SQL}
     WHERE ${woOverlap}
     ${siteFilterWo}
     ${wgFilterWo}
     ORDER BY w.wo_key DESC`,
    woParams,
  )

  const assignmentsR = await pool.query<AssignmentRow>(
    `${SHIFT_ASSIGNMENTS_LIST_SQL}
     WHERE sa.assignment_date >= $1::date AND sa.assignment_date <= $2::date
     ${siteFilterSa}
     ${wgFilterSa}
     ORDER BY sa.assignment_date ASC, sh.key ASC, e.name ASC`,
    saParams,
  )

  const allocSql =
    auth.role === 'admin'
      ? `SELECT woca.work_order_id::text AS work_order_id,
                woca.employee_id::text AS employee_id,
                woca.allocation_date::text AS allocation_date,
                woca.planned_hours::text AS planned_hours
         FROM work_order_capacity_allocations woca
         INNER JOIN work_orders w ON w.id = woca.work_order_id
         WHERE woca.allocation_date >= $1::date
           AND woca.allocation_date <= $2::date
           ${wgFilterAlloc}`
      : `SELECT woca.work_order_id::text AS work_order_id,
                woca.employee_id::text AS employee_id,
                woca.allocation_date::text AS allocation_date,
                woca.planned_hours::text AS planned_hours
         FROM work_order_capacity_allocations woca
         INNER JOIN work_orders w ON w.id = woca.work_order_id
         WHERE woca.allocation_date >= $1::date
           AND woca.allocation_date <= $2::date
           AND w.site_id = ANY($3::uuid[])
           ${wgFilterAlloc}`

  const allocationsR = await pool.query<{
    work_order_id: string
    employee_id: string
    allocation_date: string
    planned_hours: string
  }>(allocSql, allocParams)

  const usedHoursByEmployeeDate: Record<string, Record<string, number>> = {}
  for (const row of allocationsR.rows) {
    const h = Number(row.planned_hours)
    if (!Number.isFinite(h)) continue
    if (!usedHoursByEmployeeDate[row.employee_id]) {
      usedHoursByEmployeeDate[row.employee_id] = {}
    }
    const byDate = usedHoursByEmployeeDate[row.employee_id]!
    byDate[row.allocation_date] = (byDate[row.allocation_date] ?? 0) + h
  }

  res.json({
    work_orders: workOrdersR.rows,
    shift_assignments: assignmentsR.rows,
    capacity_allocations: allocationsR.rows.map((r) => ({
      work_order_id: r.work_order_id,
      employee_id: r.employee_id,
      allocation_date: r.allocation_date,
      planned_hours: Number(r.planned_hours),
    })),
    used_hours_by_employee_date: usedHoursByEmployeeDate,
  })
})

export default router
