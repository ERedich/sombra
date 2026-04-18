import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { cmmsPaths } from '@sombra/shared'
import type { Toast } from 'primereact/toast'
import { apiJson } from '../../api'
import { EntityDocumentsControl } from './EntityDocumentsControl'
import type { DocumentCountsResponse, DocumentEntityType } from './types'

type Options = {
  /** Optional shared toast used by the single-row dialog. */
  toastRef?: RefObject<Toast | null>
}

type UseDocumentsAssignmentsResult = {
  /** Per-entity document count sourced from /api/documents/counts. */
  counts: Map<string, number>
  /** Open the per-row (single) documents dialog for this entity id. */
  openSingle: (entityType: DocumentEntityType, entityId: string) => void
  /**
   * Force a re-fetch of the counts. Pass this to `BulkDocumentsControl.onChanged`
   * so external mutations stay in sync with the column badges.
   */
  refresh: () => void
  /**
   * Hidden-triggered single dialog for the per-row cell. Mount it once
   * somewhere in the tree; it manages its own visibility internally.
   */
  singleDialog: ReactNode
}

/**
 * State/plumbing for the "Assignments" column on document-enabled apps:
 * aggregate counts for the provided ids and a controlled single-entity
 * dialog (triggered from the per-row cell). The bulk toolbar button is
 * rendered separately by each page so it can scope to its own filtered
 * row set without re-triggering count fetches.
 */
export function useDocumentsAssignments(
  entityType: DocumentEntityType,
  entityIds: string[],
  options: Options = {},
): UseDocumentsAssignmentsResult {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const stableIds = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of entityIds) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }, [entityIds])
  const idsKey = stableIds.join(',')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (stableIds.length === 0) {
        if (!cancelled) setCounts(new Map())
        return
      }
      try {
        const data = await apiJson<DocumentCountsResponse>(
          `${cmmsPaths.documentsCounts}?entity_type=${encodeURIComponent(entityType)}&entity_ids=${encodeURIComponent(idsKey)}`,
        )
        if (cancelled) return
        const next = new Map<string, number>()
        for (const id of stableIds) {
          const raw = data.counts?.[id] ?? 0
          const n = Number(raw)
          next.set(id, Number.isFinite(n) ? n : 0)
        }
        setCounts(next)
      } catch {
        if (!cancelled) setCounts(new Map())
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [entityType, idsKey, stableIds, refreshKey])

  const openSingle = useCallback(
    (_type: DocumentEntityType, id: string) => {
      setActiveEntityId(id)
      setDialogOpen(true)
    },
    [],
  )

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const singleDialog = (
    <EntityDocumentsControl
      entityType={entityType}
      entityId={activeEntityId}
      toastRef={options.toastRef}
      showTrigger={false}
      open={dialogOpen}
      onOpenChange={(next) => {
        setDialogOpen(next)
        if (!next) setActiveEntityId(null)
      }}
      onChanged={refresh}
    />
  )

  return {
    counts,
    openSingle,
    refresh,
    singleDialog,
  }
}
