/**
 * Seeds dummy organizational data for every site:
 * - 10 users (login_name === password)
 * - 10 employees
 * - user <-> employee links (1:1)
 * - 10 workgroups
 * - workgroup memberships (10 assignments)
 *
 * Usage (from backend/):
 *   npx tsx scripts/seed-dummy-org-data.ts
 *
 * Idempotent for rows with DEMO-* keys / login names.
 */
import bcrypt from 'bcrypt'
import { pool } from '../src/db.js'

const PER_SITE = 10
const EMP_KEY_PREFIX = 'DEMO-EMP-'
const WG_KEY_PREFIX = 'DEMO-WG-'
const USER_LOGIN_PREFIX = 'demo_'

type SiteRow = { id: string; key: string; name: string }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function normalizeSiteKeyForLogin(siteKey: string): string {
  return siteKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function main() {
  const adminR = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE login_name = 'admin' LIMIT 1`,
  )
  const adminId = adminR.rows[0]?.id ?? null

  const sitesR = await pool.query<SiteRow>(
    `SELECT id, key, name FROM sites ORDER BY name ASC, key ASC`,
  )
  const sites = sitesR.rows
  if (sites.length === 0) {
    throw new Error('No sites found. Run migrations first.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const site of sites) {
      const siteLoginKey = normalizeSiteKeyForLogin(site.key)
      const employeesByIndex = new Map<number, string>()
      const usersByIndex = new Map<number, string>()
      const workgroupsByIndex = new Map<number, string>()

      for (let i = 1; i <= PER_SITE; i++) {
        const idx = pad2(i)
        const empKey = `${EMP_KEY_PREFIX}${idx}`
        const empName = `Demo Employee ${idx} (${site.key})`

        const empR = await client.query<{ id: string }>(
          `INSERT INTO employees (site_id, key, name, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (site_id, key) DO UPDATE SET
             name = EXCLUDED.name,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by
           RETURNING id`,
          [site.id, empKey, empName, adminId],
        )
        employeesByIndex.set(i, empR.rows[0]!.id)
      }

      for (let i = 1; i <= PER_SITE; i++) {
        const idx = pad2(i)
        const loginName = `${USER_LOGIN_PREFIX}${siteLoginKey}_${idx}`
        const passwordHash = await bcrypt.hash(loginName, 10)

        const userR = await client.query<{ id: string }>(
          `INSERT INTO users (
             login_name,
             name,
             email,
             password_hash,
             role,
             working_site_id,
             employee_id,
             created_by,
             updated_by
           )
           VALUES ($1, $2, $3, $4, 'user', $5, NULL, $6, $6)
           ON CONFLICT (login_name) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             working_site_id = EXCLUDED.working_site_id,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by
           RETURNING id`,
          [
            loginName,
            `Demo User ${idx} (${site.key})`,
            `${loginName}@example.local`,
            passwordHash,
            site.id,
            adminId,
          ],
        )
        usersByIndex.set(i, userR.rows[0]!.id)
      }

      for (let i = 1; i <= PER_SITE; i++) {
        const userId = usersByIndex.get(i)
        const employeeId = employeesByIndex.get(i)
        if (!userId || !employeeId) {
          throw new Error(`Missing user/employee id at index ${i} for site ${site.key}.`)
        }
        await client.query(`UPDATE users SET employee_id = $1 WHERE id = $2`, [
          employeeId,
          userId,
        ])
      }

      for (let i = 1; i <= PER_SITE; i++) {
        const idx = pad2(i)
        const wgKey = `${WG_KEY_PREFIX}${idx}`
        const wgName = `Demo Workgroup ${idx} (${site.key})`
        const wgR = await client.query<{ id: string }>(
          `INSERT INTO workgroups (site_id, key, name, costcenter_id, created_by, updated_by)
           VALUES ($1, $2, $3, NULL, $4, $4)
           ON CONFLICT (site_id, key) DO UPDATE SET
             name = EXCLUDED.name,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by
           RETURNING id`,
          [site.id, wgKey, wgName, adminId],
        )
        workgroupsByIndex.set(i, wgR.rows[0]!.id)
      }

      for (let i = 1; i <= PER_SITE; i++) {
        const employeeId = employeesByIndex.get(i)
        const workgroupId = workgroupsByIndex.get(((i - 1) % PER_SITE) + 1)
        if (!employeeId || !workgroupId) {
          throw new Error(`Missing workgroup/employee at index ${i} for site ${site.key}.`)
        }
        await client.query(
          `INSERT INTO workgroup_employees (workgroup_id, employee_id)
           VALUES ($1, $2)
           ON CONFLICT (workgroup_id, employee_id) DO NOTHING`,
          [workgroupId, employeeId],
        )
      }
    }

    await client.query('COMMIT')
    console.log(
      `OK: seeded demo org data for ${sites.length} site(s), ${PER_SITE} users/employees/workgroups per site.`,
    )
    console.log('Login name equals password for all demo users.')
    console.log(`Login format: ${USER_LOGIN_PREFIX}<site_key_normalized>_<01-10>`)
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
