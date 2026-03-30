/**
 * Inserts 4000 demo assets on site DEF: 1 location + 1 building + 1 group +
 * 3997 maintenance_object children (flat under the group).
 *
 * Usage (from backend/):
 *   npx tsx scripts/seed-4000-assets.ts
 *
 * Requires DATABASE_URL in backend/.env.
 * Idempotent: deletes rows whose keys start with BULK4K- on that site, then inserts.
 */
import { pool } from '../src/db.js'

const PREFIX = 'BULK4K'
const MO_COUNT = 3997 // 1 + 1 + 1 + 3997 = 4000 assets

async function main() {
  const siteR = await pool.query<{ id: string }>(
    `SELECT id FROM sites WHERE key = 'DEF' LIMIT 1`,
  )
  const site = siteR.rows[0]
  if (!site) {
    throw new Error('Site DEF not found. Run npm run migrate first.')
  }
  const siteId = site.id

  const adminR = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE login_name = 'admin' LIMIT 1`,
  )
  const createdBy = adminR.rows[0]?.id ?? null

  const ccR = await pool.query<{ id: string }>(
    `SELECT id FROM costcenters WHERE site_id = $1 LIMIT 1`,
    [siteId],
  )
  const costcenterId = ccR.rows[0]?.id ?? null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key LIKE $2 AND asset_type = 'maintenance_object'`,
      [siteId, `${PREFIX}-MO-%`],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key = $2`,
      [siteId, `${PREFIX}-GRP-1`],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key = $2`,
      [siteId, `${PREFIX}-BLD-1`],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key = $2`,
      [siteId, `${PREFIX}-LOC-1`],
    )

    const loc = await client.query<{ id: string }>(
      `INSERT INTO assets (
         site_id, asset_type, key, name, parent_asset_id, costcenter_id, created_by
       ) VALUES ($1, 'location', $2, $3, NULL, $4, $5)
       RETURNING id`,
      [
        siteId,
        `${PREFIX}-LOC-1`,
        'Bulk demo — root location',
        costcenterId,
        createdBy,
      ],
    )
    const locId = loc.rows[0]!.id

    const bld = await client.query<{ id: string }>(
      `INSERT INTO assets (
         site_id, asset_type, key, name, parent_asset_id, costcenter_id, created_by
       ) VALUES ($1, 'building', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        siteId,
        `${PREFIX}-BLD-1`,
        'Bulk demo — building',
        locId,
        costcenterId,
        createdBy,
      ],
    )
    const bldId = bld.rows[0]!.id

    const grp = await client.query<{ id: string }>(
      `INSERT INTO assets (
         site_id, asset_type, key, name, parent_asset_id, costcenter_id, created_by
       ) VALUES ($1, 'group', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        siteId,
        `${PREFIX}-GRP-1`,
        'Bulk demo — group (3997 children)',
        bldId,
        costcenterId,
        createdBy,
      ],
    )
    const grpId = grp.rows[0]!.id

    const bulk = await client.query(
      `INSERT INTO assets (
         site_id, asset_type, key, name, parent_asset_id, costcenter_id,
         equipment_number, priority, created_by
       )
       SELECT
         $1::uuid,
         'maintenance_object'::text,
         $2 || '-MO-' || lpad(gs::text, 7, '0'),
         'Bulk demo asset ' || gs,
         $3::uuid,
         $4::uuid,
         'BULK-EQ-' || lpad(gs::text, 7, '0'),
         1 + ((gs - 1) % 5),
         $5::uuid
       FROM generate_series(1, $6::int) AS gs`,
      [siteId, PREFIX, grpId, costcenterId, createdBy, MO_COUNT],
    )

    const inserted = bulk.rowCount ?? MO_COUNT

    await client.query('COMMIT')
    console.log(
      `OK: inserted ${3 + inserted} assets (keys ${PREFIX}-*) on site DEF ` +
        `(1 location + 1 building + 1 group + ${inserted} maintenance_object).`,
    )
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
