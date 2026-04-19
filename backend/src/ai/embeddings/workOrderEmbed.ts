import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { env } from '../../env.js'
import { embedTexts, toPgVectorLiteral } from './openAiEmbed.js'

/** Entry from transactions (type='INT') referenced during embedding/RAG. */
export type WorkOrderFeedbackEntry = {
  hours: string
  feedback_text: string
  /** Problem / Cause / Remedy names from pcr_* tables (migration 203). */
  pcr_problem: string | null
  pcr_cause: string | null
  pcr_remedy: string | null
}

/**
 * Everything that goes into the canonical text for one work order.
 *
 * Adding/removing fields here changes `source_hash` for every row and therefore
 * re-embeds the entire table on the next backfill pass. Keep field order stable
 * inside `buildWorkOrderEmbeddingText` for the same reason.
 */
export type WorkOrderEmbedRow = {
  id: string
  site_id: string
  short_text: string | null
  instruction_text: string | null
  status: string | null
  hold_reason: string | null
  asset_key: string | null
  asset_name: string | null
  /** Most recent INT transactions first. */
  feedback_entries: WorkOrderFeedbackEntry[]
}

/** Upper bound on the feedback section so giant transcripts can't blow the embedding budget. */
const MAX_FEEDBACK_CHARS = 4000
/** Hard cap on entries considered even if they fit in the char budget. */
const MAX_FEEDBACK_ENTRIES = 10

function trimToLines(text: string): string {
  return text.replace(/\s+$/g, '').replace(/^\s+/g, '')
}

function formatPcrTriple(e: WorkOrderFeedbackEntry): string {
  const parts: string[] = []
  if (e.pcr_problem) parts.push(`problem=${e.pcr_problem}`)
  if (e.pcr_cause) parts.push(`cause=${e.pcr_cause}`)
  if (e.pcr_remedy) parts.push(`remedy=${e.pcr_remedy}`)
  return parts.length ? ` (PCR ${parts.join(', ')})` : ''
}

function formatFeedbackSection(entries: WorkOrderFeedbackEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = []
  let used = 0
  for (const e of entries.slice(0, MAX_FEEDBACK_ENTRIES)) {
    const body = trimToLines(e.feedback_text ?? '')
    const pcr = formatPcrTriple(e)
    if (body.length === 0 && !pcr) continue
    const hoursLabel = e.hours ? `[${e.hours}h] ` : ''
    const line = `- ${hoursLabel}${body}${pcr}`
    if (used + line.length > MAX_FEEDBACK_CHARS) {
      lines.push('- ...')
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `Feedback:\n${lines.join('\n')}`
}

/**
 * Canonical text used as input to the embedding model. Labeled sections let
 * the embedding capture intent beyond just the title/instruction: feedback
 * text from technicians, asset context, and status/hold reasons make the
 * vector actually representative of what happened on the work order, not
 * just what was planned.
 *
 * Changing this function invalidates every `source_hash` and triggers a
 * full re-embed on the next backfill.
 */
export function buildWorkOrderEmbeddingText(row: {
  short_text: string | null
  instruction_text: string | null
  status: string | null
  hold_reason: string | null
  asset_key: string | null
  asset_name: string | null
  feedback_entries: WorkOrderFeedbackEntry[]
}): string {
  const title = (row.short_text ?? '').trim()
  const body = (row.instruction_text ?? '').trim()
  const status = (row.status ?? '').trim()
  const hold = (row.hold_reason ?? '').trim()
  const assetKey = (row.asset_key ?? '').trim()
  const assetName = (row.asset_name ?? '').trim()

  const parts: string[] = []
  if (title) parts.push(`Title: ${title}`)
  if (body) parts.push(`Instruction: ${body}`)
  if (status) parts.push(`Status: ${status}`)
  if (assetKey || assetName) {
    const assetLine = [assetKey, assetName].filter((s) => s.length > 0).join(' ')
    parts.push(`Asset: ${assetLine}`)
  }
  if (hold) parts.push(`Hold reason: ${hold}`)
  const fb = formatFeedbackSection(row.feedback_entries)
  if (fb) parts.push(fb)

  return parts.join('\n\n')
}

export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/* ── Loader helpers ──────────────────────────────────────────────── */

type RawLoadedRow = {
  id: string
  site_id: string
  short_text: string | null
  instruction_text: string | null
  status: string | null
  hold_reason: string | null
  asset_key: string | null
  asset_name: string | null
  feedback_entries: unknown
}

function normalizeOptionalString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

function normalizeFeedbackEntries(raw: unknown): WorkOrderFeedbackEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WorkOrderFeedbackEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as {
      hours?: unknown
      feedback_text?: unknown
      pcr_problem?: unknown
      pcr_cause?: unknown
      pcr_remedy?: unknown
    }
    const hours =
      typeof rec.hours === 'string'
        ? rec.hours
        : typeof rec.hours === 'number'
          ? String(rec.hours)
          : ''
    const feedback =
      typeof rec.feedback_text === 'string' ? rec.feedback_text : ''
    const pcr_problem = normalizeOptionalString(rec.pcr_problem)
    const pcr_cause = normalizeOptionalString(rec.pcr_cause)
    const pcr_remedy = normalizeOptionalString(rec.pcr_remedy)
    // Keep entries that have either free text OR at least one PCR dimension.
    if (!feedback.trim() && !pcr_problem && !pcr_cause && !pcr_remedy) continue
    out.push({
      hours,
      feedback_text: feedback,
      pcr_problem,
      pcr_cause,
      pcr_remedy,
    })
  }
  return out
}

