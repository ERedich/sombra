import { useEffect, useRef } from 'react'

const ACTIVITY_THROTTLE_MS = 30_000
const CHECK_INTERVAL_MS = 45_000

/**
 * When `idleMinutes` is &gt; 0, signs the user out after that much wall time
 * without throttled user activity. Minutes come from `AppParametersProvider`.
 */
export function useIdleSessionLogout(
  onIdle: () => void,
  idleMinutes: number,
): void {
  const idleMinutesRef = useRef(0)
  const lastActivityRef = useRef(0)
  const lastBumpWallRef = useRef(0)
  const firedRef = useRef(false)
  const onIdleRef = useRef(onIdle)

  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  useEffect(() => {
    idleMinutesRef.current =
      typeof idleMinutes === 'number' &&
      Number.isInteger(idleMinutes) &&
      idleMinutes > 0
        ? idleMinutes
        : 0
    if (idleMinutesRef.current > 0) {
      lastActivityRef.current = Date.now()
      lastBumpWallRef.current = Date.now()
      firedRef.current = false
    }
  }, [idleMinutes])

  const bumpActivity = () => {
    const now = Date.now()
    if (now - lastBumpWallRef.current < ACTIVITY_THROTTLE_MS) return
    lastBumpWallRef.current = now
    lastActivityRef.current = now
  }

  useEffect(() => {
    const opts = { capture: true, passive: true } as const
    const events = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'focus',
    ] as const
    for (const ev of events) {
      window.addEventListener(ev, bumpActivity, opts)
    }

    const interval = window.setInterval(() => {
      const mins = idleMinutesRef.current
      if (mins <= 0 || firedRef.current) return
      const ms = mins * 60_000
      if (Date.now() - lastActivityRef.current >= ms) {
        firedRef.current = true
        onIdleRef.current()
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, bumpActivity, opts)
      }
      window.clearInterval(interval)
    }
  }, [])
}
