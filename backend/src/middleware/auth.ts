import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../env.js'

export type AuthUser = {
  id: string
  login_name: string
  name: string
  role: string
  working_site_id: string | null
  /** app_locales.code */
  locale: string
}

type JwtUserClaims = {
  sub: string
  login_name?: string
  /** Legacy tokens issued before login_name migration */
  key?: string
  name: string
  role: string
  working_site_id?: string | null
  locale?: string
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization
  const match = header?.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET) as JwtUserClaims
    const ws = payload.working_site_id
    const loc = payload.locale
    req.authUser = {
      id: payload.sub,
      login_name:
        typeof payload.login_name === 'string'
          ? payload.login_name
          : typeof payload.key === 'string'
            ? payload.key
            : '',
      name: payload.name,
      role: payload.role,
      working_site_id:
        typeof ws === 'string' && ws.length > 0 ? ws : null,
      locale:
        typeof loc === 'string' && loc.length > 0 ? loc : 'en',
    }
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser
  }
}
