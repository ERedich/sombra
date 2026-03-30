import { Router } from 'express'
import type { Response } from 'express'
import multer from 'multer'
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function routeParamId(
  id: string | string[] | undefined,
): string {
  if (typeof id === 'string') return id
  if (Array.isArray(id)) return id[0] ?? ''
  return ''
}

const ASSET_TYPES = new Set([
  'location',
  'building',
  'group',
  'maintenance_object',
])

const THUMBNAIL_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

type AssetTableRow = {
  id: string
  site_id: string
  asset_type: string
  key: string
  name: string
  asset_classification_id: string | null
  parent_asset_id: string | null
  costcenter_id: string | null
  equipment_number: string | null
  serial_no: string | null
  build_year: number | null
  warranty_end: Date | null
  priority: number | null
  thumbnail_data: Buffer | null
  thumbnail_mime_type: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

type AssetRow = Omit<AssetTableRow, 'thumbnail_data'> & {
  has_thumbnail: boolean
  site_key: string
  site_name: string
  site_colour: string
  asset_classification_key: string | null
  asset_classification_name: string | null
  costcenter_key: string | null
  costcenter_name: string | null
  parent_asset_key: string | null
  parent_asset_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

function workingSiteIdOr403(res: Response, auth: AuthUser): string | null {
  const wid = auth.working_site_id
  if (!wid || !UUID_RE.test(wid)) {
    res.status(403).json({
      error:
        'No working site is set. Sign out and sign in again, or pick a site at login.',
    })
    return null
  }
  return wid
}

function parseOptionalUuid(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '') return null
  return UUID_RE.test(s) ? s : undefined
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function rowToAuditRecord(row: AssetTableRow): Record<string, unknown> {
  const { thumbnail_data, ...rest } = row
  const hasThumb =
    thumbnail_data != null &&
    Buffer.isBuffer(thumbnail_data) &&
    thumbnail_data.length > 0
  return {
    ...(rest as unknown as Record<string, unknown>),
    thumbnail_present: hasThumb,
  }
}

async function fetchAssetWithJoins(
  client: PoolClient,
  id: string,
): Promise<AssetRow | undefined> {
  const r = await client.query<AssetRow>(
    `SELECT a.id, a.site_id, a.asset_type, a.key, a.name, a.asset_classification_id, a.parent_asset_id,
            a.costcenter_id, a.equipment_number, a.serial_no, a.build_year, a.warranty_end, a.priority,
            (a.thumbnail_data IS NOT NULL) AS has_thumbnail,
            a.created_at, a.updated_at, a.created_by, a.updated_by,
            st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
            ac.key AS asset_classification_key, ac.name AS asset_classification_name,
            cc.key AS costcenter_key, cc.name AS costcenter_name,
            pa.key AS parent_asset_key, pa.name AS parent_asset_name,
            cb.login_name AS created_by_login_name,
            ub.login_name AS updated_by_login_name
     FROM assets a
     INNER JOIN sites st ON st.id = a.site_id
     LEFT JOIN asset_classifications ac ON ac.id = a.asset_classification_id
     LEFT JOIN costcenters cc ON cc.id = a.costcenter_id
     LEFT JOIN assets pa ON pa.id = a.parent_asset_id
     LEFT JOIN users cb ON cb.id = a.created_by
     LEFT JOIN users ub ON ub.id = a.updated_by
     WHERE a.id = $1`,
    [id],
  )
  return r.rows[0]
}

async function getParentAssetId(
  client: PoolClient,
  id: string,
): Promise<string | null> {
  const r = await client.query<{ parent_asset_id: string | null }>(
    `SELECT parent_asset_id FROM assets WHERE id = $1`,
    [id],
  )
  return r.rows[0]?.parent_asset_id ?? null
}

/** Walk up from newParentId; if we reach assetId, new parent is under assetId (cycle). */
async function parentWouldCreateCycle(
  client: PoolClient,
  assetId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (newParentId === null) return false
  if (newParentId === assetId) return true
  let current: string | null = newParentId
  const guard = new Set<string>()
  while (current) {
    if (current === assetId) return true
    if (guard.has(current)) return true
    guard.add(current)
    current = await getParentAssetId(client, current)
  }
  return false
}

const LIST_FROM = `
FROM assets a
INNER JOIN sites st ON st.id = a.site_id
LEFT JOIN asset_classifications ac ON ac.id = a.asset_classification_id
LEFT JOIN costcenters cc ON cc.id = a.costcenter_id
LEFT JOIN assets pa ON pa.id = a.parent_asset_id
LEFT JOIN users cb ON cb.id = a.created_by
LEFT JOIN users ub ON ub.id = a.updated_by
`

const LIST_SQL = `
SELECT a.id, a.site_id, a.asset_type, a.key, a.name, a.asset_classification_id, a.parent_asset_id,
       a.costcenter_id, a.equipment_number, a.serial_no, a.build_year, a.warranty_end, a.priority,
       (a.thumbnail_data IS NOT NULL) AS has_thumbnail,
       a.created_at, a.updated_at, a.created_by, a.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       ac.key AS asset_classification_key, ac.name AS asset_classification_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       pa.key AS parent_asset_key, pa.name AS parent_asset_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
${LIST_FROM}
`

const MAX_ASSET_PAGE = 100
const DEFAULT_ASSET_PAGE = 50

function parseAssetPageLimit(v: unknown): number | null {
  if (v === undefined || v === null) return null
  const s = Array.isArray(v) ? v[0] : v
  if (typeof s !== 'string' && typeof s !== 'number') return null
  const n = typeof s === 'number' ? s : parseInt(String(s), 10)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(n, MAX_ASSET_PAGE)
}

function parseAssetPageOffset(v: unknown): number {
  if (v === undefined || v === null) return 0
  const s = Array.isArray(v) ? v[0] : v
  const n = typeof s === 'number' ? s : parseInt(String(s), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/** Escape `%`, `_`, `\` for PostgreSQL LIKE / ILIKE with ESCAPE '\\'. */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Optional search across key fields (used when `limit` is set — picker pagination). */
function assetSearchSqlAndParam(
  q: string,
  likeParamIndex: number,
): { sql: string; param: string } | null {
  const trimmed = q.trim()
  if (!trimmed) return null
  const pat = `%${escapeLikePattern(trimmed)}%`
  const p = `$${likeParamIndex}`
  const sql = ` AND (
    a.key ILIKE ${p} ESCAPE '\\'
    OR a.name ILIKE ${p} ESCAPE '\\'
    OR st.key ILIKE ${p} ESCAPE '\\'
    OR st.name ILIKE ${p} ESCAPE '\\'
    OR COALESCE(ac.key, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(ac.name, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(cc.key, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(cc.name, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(pa.key, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(pa.name, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(a.equipment_number, '') ILIKE ${p} ESCAPE '\\'
    OR COALESCE(a.serial_no, '') ILIKE ${p} ESCAPE '\\'
    OR a.asset_type::text ILIKE ${p} ESCAPE '\\'
  )`
  return { sql, param: pat }
}

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const auth = req.authUser!
  const pageLimit = parseAssetPageLimit(req.query.limit)
  const pageOffset = parseAssetPageOffset(req.query.offset)
  const qRaw = typeof req.query.q === 'string' ? req.query.q : ''

  const orderBy = `ORDER BY st.name ASC, st.key ASC, a.name ASC, a.key ASC`

  if (pageLimit != null) {
    const limit = pageLimit > 0 ? pageLimit : DEFAULT_ASSET_PAGE

    if (auth.role === 'admin') {
      const search = assetSearchSqlAndParam(qRaw, 1)
      if (search) {
        const countSql = `SELECT COUNT(*)::bigint AS n FROM (
          SELECT a.id
          ${LIST_FROM}
          WHERE TRUE
          ${search.sql}
        ) c`
        const cnt = await pool.query<{ n: string }>(countSql, [search.param])
        const total = Number(cnt.rows[0]?.n ?? 0)
        const r = await pool.query<AssetRow>(
          `${LIST_SQL} WHERE TRUE ${search.sql} ${orderBy} LIMIT $2 OFFSET $3`,
          [search.param, limit, pageOffset],
        )
        res.json({ assets: r.rows, total })
        return
      }
      const countSql = `SELECT COUNT(*)::bigint AS n FROM (
        SELECT a.id ${LIST_FROM}
      ) c`
      const cnt = await pool.query<{ n: string }>(countSql)
      const total = Number(cnt.rows[0]?.n ?? 0)
      const r = await pool.query<AssetRow>(
        `${LIST_SQL} ${orderBy} LIMIT $1 OFFSET $2`,
        [limit, pageOffset],
      )
      res.json({ assets: r.rows, total })
      return
    }

    const scope = await loadUserSiteScope(pool, auth.id, auth.role)
    const allowed = accessibleSiteIds(scope)
    if (allowed === null || allowed.length === 0) {
      res.json({ assets: [], total: 0 })
      return
    }

    const search = assetSearchSqlAndParam(qRaw, 2)
    if (search) {
      const countSql = `SELECT COUNT(*)::bigint AS n FROM (
        SELECT a.id
        ${LIST_FROM}
        WHERE a.site_id = ANY($1::uuid[])
        ${search.sql}
      ) c`
      const cnt = await pool.query<{ n: string }>(countSql, [
        allowed,
        search.param,
      ])
      const total = Number(cnt.rows[0]?.n ?? 0)
      const r = await pool.query<AssetRow>(
        `${LIST_SQL} WHERE a.site_id = ANY($1::uuid[]) ${search.sql} ${orderBy} LIMIT $3 OFFSET $4`,
        [allowed, search.param, limit, pageOffset],
      )
      res.json({ assets: r.rows, total })
      return
    }

    const countSql = `SELECT COUNT(*)::bigint AS n FROM (
      SELECT a.id
      ${LIST_FROM}
      WHERE a.site_id = ANY($1::uuid[])
    ) c`
    const cnt = await pool.query<{ n: string }>(countSql, [allowed])
    const total = Number(cnt.rows[0]?.n ?? 0)
    const r = await pool.query<AssetRow>(
      `${LIST_SQL} WHERE a.site_id = ANY($1::uuid[]) ${orderBy} LIMIT $2 OFFSET $3`,
      [allowed, limit, pageOffset],
    )
    res.json({ assets: r.rows, total })
    return
  }

  if (auth.role === 'admin') {
    const r = await pool.query<AssetRow>(
      `${LIST_SQL} ${orderBy}`,
    )
    res.json({ assets: r.rows })
    return
  }
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = accessibleSiteIds(scope)
  if (allowed === null || allowed.length === 0) {
    res.json({ assets: [] })
    return
  }
  const r = await pool.query<AssetRow>(
    `${LIST_SQL} WHERE a.site_id = ANY($1::uuid[])
     ${orderBy}`,
    [allowed],
  )
  res.json({ assets: r.rows })
})

router.get('/:id/thumbnail', async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<{
    site_id: string
    thumbnail_data: Buffer | null
    thumbnail_mime_type: string | null
  }>(
    `SELECT site_id, thumbnail_data, thumbnail_mime_type FROM assets WHERE id = $1`,
    [id],
  )
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Asset not found.' })
    return
  }
  if (!row.thumbnail_data || !row.thumbnail_mime_type) {
    res.status(404).json({ error: 'No thumbnail for this asset.' })
    return
  }
  res.setHeader('Content-Type', row.thumbnail_mime_type)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.send(row.thumbnail_data)
})

