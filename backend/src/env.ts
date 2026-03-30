import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Load backend/.env whether the process cwd is `backend/` or the repo root (tsx / IDEs).
config({ path: join(__dirname, '..', '.env') })
config({ path: join(process.cwd(), '.env') })

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Create backend/.env (copy from .env.example) and set ${name}.`,
    )
  }
  return value
}

const nodeEnv = process.env.NODE_ENV ?? 'development'

function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) return fromEnv
  if (nodeEnv === 'production') {
    return required('JWT_SECRET', undefined)
  }
  // Local dev: allows `npm run dev` if .env was not picked up; never use in production.
  console.warn(
    '[env] JWT_SECRET missing — using insecure development default. Set JWT_SECRET in backend/.env.',
  )
  return 'development-only-insecure-jwt-secret'
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  if (v === undefined || v === '') return defaultValue
  return v === '1' || v === 'true' || v === 'yes'
}

export const env = {
  NODE_ENV: nodeEnv,
  PORT: Number(process.env.PORT ?? '3001'),
  DATABASE_URL: required('DATABASE_URL', process.env.DATABASE_URL),
  JWT_SECRET: jwtSecret(),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  /** When true, run PM due-order generation daily at 17:30 (see `GENERATE_DUE_TIMEZONE`, default Europe/Berlin). Default off until enabled explicitly. */
  GENERATE_DUE_CRON_ENABLED: boolEnv('GENERATE_DUE_CRON_ENABLED', false),
  GENERATE_DUE_TIMEZONE: process.env.GENERATE_DUE_TIMEZONE ?? 'Europe/Berlin',
  /** Optional UUID for audit `created_by` on scheduled runs; null uses SQL NULL. */
  GENERATE_DUE_ACTOR_USER_ID: process.env.GENERATE_DUE_ACTOR_USER_ID?.trim() || null,
}
