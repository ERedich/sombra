import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { postAuthLogout } from '../api'
import { clearAuth, getToken } from '../auth'
import { useIdleSessionLogout } from './useIdleSessionLogout'

/**
 * Renders nothing; keeps idle-logout hooks out of AppShell so React Fast Refresh
 * does not desync hook order when the idle hook changes.
 */
export function IdleSessionLogoutController() {
  const navigate = useNavigate()
  const onIdle = useCallback(() => {
    if (!getToken()) return
    void postAuthLogout()
    clearAuth()
    navigate('/login', { replace: true, state: { reason: 'idle' } })
  }, [navigate])
  useIdleSessionLogout(onIdle)
  return null
}
