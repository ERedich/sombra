/**
 * Create the database named in DATABASE_URL if it does not exist.
 * Connects to the maintenance database (default: postgres) on the same host.
 */
import { config } from 'dotenv'
import pg from 'pg'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function maintenanceConnectionString(baseUrl, maintenanceDbName) {
  const u = new URL(baseUrl)
  u.pathname = `/${maintenanceDbName}`
  return u.toString()
}

function databaseNameFromUrl(baseUrl) {
  const u = new URL(baseUrl)
  const segment = u.pathname.replace(/^\//, '').split('/')[0]
  if (!segment) {
    throw new Error(
      'DATABASE_URL must include a database name in the path, e.g. postgresql://user:pass@host:5432/mydb',
    )
  }
  return decodeURIComponent(segment)
}

async function main() {
  const baseUrl = process.env.DATABASE_URL?.trim()
  if (!baseUrl) {
    console.error('Missing DATABASE_URL in backend/.env')
    process.exit(1)
  }

  const dbName = databaseNameFromUrl(baseUrl)
  const maintenanceDb =
    process.env.MAINTENANCE_DATABASE?.trim() || 'postgres'

  const adminUrl = maintenanceConnectionString(baseUrl, maintenanceDb)
  const client = new pg.Client({ connectionString: adminUrl })

  await client.connect()
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    )
    if (exists.rowCount > 0) {
      console.log(`Database "${dbName}" already exists; nothing to do.`)
      return
    }

    const { rows } = await client.query(
      "SELECT format('CREATE DATABASE %I', $1::text) AS stmt",
      [dbName],
    )
    await client.query(rows[0].stmt)
    console.log(`Created database "${dbName}".`)
    console.log('Next: npm run migrate')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
