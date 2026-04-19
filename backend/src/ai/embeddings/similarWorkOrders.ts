import type { Pool } from 'pg'
import { embedTexts, toPgVectorLiteral } from './openAiEmbed.js'

export type SimilarWorkOrderResult = {
  id: string
  wo_key: number
  short_text: string
  asset_id: string
  status: string
  score: number
}

type Row = {
  id: string
  wo_key: number
  short_text: string
  asset_id: string
  status: string
  distance: string | number
}

function distanceToScore(distance: number): number {
  // pgvector cosine distance is 1 - cosine_similarity and ranges in [0, 2].
  // Convert to a [0, 1]-ish similarity score where 1 is identical.
  const sim = 1 - distance
  if (!Number.isFinite(sim)) return 0
  return Math.max(0, Math.min(1, sim))
}

/** Search by another work order's embedding (must already be embedded). */
export async function searchSimilarByWorkOrderId(
  pool: Pool,
  args: { siteId: string; workOrderId: string; limit: number },
): Promise<SimilarWorkOrderResult[]> {
  const r = await pool.query<Row>(
    `WITH target AS (
       SELECT embedding
         FROM work_order_embeddings
        WHERE work_order_id = $1 AND site_id = $2
     )
     SELECT wo.id,
            wo.wo_key,
            wo.short_text,
            wo.asset_id,
            wo.status,
            (we.embedding <=> (SELECT embedding FROM target)) AS distance
       FROM work_order_embeddings we
       JOIN work_orders wo ON wo.id = we.work_order_id
      WHERE we.site_id = $2
        AND we.work_order_id <> $1
        AND EXISTS (SELECT 1 FROM target)
      ORDER BY we.embedding <=> (SELECT embedding FROM target)
      LIMIT $3`,
    [args.workOrderId, args.siteId, args.limit],
  )
  return r.rows.map(mapRow)
}

/** Search by an ad-hoc query string (embedded on the fly). */
export async function searchSimilarByQuery(
  pool: Pool,
  args: { siteId: string; query: string; limit: number },
): Promise<SimilarWorkOrderResult[]> {
  const { vectors } = await embedTexts([args.query])
  const vec = vectors[0]
  if (!vec) return []
  const literal = toPgVectorLiteral(vec)

  const r = await pool.query<Row>(
    `SELECT wo.id,
            wo.wo_key,
            wo.short_text,
            wo.asset_id,
            wo.status,
            (we.embedding <=> $1::vector) AS distance
       FROM work_order_embeddings we
       JOIN work_orders wo ON wo.id = we.work_order_id
      WHERE we.site_id = $2
      ORDER BY we.embedding <=> $1::vector
      LIMIT $3`,
    [literal, args.siteId, args.limit],
  )
  return r.rows.map(mapRow)
}

function mapRow(r: Row): SimilarWorkOrderResult {
  const distance =
    typeof r.distance === 'number' ? r.distance : Number(r.distance)
  return {
    id: r.id,
    wo_key: r.wo_key,
    short_text: r.short_text,
    asset_id: r.asset_id,
    status: r.status,
    score: distanceToScore(distance),
  }
}
