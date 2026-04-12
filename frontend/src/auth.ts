import {
  AUTH_STORAGE_KEYS,
  type AuthUser,
  type SiteOption,
  normalizeAuthUser,
} from '@sombra/shared'

const TOKEN_KEY = AUTH_STORAGE_KEYS.token
const USER_KEY = AUTH_STORAGE_KEYS.user

export type { AuthUser, SiteOption }
export { normalizeAuthUser }

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return normalizeAuthUser(JSON.parse(raw) as AuthUser & { key?: string })
  } catch {
    return null
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeAuthUser({ ...user })))
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
