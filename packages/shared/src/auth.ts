/** Keys aligned with web `frontend/src/auth.ts` (localStorage) and mobile SecureStore. */
export const AUTH_STORAGE_KEYS = {
  token: 'cmms_token',
  user: 'cmms_user',
} as const

export type SiteOption = { id: string; key: string; name: string }

export type AuthUser = {
  id: string
  login_name: string
  name: string
  role: string
  employee_id: string | null
  employee_workgroup_ids: string[]
  working_site_id: string | null
  locale: string
  allow_site_change_on_login: boolean
  additional_site_ids: string[]
  accessible_site_ids: string[]
  selectable_working_sites: SiteOption[]
}

export function normalizeAuthUser(u: AuthUser & { key?: string }): AuthUser {
  if (typeof u.login_name !== 'string' && typeof u.key === 'string') {
    u.login_name = u.key
  }
  if (!Array.isArray(u.additional_site_ids)) u.additional_site_ids = []
  if (!Array.isArray(u.accessible_site_ids)) u.accessible_site_ids = []
  if (!Array.isArray(u.selectable_working_sites)) u.selectable_working_sites = []
  if (typeof u.allow_site_change_on_login !== 'boolean') {
    u.allow_site_change_on_login = false
  }
  if (u.employee_id === undefined) u.employee_id = null
  if (!Array.isArray(u.employee_workgroup_ids)) u.employee_workgroup_ids = []
  if (u.working_site_id === undefined) u.working_site_id = null
  if (typeof u.locale !== 'string' || u.locale.length === 0) u.locale = 'en'
  return u as AuthUser
}
