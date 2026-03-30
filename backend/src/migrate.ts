import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import { pool } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'migrations')

async function runSqlFile(name: string) {
  const path = join(migrationsDir, name)
  const sql = await readFile(path, 'utf8')
  await pool.query(sql)
  console.log(`Applied migration: ${name}`)
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
  await runSqlFile('001_users.sql')
  await runSqlFile('002_sites.sql')
  await runSqlFile('003_audit_log.sql')
  await runSqlFile('004_users_login_and_row_audit.sql')
  await runSqlFile('005_user_site_assignment.sql')
  await runSqlFile('006_costcenters.sql')
  await runSqlFile('007_costcenters_site_and_def.sql')
  await runSqlFile('008_user_groups.sql')
  await runSqlFile('009_assets.sql')
  await runSqlFile('011_drop_asset_address.sql')
  await runSqlFile('012_asset_class.sql')
  await runSqlFile('013_asset_classifications.sql')
  await runSqlFile('014_work_orders.sql')
  await runSqlFile('015_work_order_interval_pm.sql')
  await runSqlFile('016_work_order_rollout_from.sql')
  await runSqlFile('017_wo_interval_rollout_functions.sql')
  await runSqlFile('018_i18n.sql')
  await runSqlFile('019_i18n_extended_ui.sql')
  await runSqlFile('020_i18n_work_orders_ui.sql')
  await runSqlFile('021_i18n_crud_remaining.sql')
  await runSqlFile('022_i18n_users_audit_hotkeys.sql')
  await runSqlFile('023_roll_out_children_copy_parent.sql')
  await runSqlFile('024_i18n_wo_due_labels.sql')
  await runSqlFile('025_wo_generate_due_pm_intervals.sql')
  await runSqlFile('026_i18n_generate_due_orders.sql')
  await runSqlFile('027_plan_start_lead_time.sql')
  await runSqlFile('028_drop_wo_generate_due_pm_intervals.sql')
  await runSqlFile('029_i18n_generate_due_background.sql')
  await ensureAdminUser()
  await assignAdminDefaultWorkingSite()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
