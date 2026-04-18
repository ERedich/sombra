import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { Router } from 'express'
import type { Request, Response } from 'express'
import multer from 'multer'
import { canAccessSite, loadUserSiteScope } from '../auth/siteScope.js'
import { fieldChanges, redactForAudit, writeAudit } from '../audit/auditLog.js'
import { pool } from '../db.js'
import { env } from '../env.js'
import { requireAuth } from '../middleware/auth.js'
import { getGeneralAppSettings } from '../services/appSettings.js'
import {
  absoluteDocumentPath,
  buildDocumentRelpath,
  removeDocumentFile,
  writeDocumentFile,
} from '../services/documentsStorage.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const DOCUMENT_ENTITY_TYPES = [
  'asset',
  'employee',
  'work_order',
] as const

export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number]

function isDocumentEntityType(v: unknown): v is DocumentEntityType {
  return (
    typeof v === 'string' &&
    (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(v)
  )
}

const ENTITY_TABLE: Record<DocumentEntityType, string> = {
  asset: 'assets',
  employee: 'employees',
  work_order: 'work_orders',
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DOCS_MAX_UPLOAD_MB * 1024 * 1024 },
})

type DocumentStorage = 'database' | 'filesystem'

type DocumentRow = {
  id: string
  site_id: string
  entity_type: DocumentEntityType
  entity_id: string
  original_filename: string
  mime_type: string
  size_bytes: string | number
  storage: DocumentStorage
  storage_relpath: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type DocumentTableRow = {
  id: string
  site_id: string
  entity_type: DocumentEntityType
  entity_id: string
  original_filename: string
  mime_type: string
  size_bytes: string | number
  storage: DocumentStorage
  file_data: Buffer | null
  storage_relpath: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
}

const LIST_SQL = `
SELECT d.id, d.site_id, d.entity_type, d.entity_id, d.original_filename, d.mime_type,
       d.size_bytes, d.storage, d.storage_relpath,
       d.created_at, d.updated_at, d.created_by, d.updated_by,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name
FROM documents d
LEFT JOIN users cb ON cb.id = d.created_by
LEFT JOIN users ub ON ub.id = d.updated_by
`

function normalizeListRow(row: DocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    site_id: row.site_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    storage: row.storage,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_by_login_name: row.created_by_login_name,
    updated_by_login_name: row.updated_by_login_name,
  }
}

function rowToAuditRecord(
  row: DocumentTableRow,
): Record<string, unknown> {
  const { file_data, ...rest } = row
  return {
    ...(rest as unknown as Record<string, unknown>),
    file_data_present: file_data != null && file_data.length > 0,
  }
}

async function loadEntitySiteId(
  entityType: DocumentEntityType,
  entityId: string,
): Promise<string | null> {
  const table = ENTITY_TABLE[entityType]
  const r = await pool.query<{ site_id: string }>(
    `SELECT site_id FROM ${table} WHERE id = $1`,
    [entityId],
  )
  return r.rows[0]?.site_id ?? null
}

const MAX_ENTITY_IDS_PER_REQUEST = 500

