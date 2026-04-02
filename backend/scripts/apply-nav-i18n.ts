/**
 * Applies navigation-related ui_translations (060 + 061) to an existing database.
 * Safe to run multiple times (INSERT … ON CONFLICT DO NOTHING).
 *
 * Usage: from repo root `npx tsx backend/scripts/apply-nav-i18n.ts`
 * or from backend/: `npm run migrate:nav-i18n`
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'migrations')

async function runSqlFile(name: string) {
  const path = join(migrationsDir, name)
  const sql = await readFile(path, 'utf8')
  await pool.query(sql)
  console.log(`Applied: ${name}`)
}

async function main() {
  await runSqlFile('060_i18n_nav_structure.sql')
  await runSqlFile('061_i18n_nav_sidebar_toggle.sql')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
