import type { Pool } from 'pg'
import type { AiRefItem, AiSuggestContext } from './suggestTypes.js'

function rowToRef(r: { id: string; key: string; name: string }): AiRefItem {
  return { id: r.id, key: r.key, name: r.name }
}

/** Load site-scoped reference lists for AI suggest tools (server-side; no huge client payloads). */
export async function loadAiSuggestContextForSite(
  pool: Pool,
  siteId: string,
): Promise<AiSuggestContext> {
  const [
    assets,
    work_types,
    workgroups,
    categories,
    costcenters,
    asset_classifications,
  ] = await Promise.all([
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM assets WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM work_types WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM workgroups WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM categories WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM costcenters WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
    pool.query<{ id: string; key: string; name: string }>(
      `SELECT id, key, name FROM asset_classifications WHERE site_id = $1::uuid ORDER BY name`,
      [siteId],
    ),
  ])

  return {
    assets: assets.rows.map(rowToRef),
    work_types: work_types.rows.map(rowToRef),
    workgroups: workgroups.rows.map(rowToRef),
    categories: categories.rows.map(rowToRef),
    costcenters: costcenters.rows.map(rowToRef),
    asset_classifications: asset_classifications.rows.map(rowToRef),
  }
}

export async function searchAssetsForSite(
  pool: Pool,
  siteId: string,
  query: string,
  limit: number,
): Promise<{ id: string; key: string; name: string }[]> {
  const q = query.trim()
  if (!q) return []
  const lim = Math.min(Math.max(limit || 15, 1), 50)
  const pat = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
  const r = await pool.query<{ id: string; key: string; name: string }>(
    `SELECT id, key, name FROM assets
     WHERE site_id = $1::uuid AND (key ILIKE $2 ESCAPE '\\' OR name ILIKE $2 ESCAPE '\\')
     ORDER BY name
     LIMIT $3`,
    [siteId, pat, lim],
  )
  return r.rows
}

export async function listOpenWorkOrdersBrief(
  pool: Pool,
  siteId: string,
  limit: number,
): Promise<{ wo_key: number; short_text: string; status: string }[]> {
  const lim = Math.min(Math.max(limit || 15, 1), 50)
  const r = await pool.query<{
    wo_key: number
    short_text: string
    status: string
  }>(
    `SELECT wo_key, short_text, status FROM work_orders
     WHERE site_id = $1::uuid AND status = 'open'
     ORDER BY wo_key DESC
     LIMIT $2`,
    [siteId, lim],
  )
  return r.rows
}