function parseEntityIdsParam(raw: string): string[] | { error: string } {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) {
    return { error: 'entity_ids must contain at least one UUID.' }
  }
  if (parts.length > MAX_ENTITY_IDS_PER_REQUEST) {
    return {
      error: `entity_ids is capped at ${MAX_ENTITY_IDS_PER_REQUEST} per request.`,
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of parts) {
    if (!UUID_RE.test(id)) {
      return { error: `Invalid entity_id in entity_ids: ${id}` }
    }
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Filter a set of entity ids to the ones whose parent row exists and the
 * caller can access by site. Returns only the allowed ids, preserving input
 * order.
 */
async function filterEntityIdsByScope(
  entityType: DocumentEntityType,
  ids: string[],
  scope: Awaited<ReturnType<typeof loadUserSiteScope>>,
): Promise<string[]> {
  if (ids.length === 0) return []
  const table = ENTITY_TABLE[entityType]
  const r = await pool.query<{ id: string; site_id: string }>(
    `SELECT id, site_id FROM ${table} WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  const allowed = new Set<string>()
  for (const row of r.rows) {
    if (canAccessSite(scope, row.site_id)) allowed.add(row.id)
  }
  return ids.filter((id) => allowed.has(id))
}

function asciiFilename(original: string): string {
  const stripped = original.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return stripped.length > 0 ? stripped : 'document'
}

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const entityType = String(req.query.entity_type ?? '')
  if (!isDocumentEntityType(entityType)) {
    res.status(400).json({ error: 'Invalid entity_type.' })
    return
  }

  const rawIds =
    typeof req.query.entity_ids === 'string'
      ? req.query.entity_ids.trim()
      : ''
  const rawId =
    typeof req.query.entity_id === 'string' ? req.query.entity_id.trim() : ''

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  if (rawIds) {
    const parsed = parseEntityIdsParam(rawIds)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error })
      return
    }
    const allowed = await filterEntityIdsByScope(entityType, parsed, scope)
    if (allowed.length === 0) {
      res.json({ documents: [], count: 0 })
      return
    }
    const r = await pool.query<DocumentRow>(
      `${LIST_SQL} WHERE d.entity_type = $1 AND d.entity_id = ANY($2::uuid[])
       ORDER BY d.created_at DESC, d.id DESC`,
      [entityType, allowed],
    )
    res.json({
      documents: r.rows.map(normalizeListRow),
      count: r.rows.length,
    })
    return
  }

  if (!UUID_RE.test(rawId)) {
    res.status(400).json({ error: 'Invalid entity_id.' })
    return
  }

  const parentSiteId = await loadEntitySiteId(entityType, rawId)
  if (!parentSiteId || !canAccessSite(scope, parentSiteId)) {
    res.status(404).json({ error: 'Parent record not found.' })
    return
  }

  const r = await pool.query<DocumentRow>(
    `${LIST_SQL} WHERE d.entity_type = $1 AND d.entity_id = $2
     ORDER BY d.created_at DESC, d.id DESC`,
    [entityType, rawId],
  )
  res.json({
    documents: r.rows.map(normalizeListRow),
    count: r.rows.length,
  })
})

router.get('/counts', async (req, res) => {
  const entityType = String(req.query.entity_type ?? '')
  if (!isDocumentEntityType(entityType)) {
    res.status(400).json({ error: 'Invalid entity_type.' })
    return
  }
  const rawIds =
    typeof req.query.entity_ids === 'string'
      ? req.query.entity_ids.trim()
      : ''
  if (!rawIds) {
    res.json({ counts: {} })
    return
  }
  const parsed = parseEntityIdsParam(rawIds)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return
  }

  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const allowed = await filterEntityIdsByScope(entityType, parsed, scope)

  const counts: Record<string, number> = {}
  for (const id of allowed) counts[id] = 0

  if (allowed.length > 0) {
    const r = await pool.query<{ entity_id: string; c: string }>(
      `SELECT entity_id, COUNT(*)::text AS c
         FROM documents
        WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])
        GROUP BY entity_id`,
      [entityType, allowed],
    )
    for (const row of r.rows) {
      counts[row.entity_id] = Number(row.c)
    }
  }

  res.json({ counts })
})

router.post(
  '/',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const entityType = String(req.body?.entity_type ?? '')
    const entityId = String(req.body?.entity_id ?? '')
    if (!isDocumentEntityType(entityType)) {
      res.status(400).json({ error: 'Invalid entity_type.' })
      return
    }
    if (!UUID_RE.test(entityId)) {
      res.status(400).json({ error: 'Invalid entity_id.' })
      return
    }
    const file = req.file
    if (!file?.buffer || !file.mimetype) {
      res
        .status(400)
        .json({ error: 'File is required (multipart field "file").' })
      return
    }
    if (file.size <= 0) {
      res.status(400).json({ error: 'File is empty.' })
      return
    }

    const auth = req.authUser!
    const scope = await loadUserSiteScope(pool, auth.id, auth.role)
    const parentSiteId = await loadEntitySiteId(entityType, entityId)
    if (!parentSiteId || !canAccessSite(scope, parentSiteId)) {
      res.status(404).json({ error: 'Parent record not found.' })
      return
    }

    const general = await getGeneralAppSettings(pool)
    const storage: 'database' | 'filesystem' =
      general.docs_storage === 'application' ? 'filesystem' : 'database'
    const storageRelpath =
      storage === 'filesystem'
        ? buildDocumentRelpath(entityType, entityId, file.originalname)
        : null
    const originalFilename = (file.originalname || 'document').trim().slice(
      0,
      255,
    )

    if (storage === 'filesystem') {
      if (!general.docs_application_path.trim()) {
        res.status(500).json({
          error:
            'Application-side storage is selected but no server directory is configured.',
        })
        return
      }
      try {
        await writeDocumentFile(
          general.docs_application_path,
          storageRelpath!,
          file.buffer,
        )
      } catch {
        res.status(500).json({
          error:
            'Unable to write document to the configured application path.',
        })
        return
      }
    }

    const auditPath = `${req.baseUrl}${req.path}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query<DocumentTableRow>(
        `INSERT INTO documents (
           site_id, entity_type, entity_id, original_filename, mime_type,
           size_bytes, storage, file_data, storage_relpath, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id, site_id, entity_type, entity_id, original_filename, mime_type,
                   size_bytes, storage, file_data, storage_relpath,
                   created_at, updated_at, created_by, updated_by`,
        [
          parentSiteId,
          entityType,
          entityId,
          originalFilename,
          file.mimetype,
          file.size,
          storage,
          storage === 'database' ? file.buffer : null,
          storageRelpath,
          auth.id,
        ],
      )
      const row = inserted.rows[0]!
      const afterState = redactForAudit('document', rowToAuditRecord(row))
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: 'create',
        resourceType: 'document',
        resourceId: row.id,
        beforeState: null,
        afterState,
        fieldChanges: null,
        httpMethod: req.method,
        path: auditPath,
      })
      await client.query('COMMIT')
      const pickedForList: DocumentRow = {
        ...row,
        created_by_login_name: null,
        updated_by_login_name: null,
      }
      res.status(201).json({ document: normalizeListRow(pickedForList) })
    } catch (e) {
      await client.query('ROLLBACK')
      if (storage === 'filesystem' && storageRelpath) {
        await removeDocumentFile(
          general.docs_application_path,
          storageRelpath,
        )
      }
      throw e
    } finally {
      client.release()
    }
  },
)

