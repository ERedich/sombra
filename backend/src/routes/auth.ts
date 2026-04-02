import { Router } from 'express'
import bcrypt from 'bcrypt'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { appendAuditLog } from '../audit/auditLog.js'
import {
  accessibleSiteIds,
  allowedWorkingSiteChoices,
  loadUserSiteScope,
} from '../auth/siteScope.js'
import { pool } from '../db.js'
import { env } from '../env.js'

const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
})

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SiteOption = { id: string; key: string; name: string }

export type PublicAuthUser = {
  id: string
  login_name: string
  name: string
  role: string
  working_site_id: string | null
  /** app_locales.code */
  locale: string
  allow_site_change_on_login: boolean
  additional_site_ids: string[]
  accessible_site_ids: string[]
  /** Working ∪ additional; labels for login-time site picker */
  selectable_working_sites: SiteOption[]
}

type JwtUserClaims = {
  sub: string
  login_name?: string
  key?: string
  name: string
  role: string
  working_site_id: string | null
  locale: string
}

async function getAccessibleSiteIdsForResponse(
  scope: Awaited<ReturnType<typeof loadUserSiteScope>>,
): Promise<string[]> {
  if (scope.isAdmin) {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sites ORDER BY name ASC, key ASC`,
    )
    return r.rows.map((x) => x.id)
  }
  return accessibleSiteIds(scope) ?? []
}

async function loadPreferredLocale(userId: string): Promise<string> {
  const r = await pool.query<{ preferred_locale: string }>(
    `SELECT preferred_locale FROM users WHERE id = $1`,
    [userId],
  )
  return r.rows[0]?.preferred_locale ?? 'en'
}

/** Resolves requested locale to an enabled app_locales.code, defaulting to `en`. */
async function resolveLocale(requested: unknown): Promise<string> {
  const raw =
    typeof requested === 'string' ? requested.trim().toLowerCase() : ''
  if (!raw) {
    return 'en'
  }
  const r = await pool.query<{ code: string }>(
    `SELECT code FROM app_locales WHERE lower(code) = lower($1) AND enabled = true LIMIT 1`,
    [raw],
  )
  return r.rows[0]?.code ?? 'en'
}

async function buildPublicAuthUser(
  id: string,
  login_name: string,
  name: string,
  role: string,
): Promise<PublicAuthUser> {
  const locale = await loadPreferredLocale(id)
  const scope = await loadUserSiteScope(pool, id, role)
  const accessible_site_ids = await getAccessibleSiteIdsForResponse(scope)
  const choiceIds = [
    ...new Set(
      [scope.workingSiteId, ...scope.additionalSiteIds].filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      ),
    ),
  ]
  let selectable_working_sites: SiteOption[] = []
  if (choiceIds.length > 0) {
    const opt = await pool.query<SiteOption>(
      `SELECT id, key, name FROM sites WHERE id = ANY($1::uuid[])
       ORDER BY name ASC, key ASC`,
      [choiceIds],
    )
    selectable_working_sites = opt.rows
  }
  return {
    id,
    login_name,
    name,
    role,
    working_site_id: scope.workingSiteId,
    locale,
    allow_site_change_on_login: scope.allowSiteChangeOnLogin,
    additional_site_ids: scope.additionalSiteIds,
    accessible_site_ids,
    selectable_working_sites,
  }
}

function signToken(claims: JwtUserClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: '7d' })
}

router.post('/login', loginLimiter, async (req, res) => {
  const loginNameRaw =
    typeof req.body?.login_name === 'string'
      ? req.body.login_name.trim()
      : typeof req.body?.key === 'string'
        ? req.body.key.trim()
        : ''
  const password =
    typeof req.body?.password === 'string' ? req.body.password : ''
  if (!loginNameRaw || !password) {
    res.status(400).json({ error: 'Login name and password are required.' })
    return
  }

  const r = await pool.query<{
    id: string
    login_name: string
    name: string
    role: string
    password_hash: string
  }>(
    `SELECT id, login_name, name, role, password_hash
     FROM users
     WHERE login_name = $1 OR (email IS NOT NULL AND lower(email) = lower($1))
     LIMIT 1`,
    [loginNameRaw],
  )

  const user = r.rows[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials.' })
    return
  }

  const locale = await resolveLocale(req.body?.locale)
  await pool.query(
    `UPDATE users SET preferred_locale = $1, updated_at = now() WHERE id = $2`,
    [locale, user.id],
  )

  const scope = await loadUserSiteScope(pool, user.id, user.role)
  const claims: JwtUserClaims = {
    sub: user.id,
    login_name: user.login_name,
    name: user.name,
    role: user.role,
    working_site_id: scope.workingSiteId,
    locale,
  }

  const loginPath = `${req.baseUrl}${req.path}`
  await appendAuditLog(pool, {
    actorUserId: user.id,
    actorKey: user.login_name,
    actorName: user.name,
    operation: 'create',
    resourceType: 'auth_login',
    resourceId: user.id,
    beforeState: null,
    afterState: { userId: user.id, login_name: user.login_name },
    fieldChanges: null,
    httpMethod: req.method,
    path: loginPath,
  })

  const token = signToken(claims)
  const publicUser = await buildPublicAuthUser(
    user.id,
    user.login_name,
    user.name,
    user.role,
  )

  res.json({ token, user: publicUser })
})

router.get('/me', async (_req, res) => {
  const header = _req.headers.authorization
  const match = header?.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET) as JwtUserClaims
    const loginName =
      typeof payload.login_name === 'string'
        ? payload.login_name
        : typeof payload.key === 'string'
          ? payload.key
          : ''
    const publicUser = await buildPublicAuthUser(
      payload.sub,
      loginName,
      payload.name,
      payload.role,
    )
    res.json({ user: publicUser })
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
})

router.post('/working-site', async (req, res) => {
  const header = req.headers.authorization
  const match = header?.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  let payload: JwtUserClaims
  try {
    payload = jwt.verify(match[1], env.JWT_SECRET) as JwtUserClaims
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const siteId =
    typeof req.body?.working_site_id === 'string'
      ? req.body.working_site_id.trim()
      : ''
  if (!siteId || !UUID_RE.test(siteId)) {
    res.status(400).json({ error: 'Valid working_site_id is required.' })
    return
  }

  const userId = payload.sub
  const boot = await pool.query<{ login_name: string }>(
    `SELECT login_name FROM users WHERE id = $1`,
    [userId],
  )
  if (boot.rows[0]?.login_name === 'admin') {
    res.status(403).json({
      error: 'The bootstrap admin user cannot be modified.',
    })
    return
  }

  const role = payload.role
  const scope = await loadUserSiteScope(pool, userId, role)

  const siteExists = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [
    siteId,
  ])
  if (siteExists.rowCount === 0) {
    res.status(400).json({ error: 'Site not found.' })
    return
  }

  if (!scope.isAdmin) {
    const allowed = allowedWorkingSiteChoices(scope)
    if (!allowed.has(siteId)) {
      res.status(403).json({ error: 'That site is not assigned to your user.' })
      return
    }
  }

  await pool.query(
    `UPDATE users SET working_site_id = $1, updated_at = now() WHERE id = $2`,
    [siteId, userId],
  )

  const loginName =
    typeof payload.login_name === 'string'
      ? payload.login_name
      : typeof payload.key === 'string'
        ? payload.key
        : ''

  await appendAuditLog(pool, {
    actorUserId: userId,
    actorKey: loginName,
    actorName: payload.name,
    operation: 'update',
    resourceType: 'auth_working_site',
    resourceId: userId,
    beforeState: null,
    afterState: { working_site_id: siteId },
    fieldChanges: null,
    httpMethod: req.method,
    path: `${req.baseUrl}${req.path}`,
  })

  const locale = await loadPreferredLocale(userId)

  const newClaims: JwtUserClaims = {
    sub: userId,
    login_name: loginName,
    name: payload.name,
    role,
    working_site_id: siteId,
    locale,
  }
  const token = signToken(newClaims)
  const publicUser = await buildPublicAuthUser(
    userId,
    loginName,
    payload.name,
    role,
  )

  res.json({ token, user: publicUser })
})

export default router
