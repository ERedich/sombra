import { clearAuth, getToken, setAuth, type AuthUser } from './auth'

/**
 * Empty string = same origin (use Vite `server.proxy` in dev, or nginx in prod).
 * Set `VITE_API_URL` when the API is on another origin (e.g. hosted API).
 */
export const apiBase = import.meta.env.VITE_API_URL ?? ''

/** Set `VITE_API_TIMING=false` to silence browser console timing lines. */
function shouldLogApiTiming(): boolean {
  if (import.meta.env.VITE_API_TIMING === 'false') return false
  return import.meta.env.VITE_API_TIMING === 'true' || import.meta.env.DEV
}

function parseServerMs(header: string | null): number | undefined {
  if (!header) return undefined
  const m = /^(\d+(?:\.\d+)?)ms$/i.exec(header.trim())
  if (!m) return undefined
  return Number(m[1])
}

function logApiLine(
  path: string,
  init: RequestInit | undefined,
  ttfb: number,
  jsonMs: number | null,
  totalMs: number,
  res: Response,
): void {
  const srv = parseServerMs(res.headers.get('X-Response-Time'))
  const net =
    srv !== undefined ? Math.max(0, ttfb - srv) : undefined
  const method = (init?.method ?? 'GET').toUpperCase()
  const netPart = net !== undefined ? ` net≈${net.toFixed(0)}ms` : ''
  const srvPart = srv !== undefined ? ` server=${srv.toFixed(0)}ms` : ''
  if (jsonMs === null) {
    console.debug(
      `[api] ${method} ${path} ttfb=${ttfb.toFixed(0)}ms${srvPart}${netPart}`,
    )
    return
  }
  console.debug(
    `[api] ${method} ${path} ttfb=${ttfb.toFixed(0)}ms${srvPart}${netPart} json=${jsonMs.toFixed(0)}ms total=${totalMs.toFixed(0)}ms`,
  )
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

async function fetchWithAuth(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
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

  const res = await fetch(`${apiBase}${path}`, { ...init, headers })

  if (res.status === 401) {
    clearAuth()
    window.location.assign('/login')
  }

  return res
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const timing = shouldLogApiTiming()
  const t0 = timing ? performance.now() : 0
  const res = await fetchWithAuth(path, init)
  if (timing) {
    const ttfb = performance.now() - t0
    logApiLine(path, init, ttfb, null, ttfb, res)
  }
  return res
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const timing = shouldLogApiTiming()
  const t0 = timing ? performance.now() : 0
  const res = await fetchWithAuth(path, init)
  const tAfterFetch = timing ? performance.now() : 0
  const ttfb = timing ? tAfterFetch - t0 : 0

  if (res.status === 204) {
    if (timing) {
      logApiLine(path, init, ttfb, 0, performance.now() - t0, res)
    }
    return undefined as T
  }

  const tParse0 = timing ? performance.now() : 0
  const data: unknown = await res.json().catch(() => ({}))
  const jsonMs = timing ? performance.now() - tParse0 : 0
  const totalMs = timing ? performance.now() - t0 : 0

  if (timing) {
    logApiLine(path, init, ttfb, jsonMs, totalMs, res)
  }

  if (!res.ok) {
    const errObj = data as { error?: string }
    const msg =
      typeof errObj?.error === 'string' ? errObj.error : res.statusText
    throw new ApiError(msg, res.status, data)
  }
  return data as T
}

/** Authenticated GET returning raw bytes (e.g. thumbnails). */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await apiFetch(path)
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => ({}))
    const errObj = data as { error?: string }
    const msg =
      typeof errObj?.error === 'string' ? errObj.error : res.statusText
    throw new ApiError(msg, res.status, data)
  }
  return res.blob()
}

/**
 * Re-sync `cmms_user` from the server (e.g. after `users.employee_id` was set).
 * JWT does not carry `employee_id`; without this, WO Start stays disabled until re-login.
 */
export async function refreshStoredAuthUser(): Promise<void> {
  const token = getToken()
  if (!token) return
  try {
    const data = await apiJson<{ user: AuthUser }>('/api/auth/me')
    if (data?.user) {
      setAuth(token, data.user)
    }
  } catch {
    /* 401 → fetchWithAuth clears session; other errors leave stored user as-is */
  }
}

/** Removes server-side session row; does not clear local storage. Use before clearAuth on logout/idle. */
export async function postAuthLogout(): Promise<void> {
  const token = getToken()
  if (!token) return
  try {
    await fetch(`${apiBase}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* ignore network errors */
  }
}
