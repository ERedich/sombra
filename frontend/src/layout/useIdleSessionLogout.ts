import { useEffect, useRef } from 'react'
import { apiJson } from '../api'

const ACTIVITY_THROTTLE_MS = 30_000
const CHECK_INTERVAL_MS = 45_000

type AppParametersGeneral = {
  general?: { idle_session_timeout_minutes?: number }
}

/**
 * When `idle_session_timeout_minutes` from `/api/app-parameters` is &gt; 0,
 * signs the user out after that much wall time without throttled user activity.
 */
export function useIdleSessionLogout(onIdle: () => void): void {
  const idleMinutesRef = useRef(0)
  const lastActivityRef = useRef(0)
  const lastBumpWallRef = useRef(0)
  const firedRef = useRef(false)
  const onIdleRef = useRef(onIdle)

  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  const bumpActivity = () => {
    const now = Date.now()
    if (now - lastBumpWallRef.current < ACTIVITY_THROTTLE_MS) return
    lastBumpWallRef.current = now
    lastActivityRef.current = now
  }

  useEffect(() => {
    let cancelled = false

    async function loadTimeoutMinutes() {
      try {
        const data = await apiJson<AppParametersGeneral>('/api/app-parameters')
        if (cancelled) return
        const m = data.general?.idle_session_timeout_minutes
        idleMinutesRef.current =
          typeof m === 'number' && Number.isInteger(m) && m > 0 ? m : 0
        if (idleMinutesRef.current > 0) {
          lastActivityRef.current = Date.now()
          lastBumpWallRef.current = Date.now()
        }
      } catch {
        if (!cancelled) idleMinutesRef.current = 0
      }
    }

    void loadTimeoutMinutes()

    const onVis = () => {
      if (document.visibilityState === 'visible') void loadTimeoutMinutes()
    }
    document.addEventListener('visibilitychange', onVis)

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
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      for (const ev of events) {
        window.removeEventListener(ev, bumpActivity, opts)
      }
      window.clearInterval(interval)
    }
  }, [])
}