router.get('/:id/file', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid document id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)

  const r = await pool.query<{
    site_id: string
    original_filename: string
    mime_type: string
    storage: 'database' | 'filesystem'
    file_data: Buffer | null
    storage_relpath: string | null
  }>(
    `SELECT site_id, original_filename, mime_type, storage, file_data, storage_relpath
     FROM documents WHERE id = $1`,
    [id],
  )
  const row = r.rows[0]
  if (!row || !canAccessSite(scope, row.site_id)) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }

  const filename = asciiFilename(row.original_filename)
  res.setHeader('Content-Type', row.mime_type)
  res.setHeader('Cache-Control', 'private, max-age=0')
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${filename}"`,
  )

  if (row.storage === 'database') {
    if (!row.file_data) {
      res.status(404).json({ error: 'Document file missing.' })
      return
    }
    res.send(row.file_data)
    return
  }

  if (!row.storage_relpath) {
    res.status(500).json({ error: 'Document storage path missing.' })
    return
  }
  const general = await getGeneralAppSettings(pool)
  try {
    const data = await readFile(
      absoluteDocumentPath(general.docs_application_path, row.storage_relpath),
    )
    res.send(data)
  } catch {
    res.status(404).json({ error: 'Document file missing on server.' })
  }
})

router.delete('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid document id.' })
    return
  }
  const auth = req.authUser!
  const scope = await loadUserSiteScope(pool, auth.id, auth.role)
  const auditPath = `${req.baseUrl}${req.path}`

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prev = await client.query<DocumentTableRow>(
      `SELECT id, site_id, entity_type, entity_id, original_filename, mime_type,
              size_bytes, storage, file_data, storage_relpath,
              created_at, updated_at, created_by, updated_by
       FROM documents WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const beforeRow = prev.rows[0]
    if (!beforeRow || !canAccessSite(scope, beforeRow.site_id)) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Document not found.' })
      return
    }

    await client.query(`DELETE FROM documents WHERE id = $1`, [id])

    const beforeState = redactForAudit(
      'document',
      rowToAuditRecord(beforeRow),
    )
    await writeAudit(client, {
      actorUserId: auth.id,
      actorKey: auth.login_name,
      actorName: auth.name,
      operation: 'delete',
      resourceType: 'document',
      resourceId: id,
      beforeState,
      afterState: null,
      fieldChanges: null,
      httpMethod: req.method,
      path: auditPath,
    })
    await client.query('COMMIT')
    if (beforeRow.storage === 'filesystem' && beforeRow.storage_relpath) {
      const general = await getGeneralAppSettings(pool)
      await removeDocumentFile(
        general.docs_application_path,
        beforeRow.storage_relpath,
      )
    }
    res.status(204).send()
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

export default router
