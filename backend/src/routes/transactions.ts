import { Router } from 'express'
import {
  accessibleSiteIds,
  canAccessSite,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TransactionListRow = {
  id: string
  work_order_id: string
  wo_key: number
  site_id: string
  site_key: string
  site_name: string
  type: string
  employee_id: string
  employee_key: string
  employee_name: string
  created_by_user_id: string
  created_by_login_name: string | null
  hours: string
  feedback_text: string
  created_at: Date
}

const LIST_SQL = `
SELECT t.id, t.work_order_id, w.wo_key, w.site_id,
       st.key AS site_key, st.name AS site_name,
       t.type, t.employee_id, e.key AS employee_key, e.name AS employee_name,
       t.created_by_user_id, u.login_name AS created_by_login_name,
       t.hours, t.feedback_text, t.created_at
FROM transactions t
INNER JOIN work_orders w ON w.id = t.work_order_id
INNER JOIN sites st ON st.id = w.site_id
INNER JOIN employees e ON e.id = t.employee_id
INNER JOIN users u ON u.id = t.created_by_user_id
`

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const auth = req.authUser!
  const typeRaw = typeof req.query.type === 'string' ? req.query.type.trim() : 'INT'
  if (typeRaw !== 'INT') {
    res.status(400).json({ error: 'type must be INT.' })
    return
  }
  const woFilter =
    typeof req.query.work_order_id === 'string' && UUID_RE.test(req.query.work_order_id.trim())
      ? req.query.work_order_id.trim()
      : null

  if (auth.role === 'admin') {
    const params: unknown[] = [typeRaw]
    let sql = `${LIST_SQL} WHERE t.type = $1`
    if (woFilter) {
      sql += ` AND t.work_order_id = $2`
      params.push(woFilter)
    }
    sql += ` ORDER BY t.created_at DESC, t.id DESC`
    const r = await pool.query<TransactionListRow>(sql, params)
    res.json({ transactions: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ transactions: [] })
    return
  }
  const params: unknown[] = [typeRaw, allowed]
  let sql = `${LIST_SQL} WHERE t.type = $1 AND w.site_id = ANY($2::uuid[])`
  if (woFilter) {
    sql += ` AND t.work_order_id = $3`
    params.push(woFilter)
  }
  sql += ` ORDER BY t.created_at DESC, t.id DESC`
  const r = await pool.query<TransactionListRow>(sql, params)
  res.json({ transactions: r.rows })
})

router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid transaction id.' })
    return
  }
  const auth = req.authUser!
  const r = await pool.query<TransactionListRow>(
    `${LIST_SQL} WHERE t.id = $1`,
    [id],
  )
  const row = r.rows[0]
  if (!row) {
    res.status(404).json({ error: 'Transaction not found.' })
    return
  }
  if (auth.role !== 'admin') {
    const scope = await loadUserSiteScope(pool, auth.id, auth.role)
    if (!canAccessSite(scope, row.site_id)) {
      res.status(404).json({ error: 'Transaction not found.' })
      return
    }
  }
  res.json({ transaction: row })
})

export default router
