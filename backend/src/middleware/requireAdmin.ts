import type { RequestHandler } from 'express'

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.authUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required.' })
    return
  }
  next()
}
