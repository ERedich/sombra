/**
 * Copy a PostgreSQL database (schema + data) from SOURCE_DATABASE_URL to TARGET_DATABASE_URL
 * using pg_dump (custom format) and pg_restore. Requires PostgreSQL client tools on PATH
 * or PG_DUMP / PG_RESTORE pointing to the binaries.
 */
import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function parseArgs(argv) {
  const out = { from: null, to: null, clean: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--clean') {
      out.clean = true
      continue
    }
    if (a === '--from' && argv[i + 1]) {
      out.from = argv[++i]
      continue
    }
    if (a === '--to' && argv[i + 1]) {
      out.to = argv[++i]
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log(`Usage:
  npm run db:copy -- [--from <url>] [--to <url>] [--clean]

Environment:
  SOURCE_DATABASE_URL   Source Postgres connection string (same shape as DATABASE_URL)
  TARGET_DATABASE_URL   Target Postgres connection string (database must already exist)
  PG_DUMP               Optional path to pg_dump binary
  PG_RESTORE            Optional path to pg_restore binary

  --clean   Pass --clean --if-exists to pg_restore (drops existing objects first; use only on disposable targets)
`)
      process.exit(0)
    }
  }
  return out
}

function maskDatabaseUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return '(unparseable URL)'
  }
}

function resolveBin(envName, fallbackName) {
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (fromEnv) return fromEnv
  return fallbackName
}

function run(bin, args, label) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (r.status !== 0) {
    const err = r.stderr || r.stdout || ''
    throw new Error(`${label} failed (exit ${r.status}): ${err.trim() || bin}`)
  }
}

function checkTool(bin, name) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    console.error(
      `${name} not found or not working (${bin}). Install PostgreSQL client tools or set ${name === 'pg_dump' ? 'PG_DUMP' : 'PG_RESTORE'}.`,
    )
    process.exit(1)
  }
}

const args = parseArgs(process.argv)
const sourceUrl = args.from?.trim() || process.env.SOURCE_DATABASE_URL?.trim()
const targetUrl = args.to?.trim() || process.env.TARGET_DATABASE_URL?.trim()

if (!sourceUrl || !targetUrl) {
  console.error(
    'Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL, or pass --from and --to.',
  )
  process.exit(1)
}

const pgDump = resolveBin('PG_DUMP', 'pg_dump')
const pgRestore = resolveBin('PG_RESTORE', 'pg_restore')

checkTool(pgDump, 'pg_dump')
checkTool(pgRestore, 'pg_restore')

const dumpPath = join(tmpdir(), `pg-copy-${randomBytes(8).toString('hex')}.dump`)

console.log('Source:', maskDatabaseUrl(sourceUrl))
console.log('Target:', maskDatabaseUrl(targetUrl))
if (args.clean) {
  console.log('Restore mode: --clean --if-exists (drops existing objects on target before restore)')
}

try {
  run(
    pgDump,
    ['-Fc', '--no-owner', '--no-acl', '-f', dumpPath, sourceUrl],
    'pg_dump',
  )
  console.log('Dump written:', dumpPath)

  const restoreArgs = [
    '--no-owner',
    '--no-acl',
    '-d',
    targetUrl,
    dumpPath,
  ]
  if (args.clean) {
    restoreArgs.unshift('--clean', '--if-exists')
  }
  run(pgRestore, restoreArgs, 'pg_restore')
  console.log('Restore finished successfully.')
} finally {
  if (existsSync(dumpPath)) {
    try {
      unlinkSync(dumpPath)
    } catch {
      // ignore
    }
  }
}
