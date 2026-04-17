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

const frontendOriginRaw =
  process.env.FRONTEND_ORIGIN?.trim() || 'http://localhost:5173'

/** Browser origins allowed by CORS (comma-separated in FRONTEND_ORIGIN). */
export const corsAllowedOrigins = frontendOriginRaw
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

export const env = {
  NODE_ENV: nodeEnv,
  PORT: Number(process.env.PORT ?? '3001'),
  DATABASE_URL: required('DATABASE_URL', process.env.DATABASE_URL),
  JWT_SECRET: jwtSecret(),
  /** Raw env value; use `corsAllowedOrigins` for matching. */
  FRONTEND_ORIGIN: frontendOriginRaw,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  /** Model for structured JSON drafting (default gpt-4o-mini). */
  OPENAI_SUGGEST_MODEL:
    process.env.OPENAI_SUGGEST_MODEL?.trim() || 'gpt-4o-mini',
  /** Model for copilot chat + tools (defaults to OPENAI_SUGGEST_MODEL). */
  OPENAI_COPILOT_MODEL: process.env.OPENAI_COPILOT_MODEL?.trim() || '',
  /** Max reference rows per list sent to the model (client may send more; server truncates). */
  AI_SUGGEST_MAX_CONTEXT_ITEMS: Math.min(
    2000,
    Math.max(
      50,
      Number(process.env.AI_SUGGEST_MAX_CONTEXT_ITEMS ?? '400') || 400,
    ),
  ),
  /** Sustained requests per user per minute for /api/ai/* (suggest + transcribe). */
  AI_RATE_LIMIT_PER_MINUTE: Math.min(
    120,
    Math.max(
      5,
      Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? '30') || 30,
    ),
  ),
  /**
   * Max JSON request body size (e.g. `10mb`). Default raised so `/api/ai/suggest`
   * can accept large site-scoped reference lists without PayloadTooLargeError.
   */
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT?.trim() || '10mb',
  /** When true, run PM due-order generation daily at 17:30 (see `GENERATE_DUE_TIMEZONE`, default Europe/Berlin). Default off until enabled explicitly. */
  GENERATE_DUE_CRON_ENABLED: boolEnv('GENERATE_DUE_CRON_ENABLED', false),
  GENERATE_DUE_TIMEZONE: process.env.GENERATE_DUE_TIMEZONE ?? 'Europe/Berlin',
  /** Optional UUID for audit `created_by` on scheduled runs; null uses SQL NULL. */
  GENERATE_DUE_ACTOR_USER_ID: process.env.GENERATE_DUE_ACTOR_USER_ID?.trim() || null,

  /** When true, site notification email rules may send outbound SMTP mail. */
  MAIL_ENABLED: boolEnv('MAIL_ENABLED', false),
  SMTP_HOST: process.env.SMTP_HOST?.trim() || '',
  SMTP_PORT: Math.min(
    65535,
    Math.max(1, Number(process.env.SMTP_PORT ?? '587') || 587),
  ),
  SMTP_SECURE: boolEnv('SMTP_SECURE', false),
  SMTP_USER: process.env.SMTP_USER?.trim() || '',
  /** SMTP password (optional for local sinks like Mailpit). */
  SMTP_PASS: process.env.SMTP_PASS ?? '',
  /** RFC5322 From, e.g. `CMMS <noreply@example.com>`. */
  MAIL_FROM: process.env.MAIL_FROM?.trim() || '',
}
