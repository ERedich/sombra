import { Router } from 'express'
import type { PoolClient } from 'pg'
import type { AuthUser } from '../middleware/auth.js'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { fieldChanges, redactForAudit, writeAudit } from '../audit/auditLog.js'
import { getShiftAppSettings } from '../services/appSettings.js'
import { timeHmsToMinutes } from '../services/capacityPlanning.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const TIME_HMS_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

function normalizeTimeHmsForPg(s: string): string | null {
  const t = s.trim()
  if (!TIME_HMS_RE.test(t)) return null
  const parts = t.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  const sec = parts[2] != null ? Number(parts[2]) : 0
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(m) ||
    !Number.isFinite(sec) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59 ||
    sec < 0 ||
    sec > 59
  ) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const MINUTES_PER_DAY = 24 * 60

/** When SBPR is on, overrides must stay inside the shift definition window (wall clock). */
function overrideWithinShiftDefWallClock(
  nsMin: number,
  neMin: number,
  dsMin: number,
  deMin: number,
  defOvernight: boolean,
): boolean {
  if (nsMin === neMin) return false
  if (!defOvernight) {
    if (neMin <= nsMin) return false
    return nsMin >= dsMin && neMin <= deMin
  }
  if (neMin > nsMin) {
    const eveningOnly = nsMin >= dsMin && neMin <= MINUTES_PER_DAY
    const morningOnly = nsMin < dsMin && neMin <= deMin && neMin > nsMin
    return eveningOnly || morningOnly
  }
  return nsMin >= dsMin && neMin <= deMin
}

const PRESENCE = new Set(['scheduled', 'present', 'not_present', 'absent'])
const ABSENT_REASONS = new Set(['sick', 'holiday', 'unknown'])

