import { Router } from 'express'
import { accessibleSiteIds, loadUserSiteScope } from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseHours(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : NaN
  if (!Number.isFinite(n) || n <= 0) return 24
  return Math.min(168, Math.max(1, Math.floor(n)))
}

router.get('/', async (req, res) => {
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const hours = parseHours(req.query.hours)
  if (auth.role === 'admin') {
    const r = await pool.query<{
      id: string
      user_id: string
      work_order_id: string
      kind: string
      message: string
      payload_json: Record<string, unknown>
      created_at: Date
      read_at: Date | null
    }>(
      `SELECT id, user_id, work_order_id, kind, message, payload_json, created_at, read_at
       FROM work_order_notifications
       WHERE user_id = $1::uuid
         AND created_at >= now() - make_interval(hours => $2::int)
       ORDER BY created_at DESC
       LIMIT 200`,
      [auth.id, hours],
    )
    res.json({ notifications: r.rows, hours })
    return
  }
  const allowed = accessibleSiteIds(scope)
  if (!allowed || allowed.length === 0) {
    res.json({ notifications: [], hours })
    return
  }
  const r = await pool.query<{
    id: string
    user_id: string
    work_order_id: string
    kind: string
    message: string
    payload_json: Record<string, unknown>
    created_at: Date
    read_at: Date | null
  }>(
    `SELECT n.id, n.user_id, n.work_order_id, n.kind, n.message, n.payload_json, n.created_at, n.read_at
     FROM work_order_notifications n
     INNER JOIN work_orders w ON w.id = n.work_order_id
     WHERE n.user_id = $1::uuid
       AND w.site_id = ANY($2::uuid[])
       AND n.created_at >= now() - make_interval(hours => $3::int)
     ORDER BY n.created_at DESC
     LIMIT 200`,
    [auth.id, allowed, hours],
  )
  res.json({ notifications: r.rows, hours })
})

router.get('/unread-count', async (req, res) => {
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  if (auth.role === 'admin') {
    const r = await pool.query<{ unread_count: string }>(
      `SELECT COUNT(*)::bigint::text AS unread_count
       FROM work_order_notifications
       WHERE user_id = $1::uuid
         AND read_at IS NULL`,
      [auth.id],
    )
    res.json({ unread_count: Number(r.rows[0]?.unread_count ?? '0') })
    return
  }
  const allowed = accessibleSiteIds(scope)
  if (!allowed || allowed.length === 0) {
    res.json({ unread_count: 0 })
    return
  }
  const r = await pool.query<{ unread_count: string }>(
    `SELECT COUNT(*)::bigint::text AS unread_count
     FROM work_order_notifications n
     INNER JOIN work_orders w ON w.id = n.work_order_id
     WHERE n.user_id = $1::uuid
       AND n.read_at IS NULL
       AND w.site_id = ANY($2::uuid[])`,
    [auth.id, allowed],
  )
  res.json({ unread_count: Number(r.rows[0]?.unread_count ?? '0') })
})

router.post('/mark-read-visible', async (req, res) => {
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const idsRaw: unknown[] = Array.isArray(req.body?.notification_ids)
    ? req.body.notification_ids
    : []
  if (
    idsRaw.some((id) => typeof id !== 'string' || !UUID_RE.test((id as string).trim()))
  ) {
    res.status(400).json({ error: 'notification_ids must be UUIDs.' })
    return
  }
  const ids = idsRaw.map((id) => (id as string).trim())
  const hours = parseHours(req.body?.hours)
  if (auth.role === 'admin') {
    const r = await pool.query<{ id: string }>(
      `UPDATE work_order_notifications
       SET read_at = now()
       WHERE user_id = $1::uuid
         AND read_at IS NULL
         AND (
           ($2::uuid[] IS NOT NULL AND array_length($2::uuid[], 1) > 0 AND id = ANY($2::uuid[]))
           OR
           (($2::uuid[] IS NULL OR array_length($2::uuid[], 1) IS NULL)
             AND created_at >= now() - make_interval(hours => $3::int))
         )
       RETURNING id`,
      [auth.id, ids.length > 0 ? ids : null, hours],
    )
    res.json({ ok: true, updated_count: r.rowCount ?? 0 })
    return
  }
  const allowed = accessibleSiteIds(scope)
  if (!allowed || allowed.length === 0) {
    res.json({ ok: true, updated_count: 0 })
    return
  }
  const r = await pool.query<{ id: string }>(
    `UPDATE work_order_notifications n
     SET read_at = now()
     FROM work_orders w
     WHERE n.work_order_id = w.id
       AND n.user_id = $1::uuid
       AND n.read_at IS NULL
       AND w.site_id = ANY($2::uuid[])
       AND (
         ($3::uuid[] IS NOT NULL AND array_length($3::uuid[], 1) > 0 AND n.id = ANY($3::uuid[]))
         OR
         (($3::uuid[] IS NULL OR array_length($3::uuid[], 1) IS NULL)
           AND n.created_at >= now() - make_interval(hours => $4::int))
       )
     RETURNING n.id`,
    [auth.id, allowed, ids.length > 0 ? ids : null, hours],
  )
  res.json({ ok: true, updated_count: r.rowCount ?? 0 })
})

export default router
