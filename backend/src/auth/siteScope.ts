import type { Pool, PoolClient } from 'pg'

export type UserSiteScope = {
  isAdmin: boolean
  workingSiteId: string | null
  additionalSiteIds: string[]
}

type Db = Pool | PoolClient

/**
 * Current `users.working_site_id` from the database.
 * Use for server-side row scope when the client may have refreshed `cmms_user`
 * via `GET /api/auth/me` without replacing the JWT (token claims can lag).
 */
export async function loadUserDbWorkingSiteId(
  db: Db,
  userId: string,
): Promise<string | null> {
  const r = await db.query<{ working_site_id: string | null }>(
    `SELECT working_site_id FROM users WHERE id = $1`,
    [userId],
  )
  const ws = r.rows[0]?.working_site_id
  if (typeof ws !== 'string') return null
  const t = ws.trim()
  return t.length > 0 ? t : null
}

export async function loadUserSiteScope(
  db: Db,
  userId: string,
  role: string,
): Promise<UserSiteScope> {
  const [u, add] = await Promise.all([
    db.query<{
      working_site_id: string | null
    }>(`SELECT working_site_id FROM users WHERE id = $1`, [userId]),
    db.query<{ site_id: string }>(
      `SELECT site_id FROM user_additional_sites WHERE user_id = $1 ORDER BY site_id`,
      [userId],
    ),
  ])
  const row = u.rows[0]
  const additionalSiteIds = add.rows.map((r) => r.site_id)
  return {
    isAdmin: role === 'admin',
    workingSiteId: row?.working_site_id ?? null,
    additionalSiteIds,
  }
}

/** For non-admin: distinct site ids the user may read. Admins: null means unrestricted. */
export function accessibleSiteIds(scope: UserSiteScope): string[] | null {
  if (scope.isAdmin) return null
  const set = new Set<string>()
  if (scope.workingSiteId) set.add(scope.workingSiteId)
  for (const id of scope.additionalSiteIds) set.add(id)
  return [...set]
}

export function canAccessSite(
  scope: UserSiteScope,
  siteId: string,
): boolean {
  if (scope.isAdmin) return true
  const ids = accessibleSiteIds(scope)
  return ids !== null && ids.includes(siteId)
}

/** Allowed targets for POST /auth/working-site (working ∪ additional, all must exist in DB). */
export function allowedWorkingSiteChoices(scope: UserSiteScope): Set<string> {
  const set = new Set<string>()
  if (scope.workingSiteId) set.add(scope.workingSiteId)
  for (const id of scope.additionalSiteIds) set.add(id)
  return set
}
