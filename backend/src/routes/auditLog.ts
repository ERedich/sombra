import { Router } from 'express'
import {
  collectUuids,
  enrichAuditJson,
  resolveLabels,
} from '../audit/auditDisplayEnrich.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

type AuditRow = {
  id: string
  occurred_at: Date
  actor_user_id: string | null
  actor_key: string
  actor_name: string
  operation: string
  resource_type: string
  resource_id: string | null
  before_state: unknown
  after_state: unknown
  field_changes: unknown
  http_method: string
  path: string
}

const router = Router()
router.use(requireAuth)
router.use(requireAdmin)

router.get('/', async (req, res) => {
  const limitRaw = req.query.limit
  const offsetRaw = req.query.offset
  let limit = 50
  if (typeof limitRaw === 'string' && limitRaw !== '') {
    const n = parseInt(limitRaw, 10)
    if (!Number.isNaN(n) && n > 0) limit = Math.min(n, 200)
  }
  let offset = 0
  if (typeof offsetRaw === 'string' && offsetRaw !== '') {
    const n = parseInt(offsetRaw, 10)
    if (!Number.isNaN(n) && n >= 0) offset = n
  }

  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  const resourceType = req.query.resource_type
  if (typeof resourceType === 'string' && resourceType.trim() !== '') {
    conditions.push(`resource_type = $${p++}`)
    params.push(resourceType.trim())
  }
  const resourceId = req.query.resource_id
  if (typeof resourceId === 'string' && resourceId.trim() !== '') {
    conditions.push(`resource_id = $${p++}`)
    params.push(resourceId.trim())
  }
  const actorUserId = req.query.actor_user_id
  if (typeof actorUserId === 'string' && actorUserId.trim() !== '') {
    conditions.push(`actor_user_id = $${p++}::uuid`)
    params.push(actorUserId.trim())
  }
  const from = req.query.from
  if (typeof from === 'string' && from.trim() !== '') {
    conditions.push(`occurred_at >= $${p++}::timestamptz`)
    params.push(from.trim())
  }
  const to = req.query.to
  if (typeof to === 'string' && to.trim() !== '') {
    conditions.push(`occurred_at <= $${p++}::timestamptz`)
    params.push(to.trim())
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countR = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_log ${where}`,
    params,
  )
  const total = parseInt(countR.rows[0]?.count ?? '0', 10)

  params.push(limit, offset)
  const listR = await pool.query<AuditRow>(
    `SELECT id, occurred_at, actor_user_id, actor_key, actor_name, operation,
            resource_type, resource_id, before_state, after_state, field_changes,
            http_method, path
     FROM audit_log
     ${where}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params,
  )

  const allIds = new Set<string>()
  for (const row of listR.rows) {
    if (row.resource_id) allIds.add(row.resource_id)
    if (row.actor_user_id) allIds.add(row.actor_user_id)
    collectUuids(row.before_state, allIds)
    collectUuids(row.after_state, allIds)
    collectUuids(row.field_changes, allIds)
  }
  const labelMap = await resolveLabels(pool, [...allIds])

  const entries = listR.rows.map((row) => {
    const enriched = enrichAuditJson(row, labelMap)
    return {
      ...row,
      before_state: enriched.before_state,
      after_state: enriched.after_state,
      field_changes: enriched.field_changes,
      resource_id_label: enriched.resource_id_label,
    }
  })

  res.json({
    entries,
    total,
    limit,
    offset,
  })
})

export default router