function mapRawRow(row: RawLoadedRow): WorkOrderEmbedRow {
  return {
    id: row.id,
    site_id: row.site_id,
    short_text: row.short_text,
    instruction_text: row.instruction_text,
    status: row.status,
    hold_reason: row.hold_reason,
    asset_key: row.asset_key,
    asset_name: row.asset_name,
    feedback_entries: normalizeFeedbackEntries(row.feedback_entries),
  }
}

const LOAD_SELECT = `
  SELECT wo.id,
         wo.site_id,
         wo.short_text,
         wo.instruction_text,
         wo.status,
         wo.hold_reason,
         a.key  AS asset_key,
         a.name AS asset_name,
         COALESCE(
           (SELECT json_agg(json_build_object(
                     'hours', t.hours::text,
                     'feedback_text', t.feedback_text,
                     'pcr_problem', t.pcr_problem,
                     'pcr_cause',   t.pcr_cause,
                     'pcr_remedy',  t.pcr_remedy)
                     ORDER BY t.created_at DESC)
              FROM (
                SELECT tr.hours,
                       tr.feedback_text,
                       tr.created_at,
                       pp.name AS pcr_problem,
                       pc.name AS pcr_cause,
                       pr.name AS pcr_remedy
                  FROM transactions tr
                  LEFT JOIN pcr_problems pp ON pp.id = tr.pcr_problem_id
                  LEFT JOIN pcr_causes   pc ON pc.id = tr.pcr_cause_id
                  LEFT JOIN pcr_remedies pr ON pr.id = tr.pcr_remedy_id
                 WHERE tr.work_order_id = wo.id AND tr.type = 'INT'
                 ORDER BY tr.created_at DESC
                 LIMIT ${MAX_FEEDBACK_ENTRIES}
              ) t),
           '[]'::json) AS feedback_entries
    FROM work_orders wo
    JOIN assets a ON a.id = wo.asset_id
`

/** Load one work order + its embedding-relevant context. */
export async function loadWorkOrderEmbedRow(
  pool: Pool | PoolClient,
  id: string,
): Promise<WorkOrderEmbedRow | null> {
  const r = await pool.query<RawLoadedRow>(
    `${LOAD_SELECT} WHERE wo.id = $1`,
    [id],
  )
  const row = r.rows[0]
  return row ? mapRawRow(row) : null
}

/**
 * Paginated loader for the backfill script. Orders by id for a stable cursor
 * and aggregates feedback in a single query to avoid N+1.
 */
export async function loadWorkOrderEmbedRowsPage(
  pool: Pool,
  args: { afterId: string | null; pageSize: number },
): Promise<WorkOrderEmbedRow[]> {
  const where = args.afterId ? `WHERE wo.id > $1` : ''
  const limitIdx = args.afterId ? '$2' : '$1'
  const params = args.afterId
    ? [args.afterId, args.pageSize]
    : [args.pageSize]
  const r = await pool.query<RawLoadedRow>(
    `${LOAD_SELECT} ${where} ORDER BY wo.id LIMIT ${limitIdx}`,
    params,
  )
  return r.rows.map(mapRawRow)
}

/* ── Upsert paths (embed single / batch) ─────────────────────────── */

/**
 * Upsert an embedding for a single work order. Skips the OpenAI call when
 * `source_hash` matches and the stored model is still the configured one.
 * Safe to call without `OPENAI_API_KEY` set: returns `{ embedded: false, reason: 'no_api_key' }`.
 */