router.post('/:id/thumbnail', upload.single('file'), async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }
  const file = req.file
  if (!file?.buffer || !file.mimetype) {
    res.status(400).json({ error: 'Image file is required (field name: file).' })
    return
  }
  if (!THUMBNAIL_MIME.has(file.mimetype)) {
    res.status(400).json({
      error: 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.',
    })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssetTableRow>(
      `SELECT id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
              equipment_number, serial_no, build_year, warranty_end, priority,
              thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by
       FROM assets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Asset not found.' })
      return
    }

    const after = await client.query<AssetTableRow>(
      `UPDATE assets SET thumbnail_data = $1, thumbnail_mime_type = $2,
              updated_at = now(), updated_by = $3
       WHERE id = $4
       RETURNING id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
                 equipment_number, serial_no, build_year, warranty_end, priority,
                 thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by`,
      [file.buffer, file.mimetype, auth.id, id],
    )
    const afterTable = after.rows[0]!
    const beforeState = redactForAudit('asset', rowToAuditRecord(beforeRow))
    const afterState = redactForAudit('asset', rowToAuditRecord(afterTable))
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'asset',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const asset = await fetchAssetWithJoins(client, id)
    await client.query('COMMIT')
    res.status(200).json({ asset: asset! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id/thumbnail', async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssetTableRow>(
      `SELECT id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
              equipment_number, serial_no, build_year, warranty_end, priority,
              thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by
       FROM assets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Asset not found.' })
      return
    }

    const after = await client.query<AssetTableRow>(
      `UPDATE assets SET thumbnail_data = NULL, thumbnail_mime_type = NULL,
              updated_at = now(), updated_by = $1
       WHERE id = $2
       RETURNING id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
                 equipment_number, serial_no, build_year, warranty_end, priority,
                 thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by`,
      [auth.id, id],
    )
    const afterTable = after.rows[0]!
    const beforeState = redactForAudit('asset', rowToAuditRecord(beforeRow))
    const afterState = redactForAudit('asset', rowToAuditRecord(afterTable))
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'asset',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const asset = await fetchAssetWithJoins(client, id)
    await client.query('COMMIT')
    res.json({ asset: asset! })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

router.get('/:id', async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const r = await pool.query<AssetRow>(`${LIST_SQL} WHERE a.id = $1`, [id])
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Asset not found.' })
    return
  }
  res.json({ asset: row })
})

