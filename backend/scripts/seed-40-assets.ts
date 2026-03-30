/**
 * Inserts 40 demo assets for site DEF: hierarchy location → building → group →
 * maintenance_object, with cost centers and optional equipment metadata.
 *
 * Usage (from repo root or backend/):
 *   npx tsx scripts/seed-40-assets.ts
 *
 * Requires DATABASE_URL in backend/.env (loaded via ../src/db → env).
 * Idempotent for keys: deletes previous rows with keys matching SEED-% on that
 * site, then re-inserts.
 */
import { pool } from '../src/db.js'

type AssetType = 'location' | 'building' | 'group' | 'maintenance_object'

const COST_CENTER_DEFS: { key: string; name: string }[] = [
  { key: 'SEED-CC-OPS', name: 'Seed — Operations' },
  { key: 'SEED-CC-FAC', name: 'Seed — Facilities' },
  { key: 'SEED-CC-ENG', name: 'Seed — Engineering' },
]

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

  const ccIds: string[] = []
  for (const cc of COST_CENTER_DEFS) {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO costcenters (site_id, key, name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (site_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = now()
       RETURNING id`,
      [siteId, cc.key, cc.name, createdBy],
    )
    ccIds.push(ins.rows[0]!.id)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key LIKE 'SEED-%' AND asset_type = 'maintenance_object'`,
      [siteId],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key LIKE 'SEED-%' AND asset_type = 'group'`,
      [siteId],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key LIKE 'SEED-%' AND asset_type = 'building'`,
      [siteId],
    )
    await client.query(
      `DELETE FROM assets WHERE site_id = $1 AND key LIKE 'SEED-%' AND asset_type = 'location'`,
      [siteId],
    )

    const idByKey = new Map<string, string>()

    async function insertAsset(args: {
      key: string
      name: string
      asset_type: AssetType
      parent_key: string | null
      costcenter_id: string | null
      equipment_number?: string | null
      serial_no?: string | null
      build_year?: number | null
      warranty_end?: string | null
      priority?: number | null
    }) {
      const parentId = args.parent_key
        ? idByKey.get(args.parent_key) ?? null
        : null
      if (args.parent_key && !parentId) {
        throw new Error(`Missing parent id for key ${args.key} (parent ${args.parent_key})`)
      }
      const r = await client.query<{ id: string }>(
        `INSERT INTO assets (
           site_id, asset_type, key, name, parent_asset_id, costcenter_id,
           equipment_number, serial_no, build_year, warranty_end, priority,
           created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          siteId,
          args.asset_type,
          args.key,
          args.name,
          parentId,
          args.costcenter_id,
          args.equipment_number ?? null,
          args.serial_no ?? null,
          args.build_year ?? null,
          args.warranty_end ?? null,
          args.priority ?? null,
          createdBy,
        ],
      )
      idByKey.set(args.key, r.rows[0]!.id)
    }

    const cc = (i: number) => ccIds[i % ccIds.length]!

    // 1 location + 3 buildings + 9 groups + 27 maintenance_object = 40
    await insertAsset({
      key: 'SEED-LOC-A',
      name: 'North Campus',
      asset_type: 'location',
      parent_key: null,
      costcenter_id: cc(0),
    })

    for (let b = 1; b <= 3; b++) {
      await insertAsset({
        key: `SEED-BLD-A${b}`,
        name: `Building A${b} — Production & storage`,
        asset_type: 'building',
        parent_key: 'SEED-LOC-A',
        costcenter_id: cc(1),
        build_year: 1995 + b * 3,
      })
    }

    let g = 0
    for (let b = 1; b <= 3; b++) {
      for (let s = 1; s <= 3; s++) {
        g += 1
        await insertAsset({
          key: `SEED-GRP-${String(g).padStart(2, '0')}`,
          name: `Zone ${b}.${s} — Line & utilities`,
          asset_type: 'group',
          parent_key: `SEED-BLD-A${b}`,
          costcenter_id: cc(2),
        })
      }
    }

    let mo = 0
    for (let gi = 1; gi <= 9; gi++) {
      const parentKey = `SEED-GRP-${String(gi).padStart(2, '0')}`
      for (let k = 1; k <= 3; k++) {
        mo += 1
        const y = 2018 + (mo % 5)
        await insertAsset({
          key: `SEED-MO-${String(mo).padStart(2, '0')}`,
          name: `Asset ${mo} — Pump / drive unit`,
          asset_type: 'maintenance_object',
          parent_key: parentKey,
          costcenter_id: cc(mo),
          equipment_number: `EQ-${1000 + mo}`,
          serial_no: `SN-${siteId.slice(0, 4).toUpperCase()}-${mo.toString().padStart(4, '0')}`,
          build_year: y,
          warranty_end: `${y + 2}-06-30`,
          priority: (mo % 5) + 1,
        })
      }
    }

    await client.query('COMMIT')
    console.log(
      `OK: inserted 40 assets (keys SEED-*) and ensured ${COST_CENTER_DEFS.length} cost centers on site DEF.`,
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