export async function embedWorkOrder(
  pool: Pool,
  row: WorkOrderEmbedRow,
): Promise<{ embedded: boolean; reason?: string }> {
  if (!env.OPENAI_API_KEY?.trim()) {
    return { embedded: false, reason: 'no_api_key' }
  }

  const text = buildWorkOrderEmbeddingText(row)
  if (text.length === 0) {
    return { embedded: false, reason: 'empty_text' }
  }

  const hash = hashEmbeddingText(text)
  const model = env.OPENAI_EMBEDDING_MODEL

  const existing = await pool.query<{ source_hash: string; model: string }>(
    `SELECT source_hash, model FROM work_order_embeddings WHERE work_order_id = $1`,
    [row.id],
  )

  if (
    existing.rows[0] &&
    existing.rows[0].source_hash === hash &&
    existing.rows[0].model === model
  ) {
    return { embedded: false, reason: 'unchanged' }
  }

  const { vectors, model: usedModel } = await embedTexts([text])
  const vec = vectors[0]
  if (!vec) {
    return { embedded: false, reason: 'no_vector' }
  }

  await pool.query(
    `INSERT INTO work_order_embeddings
       (work_order_id, site_id, model, source_hash, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5::vector, now())
     ON CONFLICT (work_order_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       model = EXCLUDED.model,
       source_hash = EXCLUDED.source_hash,
       embedding = EXCLUDED.embedding,
       updated_at = now()`,
    [row.id, row.site_id, usedModel, hash, toPgVectorLiteral(vec)],
  )

  return { embedded: true }
}

/**
 * Load + embed in one shot: convenience for route call sites that only have
 * the work order id. Never throws; all failures log via the returned reason.
 */
export async function embedWorkOrderById(
  pool: Pool,
  id: string,
): Promise<{ embedded: boolean; reason?: string }> {
  const row = await loadWorkOrderEmbedRow(pool, id)
  if (!row) return { embedded: false, reason: 'not_found' }
  return embedWorkOrder(pool, row)
}

/**
 * Cheaper variant used by the backfill path: reads the existing `source_hash`
 * first and only embeds rows that need it. Returns counts for logging.
 */
export async function embedWorkOrdersBatch(
  pool: Pool,
  rows: WorkOrderEmbedRow[],
): Promise<{ embedded: number; skipped: number }> {
  if (rows.length === 0) return { embedded: 0, skipped: 0 }
  if (!env.OPENAI_API_KEY?.trim()) {
    return { embedded: 0, skipped: rows.length }
  }

  const texts = rows.map((r) => buildWorkOrderEmbeddingText(r))
  const hashes = texts.map((t) => (t.length > 0 ? hashEmbeddingText(t) : ''))

  const ids = rows.map((r) => r.id)
  const existing = await pool.query<{
    work_order_id: string
    source_hash: string
    model: string
  }>(
    `SELECT work_order_id, source_hash, model
       FROM work_order_embeddings
      WHERE work_order_id = ANY($1::uuid[])`,
    [ids],
  )
  const existingMap = new Map(
    existing.rows.map((r) => [r.work_order_id, r]),
  )

  const pending: { row: WorkOrderEmbedRow; text: string; hash: string }[] = []
  let skipped = 0
  for (let i = 0; i < rows.length; i++) {
    const text = texts[i]!
    const hash = hashes[i]!
    if (text.length === 0) {
      skipped++
      continue
    }
    const prev = existingMap.get(rows[i]!.id)
    if (prev && prev.source_hash === hash) {
      skipped++
      continue
    }
    pending.push({ row: rows[i]!, text, hash })
  }

  if (pending.length === 0) return { embedded: 0, skipped }

  const { vectors, model } = await embedTexts(pending.map((p) => p.text))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!
      const v = vectors[i]
      if (!v) continue
      await client.query(
        `INSERT INTO work_order_embeddings
           (work_order_id, site_id, model, source_hash, embedding, updated_at)
         VALUES ($1, $2, $3, $4, $5::vector, now())
         ON CONFLICT (work_order_id) DO UPDATE SET
           site_id = EXCLUDED.site_id,
           model = EXCLUDED.model,
           source_hash = EXCLUDED.source_hash,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [p.row.id, p.row.site_id, model, p.hash, toPgVectorLiteral(v)],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  return { embedded: pending.length, skipped }
}