router.post('/', async (req, res) => {
  const key =
    typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const assetTypeRaw =
    typeof req.body?.asset_type === 'string'
      ? req.body.asset_type.trim()
      : ''
  if (!key || !name || !assetTypeRaw) {
    res.status(400).json({
      error: 'Key, name, and asset_type are required.',
    })
    return
  }
  if (!ASSET_TYPES.has(assetTypeRaw)) {
    res.status(400).json({ error: 'Invalid asset_type.' })
    return
  }

  const auth = req.authUser!
  const siteId = workingSiteIdOr403(res, auth)
  if (!siteId) return

  const parentIdParsed = parseOptionalUuid(req.body?.parent_asset_id)
  if (parentIdParsed === undefined) {
    res.status(400).json({ error: 'Invalid parent_asset_id.' })
    return
  }
  const costcenterIdParsed = parseOptionalUuid(req.body?.costcenter_id)
  if (costcenterIdParsed === undefined) {
    res.status(400).json({ error: 'Invalid costcenter_id.' })
    return
  }

  let classificationIdParsed: string | null = null
  if (req.body?.asset_classification_id !== undefined) {
    const p = parseOptionalUuid(req.body.asset_classification_id)
    if (p === undefined) {
      res.status(400).json({ error: 'Invalid asset_classification_id.' })
      return
    }
    classificationIdParsed = p
  }

  let equipmentNumber: string | null = null
  if (req.body?.equipment_number !== undefined) {
    if (req.body.equipment_number === null) {
      equipmentNumber = null
    } else if (typeof req.body.equipment_number === 'string') {
      equipmentNumber = req.body.equipment_number.trim() || null
    } else {
      res.status(400).json({ error: 'Invalid equipment_number.' })
      return
    }
  }

  let serialNo: string | null = null
  if (req.body?.serial_no !== undefined) {
    if (req.body.serial_no === null) {
      serialNo = null
    } else if (typeof req.body.serial_no === 'string') {
      serialNo = req.body.serial_no.trim() || null
    } else {
      res.status(400).json({ error: 'Invalid serial_no.' })
      return
    }
  }

  let buildYear: number | null = null
  if (req.body?.build_year !== undefined && req.body?.build_year !== null) {
    const y = Number(req.body.build_year)
    if (!Number.isInteger(y) || y < 1800 || y > 2100) {
      res.status(400).json({ error: 'build_year must be an integer 1800–2100.' })
      return
    }
    buildYear = y
  } else if (req.body?.build_year === null) {
    buildYear = null
  }

  let warrantyEnd: Date | null = null
  if (req.body?.warranty_end !== undefined && req.body?.warranty_end !== null) {
    const d = new Date(String(req.body.warranty_end))
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: 'Invalid warranty_end date.' })
      return
    }
    warrantyEnd = d
  } else if (req.body?.warranty_end === null) {
    warrantyEnd = null
  }

  let priority: number | null = null
  if (req.body?.priority !== undefined && req.body?.priority !== null) {
    const p = Number(req.body.priority)
    if (!Number.isInteger(p) || p < 1 || p > 5) {
      res.status(400).json({ error: 'priority must be an integer from 1 to 5.' })
      return
    }
    priority = p
  } else if (req.body?.priority === null) {
    priority = null
  }

  const auditPath = `${req.baseUrl}${req.path}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (parentIdParsed) {
      const pr = await client.query<{ site_id: string }>(
        `SELECT site_id FROM assets WHERE id = $1`,
        [parentIdParsed],
      )
      const pRow = pr.rows[0]
      if (!pRow || pRow.site_id !== siteId) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Parent asset must exist and belong to the same site.',
        })
        return
      }
    }

    if (costcenterIdParsed) {
      const cr = await client.query<{ site_id: string }>(
        `SELECT site_id FROM costcenters WHERE id = $1`,
        [costcenterIdParsed],
      )
      const cRow = cr.rows[0]
      if (!cRow || cRow.site_id !== siteId) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error: 'Cost center must exist and belong to the same site.',
        })
        return
      }
    }

    if (classificationIdParsed) {
      const acr = await client.query<{ site_id: string }>(
        `SELECT site_id FROM asset_classifications WHERE id = $1`,
        [classificationIdParsed],
      )
      const acRow = acr.rows[0]
      if (!acRow || acRow.site_id !== siteId) {
        await client.query('ROLLBACK')
        res.status(400).json({
          error:
            'Asset classification must exist and belong to the same site.',
        })
        return
      }
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO assets (
         site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
         equipment_number, serial_no, build_year, warranty_end, priority,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        siteId,
        assetTypeRaw,
        key,
        name,
        classificationIdParsed,
        parentIdParsed,
        costcenterIdParsed,
        equipmentNumber,
        serialNo,
        buildYear,
        warrantyEnd,
        priority,
        auth.id,
      ],
    )
    const insertedId = ins.rows[0]?.id
    if (!insertedId) {
      await client.query('ROLLBACK')
      res.status(500).json({ error: 'Insert failed.' })
      return
    }

    const tableRow = await client.query<AssetTableRow>(
      `SELECT id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
              equipment_number, serial_no, build_year, warranty_end, priority,
              thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by
       FROM assets WHERE id = $1`,
      [insertedId],
    )
    const persisted = tableRow.rows[0]!
    const afterState = redactForAudit('asset', rowToAuditRecord(persisted))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'create',
      resourceType: 'asset',
      resourceId: persisted.id,
      beforeState: null,
      afterState,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    const asset = await fetchAssetWithJoins(client, insertedId)
    await client.query('COMMIT')
    res.status(201).json({ asset: asset! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'An asset with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.patch('/:id', async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssetTableRow>(
      `SELECT id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
              equipment_number, serial_no, build_year, warranty_end, priority,
              thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by
       FROM assets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Asset not found.' })
      return
    }

    const siteId = beforeRow.site_id

    const updates: string[] = []
    const values: unknown[] = []
    let n = 1

    if (req.body?.key !== undefined) {
      const key =
        typeof req.body.key === 'string' ? req.body.key.trim() : ''
      if (!key) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Key cannot be empty.' })
        return
      }
      updates.push(`key = $${n++}`)
      values.push(key)
    }
    if (req.body?.name !== undefined) {
      const name =
        typeof req.body.name === 'string' ? req.body.name.trim() : ''
      if (!name) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Name cannot be empty.' })
        return
      }
      updates.push(`name = $${n++}`)
      values.push(name)
    }
    if (req.body?.asset_classification_id !== undefined) {
      const cid = parseOptionalUuid(req.body.asset_classification_id)
      if (cid === undefined) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid asset_classification_id.' })
        return
      }
      if (cid) {
        const acr = await client.query<{ site_id: string }>(
          `SELECT site_id FROM asset_classifications WHERE id = $1`,
          [cid],
        )
        const acRow = acr.rows[0]
        if (!acRow || acRow.site_id !== siteId) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error:
              'Asset classification must exist and belong to the same site.',
          })
          return
        }
      }
      updates.push(`asset_classification_id = $${n++}`)
      values.push(cid)
    }
    if (req.body?.asset_type !== undefined) {
      const at =
        typeof req.body.asset_type === 'string'
          ? req.body.asset_type.trim()
          : ''
      if (!ASSET_TYPES.has(at)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid asset_type.' })
        return
      }
      updates.push(`asset_type = $${n++}`)
      values.push(at)
    }
    if (req.body?.parent_asset_id !== undefined) {
      const pid = parseOptionalUuid(req.body.parent_asset_id)
      if (pid === undefined) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid parent_asset_id.' })
        return
      }
      if (pid) {
        const pr = await client.query<{ site_id: string }>(
          `SELECT site_id FROM assets WHERE id = $1`,
          [pid],
        )
        const pRow = pr.rows[0]
        if (!pRow || pRow.site_id !== siteId) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'Parent asset must exist and belong to the same site.',
          })
          return
        }
        if (await parentWouldCreateCycle(client, id, pid)) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'That parent would create a circular reference.',
          })
          return
        }
      }
      updates.push(`parent_asset_id = $${n++}`)
      values.push(pid)
    }
    if (req.body?.costcenter_id !== undefined) {
      const cid = parseOptionalUuid(req.body.costcenter_id)
      if (cid === undefined) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid costcenter_id.' })
        return
      }
      if (cid) {
        const cr = await client.query<{ site_id: string }>(
          `SELECT site_id FROM costcenters WHERE id = $1`,
          [cid],
        )
        const cRow = cr.rows[0]
        if (!cRow || cRow.site_id !== siteId) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'Cost center must exist and belong to the same site.',
          })
          return
        }
      }
      updates.push(`costcenter_id = $${n++}`)
      values.push(cid)
    }
    if (req.body?.equipment_number !== undefined) {
      if (req.body.equipment_number === null) {
        updates.push(`equipment_number = $${n++}`)
        values.push(null)
      } else if (typeof req.body.equipment_number === 'string') {
        updates.push(`equipment_number = $${n++}`)
        values.push(req.body.equipment_number.trim() || null)
      } else {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid equipment_number.' })
        return
      }
    }
    if (req.body?.serial_no !== undefined) {
      if (req.body.serial_no === null) {
        updates.push(`serial_no = $${n++}`)
        values.push(null)
      } else if (typeof req.body.serial_no === 'string') {
        updates.push(`serial_no = $${n++}`)
        values.push(req.body.serial_no.trim() || null)
      } else {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid serial_no.' })
        return
      }
    }
    if (req.body?.build_year !== undefined) {
      if (req.body.build_year === null) {
        updates.push(`build_year = $${n++}`)
        values.push(null)
      } else {
        const y = Number(req.body.build_year)
        if (!Number.isInteger(y) || y < 1800 || y > 2100) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'build_year must be an integer 1800–2100.',
          })
          return
        }
        updates.push(`build_year = $${n++}`)
        values.push(y)
      }
    }
    if (req.body?.warranty_end !== undefined) {
      if (req.body.warranty_end === null) {
        updates.push(`warranty_end = $${n++}`)
        values.push(null)
      } else {
        const d = new Date(String(req.body.warranty_end))
        if (Number.isNaN(d.getTime())) {
          await client.query('ROLLBACK')
          res.status(400).json({ error: 'Invalid warranty_end date.' })
          return
        }
        updates.push(`warranty_end = $${n++}`)
        values.push(d)
      }
    }
    if (req.body?.priority !== undefined) {
      if (req.body.priority === null) {
        updates.push(`priority = $${n++}`)
        values.push(null)
      } else {
        const p = Number(req.body.priority)
        if (!Number.isInteger(p) || p < 1 || p > 5) {
          await client.query('ROLLBACK')
          res.status(400).json({
            error: 'priority must be an integer from 1 to 5.',
          })
          return
        }
        updates.push(`priority = $${n++}`)
        values.push(p)
      }
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'No fields to update.' })
      return
    }

    updates.push(`updated_at = now()`)
    updates.push(`updated_by = $${n++}`)
    values.push(auth.id)
    values.push(id)

    const sql = `UPDATE assets SET ${updates.join(', ')}
                 WHERE id = $${n}
                 RETURNING id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
                           equipment_number, serial_no, build_year, warranty_end, priority,
                           thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by`

    const r = await client.query<AssetTableRow>(sql, values)
    const afterTable = r.rows[0]
    if (!afterTable) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Asset not found.' })
      return
    }

    const beforeState = redactForAudit('asset', rowToAuditRecord(beforeRow))
    const afterState = redactForAudit('asset', rowToAuditRecord(afterTable))
    const changes =
      beforeState && afterState ? fieldChanges(beforeState, afterState) : null

    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'update',
      resourceType: 'asset',
      resourceId: afterTable.id,
      beforeState,
      afterState,
      fieldChanges: changes,
      httpMethod: req.method,
      path: auditPath,
    })
    const asset = await fetchAssetWithJoins(client, afterTable.id)
    await client.query('COMMIT')
    res.json({ asset: asset! })
  } catch (e) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(e)) {
      res.status(409).json({
        error: 'An asset with this key already exists at this site.',
      })
      return
    }
    throw e
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const id = routeParamId(req.params.id)
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid asset id.' })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<AssetTableRow>(
      `SELECT id, site_id, asset_type, key, name, asset_classification_id, parent_asset_id, costcenter_id,
              equipment_number, serial_no, build_year, warranty_end, priority,
              thumbnail_data, thumbnail_mime_type, created_at, updated_at, created_by, updated_by
       FROM assets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Asset not found.' })
      return
    }

    await client.query(`DELETE FROM assets WHERE id = $1`, [id])

    const beforeState = redactForAudit('asset', rowToAuditRecord(beforeRow))
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'asset',
      resourceId: id,
      beforeState,
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
