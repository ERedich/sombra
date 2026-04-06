import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import { pool } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'migrations')

/**
 * Only numbered `NNN_description.sql` files (at least 3-digit prefix) are applied.
 * Use zero-padded names (`089_`, `100_`) so lexical + numeric sort matches apply order.
 */
const NUMBERED_MIGRATION_RE = /^\d{3,}_.+\.sql$/

async function runSqlFile(name: string) {
  const path = join(migrationsDir, name)
  const sql = await readFile(path, 'utf8')
  await pool.query(sql)
  console.log(`Applied migration: ${name}`)
}

async function runAllMigrationsFromDisk() {
  const names = (await readdir(migrationsDir))
    .filter((f) => NUMBERED_MIGRATION_RE.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (names.length === 0) {
    throw new Error(`No numbered migrations found in ${migrationsDir}`)
  }
  for (const name of names) {
    await runSqlFile(name)
  }
}

async function ensureAdminUser() {
  const passwordHash = bcrypt.hashSync('admin', 10)
  const res = await pool.query(
    `INSERT INTO users (login_name, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (login_name) DO NOTHING
     RETURNING id`,
    ['admin', 'Administrator', null, passwordHash, 'admin'],
  )
  if (res.rowCount && res.rows.length > 0) {
    console.log('Created initial admin user (login_name=admin, password=admin).')
  } else {
    console.log('Admin user already present; skipped insert.')
  }
}

/** Bootstrap admin uses site key DEF as working site (skeleton apps scope rows by working site). */
async function assignAdminDefaultWorkingSite() {
  const r = await pool.query(
    `UPDATE users u
     SET working_site_id = s.id
     FROM sites s
     WHERE s.key = 'DEF' AND u.login_name = 'admin'`,
  )
  if (r.rowCount && r.rowCount > 0) {
    console.log('Set admin working_site_id to site DEF (if present).')
  }
}

async function main() {
  await runAllMigrationsFromDisk()
  await ensureAdminUser()
  await assignAdminDefaultWorkingSite()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
