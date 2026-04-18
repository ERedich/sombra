import type { ClientAction } from '@sombra/shared'
import { buildWebPath } from '@sombra/shared'
import type { NavigateFunction } from 'react-router-dom'

function searchParamsNormalizedEqual(a: string, b: string): boolean {
  const na = a.startsWith('?') ? a.slice(1) : a
  const nb = b.startsWith('?') ? b.slice(1) : b
  const pa = new URLSearchParams(na)
  const pb = new URLSearchParams(nb)
  if (pa.toString() === pb.toString()) return true
  const sa = [...pa.entries()].sort(([x], [y]) => x.localeCompare(y))
  const sb = [...pb.entries()].sort(([x], [y]) => x.localeCompare(y))
  return (
    sa.length === sb.length &&
    sa.every(([k, v], i) => k === sb[i]?.[0] && v === sb[i]?.[1])
  )
}

/** Apply copilot `client_actions` (navigation, open/close Kira). */
export function applyKiraClientActions(
  actions: ClientAction[] | undefined,
  opts: {
    navigate: NavigateFunction
    location: { pathname: string; search: string }
    openKira: () => void
    closeKira: () => void
  },
) {
  if (!actions?.length) return
  for (const action of actions) {
    if (action.type === 'shell' && action.action === 'open_kira') {
      opts.openKira()
      continue
    }
    if (action.type === 'navigate') {
      const { pathname, search } = buildWebPath(action.app, action.entityId)
      const samePath = opts.location.pathname === pathname
      const sameSearch = searchParamsNormalizedEqual(
        opts.location.search,
        search,
      )
      if (!samePath || !sameSearch) {
        opts.navigate({ pathname, search })
      }
      if (action.closeKira === true) opts.closeKira()
    }
  }
}
