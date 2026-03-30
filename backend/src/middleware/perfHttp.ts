import type { NextFunction, Request, Response } from 'express'

/**
 * Adds X-Response-Time (server processing ms) before the response is sent,
 * so the browser can compare with fetch TTFB (network + server).
 */
export function responseTimeHeader(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = performance.now()
  const origEnd = res.end.bind(res)
  res.end = function (this: Response, ...args: unknown[]) {
    const ms = Math.round(performance.now() - start)
    try {
      if (!res.headersSent) {
        res.setHeader('X-Response-Time', `${ms}ms`)
      }
    } catch {
      /* ignore */
    }
    return origEnd.apply(res, args as Parameters<typeof origEnd>)
  }
  next()
}