type AssignmentTableRow = {
  id: string
  shift_id: string
  assignment_date: string
  employee_id: string
  presence_status: string
  present_started_at: Date | null
  absent_reason: string | null
  absent_remark: string | null
  override_time_start: string | null
  override_time_end: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type AssignmentRow = AssignmentTableRow & {
  shift_key: string
  shift_name: string
  time_start: string
  time_end: string
  available_weekdays: number[]
  site_id: string
  employee_key: string
  employee_name: string
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function rowToAuditRecord(row: AssignmentTableRow): Record<string, unknown> {
  return {
    ...row,
    assignment_date:
      typeof row.assignment_date === 'string'
        ? row.assignment_date
        : (row.assignment_date as Date).toISOString().slice(0, 10),
    present_started_at:
      row.present_started_at instanceof Date
        ? row.present_started_at.toISOString()
        : row.present_started_at,
    override_time_start: row.override_time_start ?? null,
    override_time_end: row.override_time_end ?? null,
  }
}

async function fetchAssignmentRow(
  client: PoolClient,
  id: string,
): Promise<AssignmentRow | undefined> {
  const r = await client.query<AssignmentRow>(
    `SELECT sa.id, sa.shift_id, sa.assignment_date::text AS assignment_date,
            sa.employee_id, sa.presence_status, sa.present_started_at,
            sa.absent_reason, sa.absent_remark,
            sa.override_time_start::text AS override_time_start,
            sa.override_time_end::text AS override_time_end,
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
     WHERE sa.id = $1`,
    [id],
  )
  return r.rows[0]
}

const router = Router()
router.use(requireAuth)

const LIST_SQL = `
SELECT sa.id, sa.shift_id, sa.assignment_date::text AS assignment_date,
       sa.employee_id, sa.presence_status, sa.present_started_at,
       sa.absent_reason, sa.absent_remark,
       sa.override_time_start::text AS override_time_start,
       sa.override_time_end::text AS override_time_end,
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

router.get('/', async (req, res) => {
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

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  let siteFilter: string | null = null
  const params: unknown[] = [dateFrom, dateTo]

  if (auth.role === 'admin') {
    siteFilter = ''
  } else {
    const allowed = accessibleSiteIds(scope)
    if (allowed === null || allowed.length === 0) {
      res.json({ shift_assignments: [] })
      return
    }
    siteFilter = ` AND sh.site_id = ANY($3::uuid[])`
    params.push(allowed)
  }

  const r = await pool.query<AssignmentRow>(
    `${LIST_SQL}
     WHERE sa.assignment_date >= $1::date AND sa.assignment_date <= $2::date
     ${siteFilter}
     ORDER BY sa.assignment_date ASC, sh.key ASC, e.name ASC`,
    params,
  )
  res.json({ shift_assignments: r.rows })
})

router.post('/', async (req, res) => {
  const shiftId =
    typeof req.body?.shift_id === 'string' ? req.body.shift_id.trim() : ''
  const employeeId =
    typeof req.body?.employee_id === 'string'
      ? req.body.employee_id.trim()
      : ''
  const adRaw =
    typeof req.body?.assignment_date === 'string'
      ? req.body.assignment_date.trim()
      : ''

  if (!UUID_RE.test(shiftId) || !UUID_RE.test(employeeId)) {
    res.status(400).json({ error: 'Valid shift_id and employee_id are required.' })
    return
  }
  if (!DATE_RE.test(adRaw)) {
    res.status(400).json({ error: 'assignment_date must be YYYY-MM-DD.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sh = await client.query<{ site_id: string }>(
      `SELECT site_id FROM shifts WHERE id = $1 FOR UPDATE`,
      [shiftId],
    )
    const shiftSite = sh.rows[0]?.site_id
    if (!shiftSite || !canAccessSite(scope, shiftSite)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Shift not found.' })
      return
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO shift_assignments (shift_id, assignment_date, employee_id, created_by)
       VALUES ($1, $2::date, $3, $4)
       RETURNING id`,
      [shiftId, adRaw, employeeId, auth.id],
    )
    const newId = ins.rows[0]?.id
    if (!newId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }

    const tableRow = await client.query<AssignmentTableRow>(
      `SELECT id, shift_id, assignment_date::text AS assignment_date, employee_id,
              presence_status, present_started_at, absent_reason, absent_remark,
              created_at, updated_at, created_by, updated_by
       FROM shift_assignments WHERE id = $1`,
      [newId],
    )
    const persisted = tableRow.rows[0]!
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'shift_assignment',
      resourceId: persisted.id,
      beforeState: null,
      afterState: redactForAudit('shift_assignment', rowToAuditRecord(persisted)),
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const row = await fetchAssignmentRow(client, newId)
    await client.query('COMMIT')
    res.status(201).json({ shift_assignment: row! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'This employee is already assigned to this shift on that date.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid assignment id.' })
    return
  }

  const psRaw = req.body?.presence_status
  if (typeof psRaw !== 'string' || !PRESENCE.has(psRaw)) {
    res.status(400).json({
      error:
        'presence_status must be one of: scheduled, present, not_present, absent.',
    })
    return
  }
  const presence_status = psRaw

  let absent_reason: string | null =
    typeof req.body?.absent_reason === 'string'
      ? req.body.absent_reason.trim()
      : null
  if (absent_reason === '') absent_reason = null

  const absent_remark =
    typeof req.body?.absent_remark === 'string'
      ? req.body.absent_remark.trim().slice(0, 2000)
      : null

  if (presence_status === 'absent') {
    if (!absent_reason || !ABSENT_REASONS.has(absent_reason)) {
      res.status(400).json({
        error: 'absent_reason is required for absent status (sick, holiday, unknown).',
      })
      return
    }
  } else {
    absent_reason = null
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssignmentRow>(
      `${LIST_SQL} WHERE sa.id = $1 FOR UPDATE`,
      [id],
    )
    const beforeJoin = prev.rows[0]
    if (!beforeJoin || !canAccessSite(scope, beforeJoin.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Assignment not found.' })
      return
    }

    const prevTable = await client.query<AssignmentTableRow>(
      `SELECT id, shift_id, assignment_date::text AS assignment_date, employee_id,
              presence_status, present_started_at, absent_reason, absent_remark,
              override_time_start::text AS override_time_start,
              override_time_end::text AS override_time_end,
              created_at, updated_at, created_by, updated_by
       FROM shift_assignments WHERE id = $1`,
      [id],
    )
    const beforeRow = prevTable.rows[0]!

    const shiftSettings = await getShiftAppSettings(client)
    const bodyRaw = req.body as Record<string, unknown>
    const hasOvStart = Object.prototype.hasOwnProperty.call(
      bodyRaw,
      'override_time_start',
    )
    const hasOvEnd = Object.prototype.hasOwnProperty.call(
      bodyRaw,
      'override_time_end',
    )
    if (hasOvStart !== hasOvEnd) {
      await client.query('ROLLBACK')
      res.status(400).json({
        error:
          'Send both override_time_start and override_time_end together, or neither.',
      })
      return
    }

    let ovStartOut: string | null = beforeRow.override_time_start
    let ovEndOut: string | null = beforeRow.override_time_end
    if (presence_status !== 'scheduled') {
      ovStartOut = null
      ovEndOut = null
    } else if (hasOvStart) {
      const vs = bodyRaw.override_time_start
      const ve = bodyRaw.override_time_end
      if (vs === null && ve === null) {
        ovStartOut = null
        ovEndOut = null
      } else if (typeof vs === 'string' && typeof ve === 'string') {
        const ns = normalizeTimeHmsForPg(vs)
        const ne = normalizeTimeHmsForPg(ve)
        if (!ns || !ne) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'override_time_start and override_time_end must be HH:MM or HH:MM:SS (24h).',
          })
          return
        }
        const shiftDefR = await client.query<{ ts: string; te: string }>(
          `SELECT time_start::text AS ts, time_end::text AS te
           FROM shifts WHERE id = $1 FOR UPDATE`,
          [beforeRow.shift_id],
        )
        const def = shiftDefR.rows[0]
        if (!def) {
          await client.query('ROLLBACK')
          res.status(404).json({ error: 'Shift not found.' })
          return
        }
        const defStart = normalizeTimeHmsForPg(
          String(def.ts).trim().split('.')[0] ?? '',
        )
        const defEnd = normalizeTimeHmsForPg(
          String(def.te).trim().split('.')[0] ?? '',
        )
        if (!defStart || !defEnd) {
          await client.query('ROLLBACK')
          res.status(500).json({ error: 'Shift definition times are invalid.' })
          return
        }
        const defOvernight =
          timeHmsToMinutes(defEnd) <= timeHmsToMinutes(defStart)
        const nsMin = timeHmsToMinutes(ns)
        const neMin = timeHmsToMinutes(ne)
        if (nsMin === neMin) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'override_time_start and override_time_end must differ (zero-length interval).',
          })
          return
        }
        if (!defOvernight) {
          if (neMin <= nsMin) {
            await client.query('ROLLBACK')
            res.status(400).json({
              error:
                'override_time_end must be after override_time_start (same calendar day).',
            })
            return
          }
        }
        const dsMin = timeHmsToMinutes(defStart)
        const deMin = timeHmsToMinutes(defEnd)
        if (shiftSettings.shift_bound_projection) {
          if (
            !overrideWithinShiftDefWallClock(
              nsMin,
              neMin,
              dsMin,
              deMin,
              defOvernight,
            )
          ) {
            await client.query('ROLLBACK')
            res.status(400).json({
              error:
                'With SBPR (shift bound projection) on, start and end must stay within the shift definition (no earlier start or later end than the shift).',
            })
            return
          }
        }
        ovStartOut = ns
        ovEndOut = ne
      } else {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'override_time_start and override_time_end must be strings or both null.',
        })
        return
      }
    }

    const adMoveRaw = req.body?.assignment_date
    const wantsDateMove =
      adMoveRaw !== undefined &&
      adMoveRaw !== null &&
      String(adMoveRaw).trim() !== ''

    let nextDate = beforeRow.assignment_date
    if (wantsDateMove) {
      const nd =
        typeof adMoveRaw === 'string' ? adMoveRaw.trim() : String(adMoveRaw)
      if (!DATE_RE.test(nd)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'assignment_date must be YYYY-MM-DD.' })
        return
      }
      nextDate = nd
    }

    const shiftMoveRaw = req.body?.shift_id
    const wantsShiftMove =
      typeof shiftMoveRaw === 'string' && shiftMoveRaw.trim() !== ''

    let nextShiftId = beforeRow.shift_id
    if (wantsShiftMove) {
      const sid = shiftMoveRaw.trim()
      if (!UUID_RE.test(sid)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'shift_id must be a valid UUID.' })
        return
      }
      nextShiftId = sid
    }

    const geometryChanged =
      nextDate !== beforeRow.assignment_date ||
      nextShiftId !== beforeRow.shift_id

    if (geometryChanged) {
      if (beforeRow.presence_status !== 'scheduled') {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'Only scheduled assignments can be moved to another date or shift.',
        })
        return
      }
      if (presence_status !== 'scheduled') {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'When moving assignment_date or shift_id, presence_status must be scheduled.',
        })
        return
      }
      const curR = await client.query<{ d: string }>(
        `SELECT CURRENT_DATE::text AS d`,
      )
      const today = curR.rows[0]?.d ?? ''
      if (nextDate < today) {
        await client.query('ROLLBACK')
        res
          .status(400)
          .json({ error: 'assignment_date cannot be in the past.' })
        return
      }
      const targetShiftR = await client.query<{
        site_id: string
        available_weekdays: number[]
      }>(
        `SELECT site_id, available_weekdays FROM shifts WHERE id = $1 FOR UPDATE`,
        [nextShiftId],
      )
      const targetShift = targetShiftR.rows[0]
      if (!targetShift || !canAccessSite(scope, targetShift.site_id)) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Shift not found.' })
        return
      }
      const dowR = await client.query<{ iw: number }>(
        `SELECT EXTRACT(ISODOW FROM $1::date)::int AS iw`,
        [nextDate],
      )
      const iw = dowR.rows[0]?.iw
      const wds = targetShift.available_weekdays.map((x) => Number(x))
      if (iw === undefined || !wds.includes(iw)) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'That shift does not run on the chosen weekday.',
        })
        return
      }
      const dup = await client.query(
        `SELECT 1 FROM shift_assignments
         WHERE shift_id = $1 AND employee_id = $2 AND assignment_date = $3::date AND id <> $4`,
        [nextShiftId, beforeRow.employee_id, nextDate, id],
      )
      if ((dup.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK')
        res.status(409).json({
          error: 'This employee is already assigned to this shift on that date.',
        })
        return
      }
    }

    const assignmentDateOut = nextDate

    if (nextShiftId !== beforeRow.shift_id) {
      ovStartOut = null
      ovEndOut = null
    }

    let present_started_at: Date | null = beforeRow.present_started_at
    if (presence_status === 'present') {
      present_started_at = present_started_at ?? new Date()
    } else if (presence_status === 'absent') {
      present_started_at = null
    } else if (presence_status === 'scheduled') {
      present_started_at = null
    }

    const absentRemarkFinal =
      presence_status === 'absent' ? absent_remark : null

    const upd = await client.query<AssignmentTableRow>(
      `UPDATE shift_assignments SET
         shift_id = $10::uuid,
         assignment_date = $7::date,
         presence_status = $1,
         present_started_at = $2,
         absent_reason = $3,
         absent_remark = $4,
         override_time_start = $8::time,
         override_time_end = $9::time,
         updated_at = now(),
         updated_by = $5
       WHERE id = $6
       RETURNING id, shift_id, assignment_date::text AS assignment_date, employee_id,
         presence_status, present_started_at, absent_reason, absent_remark,
         override_time_start::text AS override_time_start,
         override_time_end::text AS override_time_end,
         created_at, updated_at, created_by, updated_by`,
      [
        presence_status,
        present_started_at,
        absent_reason,
        absentRemarkFinal,
        auth.id,
        id,
        assignmentDateOut,
        ovStartOut,
        ovEndOut,
        nextShiftId,
      ],
    )
    const afterRow = upd.rows[0]!
    const beforeState = redactForAudit(
      'shift_assignment',
      rowToAuditRecord(beforeRow),
    )
    const afterState = redactForAudit(
      'shift_assignment',
      rowToAuditRecord(afterRow),
    )
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'shift_assignment',
      resourceId: id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const row = await fetchAssignmentRow(client, id)
    await client.query('COMMIT')
    res.json({ shift_assignment: row! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid assignment id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssignmentRow>(
      `${LIST_SQL} WHERE sa.id = $1 FOR UPDATE`,
      [id],
    )
    const joinRow = prev.rows[0]
    if (!joinRow || !canAccessSite(scope, joinRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Assignment not found.' })
      return
    }

    const prevTable = await client.query<AssignmentTableRow>(
      `SELECT id, shift_id, assignment_date::text AS assignment_date, employee_id,
              presence_status, present_started_at, absent_reason, absent_remark,
              created_at, updated_at, created_by, updated_by
       FROM shift_assignments WHERE id = $1`,
      [id],
    )
    const beforeRow = prevTable.rows[0]!

    await client.query(`DELETE FROM shift_assignments WHERE id = $1`, [id])

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'shift_assignment',
      resourceId: id,
      beforeState: redactForAudit(
        'shift_assignment',
        rowToAuditRecord(beforeRow),
      ),
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

export default router
