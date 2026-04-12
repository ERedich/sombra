import {
  authPaths,
  type AuthUser,
  normalizeAuthUser,
} from '@sombra/shared';
import { clearSession, getToken } from './sessionStorage';
import { apiBaseUrl } from './config';

const FETCH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export async function fetchWithAuth(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const method = (init?.method ?? 'GET').toUpperCase()
  const skipJsonContentType = init?.body instanceof FormData
  if (
    !skipJsonContentType &&
    !headers.has('Content-Type') &&
    (init?.body != null || ['POST', 'PATCH', 'PUT'].includes(method))
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const url = `${apiBaseUrl}${path}`
  return fetchWithTimeout(url, { ...init, headers })
}

export async function postAuthLogout(): Promise<void> {
  const token = await getToken()
  if (!token || !apiBaseUrl) return
  try {
    await fetchWithTimeout(`${apiBaseUrl}${authPaths.logout}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* ignore */
  }
}

export async function loginRequest(
  login_name: string,
  password: string,
  locale?: string,
): Promise<{
  token: string
  user: AuthUser
  parallel_session_warning: boolean
}> {
  const res = await fetchWithTimeout(`${apiBaseUrl}${authPaths.login}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login_name,
      password,
      ...(locale ? { locale } : {}),
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  if (typeof body?.token !== 'string' || !body?.user) {
    throw new ApiError('Invalid login response', res.status, body)
  }
  return {
    token: body.token,
    user: normalizeAuthUser(body.user as AuthUser & { key?: string }),
    parallel_session_warning: body.parallel_session_warning === true,
  }
}

export async function meRequest(): Promise<AuthUser> {
  const res = await fetchWithAuth(authPaths.me, { method: 'GET' })
  const body = await res.json().catch(() => null)
  if (res.status === 401) {
    await clearSession()
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  if (!res.ok) {
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  if (!body?.user) {
    throw new ApiError('Invalid /me response', res.status, body)
  }
  return normalizeAuthUser(body.user as AuthUser & { key?: string })
}

/** Updates working site; response includes a new JWT. */
export async function workingSiteRequest(
  working_site_id: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetchWithAuth(authPaths.workingSite, {
    method: 'POST',
    body: JSON.stringify({ working_site_id }),
  })
  const body = await res.json().catch(() => null)
  if (res.status === 401) {
    await clearSession()
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  if (!res.ok) {
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  if (typeof body?.token !== 'string' || !body?.user) {
    throw new ApiError('Invalid working-site response', res.status, body)
  }
  return {
    token: body.token,
    user: normalizeAuthUser(body.user as AuthUser & { key?: string }),
  }
}
