/**
 * Range-fetched cache for the monitoring work-orders list.
 *
 * The cache owns a compact `rows` array that starts empty and grows as chunks
 * come back from the server. On a new query it resets, fetches chunk 0, and
 * then pre-fetches the remaining chunks sequentially in the background so the
 * monitoring table is "fully loaded" without a blocking waterfall. WebSocket
 * mutations (`prependRow`, `insertRow`, `patchRow`, `removeRow`) keep `rows`
 * and `total` in sync without triggering a refetch.
 *
 * The cache intentionally has no knowledge of the monitoring app's flash /
 * highlight / delete-hold timers — those stay in `WorkOrdersAppPage.tsx`.
 * The component calls both the cache mutator and the existing flash helpers
 * when a WS event fires so animations continue to work exactly as before.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, apiJson } from '../../api'
import type { WorkOrder } from './workOrderTypes'
import {
  buildWorkOrderQuery,
  compareForSort,
  type ResolvedQuery,
} from './workOrderListQuery'

type WorkOrdersListResponse = {
  work_orders: WorkOrder[]
  total?: number
  offset?: number
  limit?: number
}

/** Page size used for each range fetch. Keep aligned with backend `DEFAULT_LIST_LIMIT`. */
export const WORK_ORDER_CACHE_CHUNK_SIZE = 500

type CacheState = {
  rows: WorkOrder[]
  total: number
  loading: boolean
  /** Count of chunks fetched so far. Next chunk to request is `loadedChunks`. */
  loadedChunks: number
  /** True when a WS event arrived that doesn't fit the active sort cleanly. */
  stale: boolean
  /** Fingerprint of the query this cache was populated for. */
  queryFingerprint: string
  /** Monotonic generation id; bumped on query change so stale fetches bail. */
  generation: number
}

function emptyState(queryFingerprint: string, generation: number): CacheState {
  return {
    rows: [],
    total: 0,
    loading: false,
    loadedChunks: 0,
    stale: false,
    queryFingerprint,
    generation,
  }
}

function fingerprintQuery(q: ResolvedQuery): string {
  const multi = Object.keys(q.multiselects)
    .sort()
    .map((k) => `${k}=${(q.multiselects[k] ?? []).slice().sort().join(',')}`)
    .join('&')
  const dates = Object.keys(q.dateRanges)
    .sort()
    .map((k) => {
      const r = q.dateRanges[k]
      return `${k}=${r?.from ?? ''}|${r?.to ?? ''}`
    })
    .join('&')
  return `sort=${q.sort.field}:${q.sort.order}&search=${q.search}&${multi}&${dates}`
}

/** Rebuild the full `TableSearchSettingsV1.criteria` shape from a `ResolvedQuery`. */
function resolvedQueryToAppliedCriteria(q: ResolvedQuery) {
  const out: Record<
    string,
    { from: string; to: string; selectedValues: string[] }
  > = {}
  for (const [k, v] of Object.entries(q.multiselects)) {
    out[k] = { from: '', to: '', selectedValues: v ?? [] }
  }
  for (const [k, v] of Object.entries(q.dateRanges)) {
    out[k] = { from: v?.from ?? '', to: v?.to ?? '', selectedValues: [] }
  }
  return out
}

export type WorkOrderListCacheMutators = {
  /**
   * Insert at index 0 (current sort is `wo_key desc` — newest first). Shifts
   * all existing rows by one. Caller is responsible for checking that the WS
   * event matches the active filters *and* that the sort puts the new row on
   * top; otherwise use `insertRow`.
   */
  prependRow(wo: WorkOrder): void
  /**
   * Insert according to the active sort comparator among the loaded rows.
   * Increments `total`. Flags the cache as `stale` when the row's sort key
   * precedes some rows that aren't loaded yet — the UI shows a refresh pill.
   */
  insertRow(wo: WorkOrder): void
  /**
   * Replace a row in place. Returns true when the row was found in the cache.
   */
  patchRow(wo: WorkOrder): boolean
  /** Remove by id. Decrements total when found. */
  removeRow(id: string): boolean
  /** Hide the stale pill (user dismissed it without refreshing). */
  dismissStale(): void
  /** Force-flag `stale` — used when a WS event is known to affect ordering. */
  markStale(): void
}

export type UseWorkOrderListCacheReturn = WorkOrderListCacheMutators & {
  rows: WorkOrder[]
  total: number
  loading: boolean
  stale: boolean
  /** True once every chunk has been fetched (`rows.length >= total`). */
  fullyLoaded: boolean
  /** Force a full reset + refetch. Also clears `stale`. */
  refresh(): void
  getById(id: string): WorkOrder | undefined
}

export type UseWorkOrderListCacheArgs = {
  /** When false, the hook becomes inert — no fetches, empty rows. */
  enabled: boolean
  /** Active query. Replace the reference to trigger a reset + first fetch. */
  query: ResolvedQuery
  /** Called with a human-readable message on fetch failure. */
  onError?: (message: string) => void
}

export function useWorkOrderListCache({
  enabled,
  query,
  onError,
}: UseWorkOrderListCacheArgs): UseWorkOrderListCacheReturn {
  const queryFingerprint = useMemo(() => fingerprintQuery(query), [query])
  const [state, setState] = useState<CacheState>(() => emptyState(queryFingerprint, 0))
  // Latest-value refs: all consumers (fetchChunk, mutations, refresh) run
  // inside effects or event handlers, so a commit-time sync via useEffect
  // is sufficient -- the refs are always current by the time they're read.
  const stateRef = useRef(state)
  const onErrorRef = useRef(onError)
  const queryRef = useRef(query)
  useEffect(() => {
    stateRef.current = state
    onErrorRef.current = onError
    queryRef.current = query
  })
  const generationRef = useRef(0)

  const fetchChunk = useCallback(
    async (chunk: number, expectedGeneration: number) => {
      const offset = chunk * WORK_ORDER_CACHE_CHUNK_SIZE
      const q = queryRef.current
      const params = buildWorkOrderQuery({
        sort: q.sort,
        search: q.search,
        applied: { version: 1, criteria: resolvedQueryToAppliedCriteria(q) },
        limit: WORK_ORDER_CACHE_CHUNK_SIZE,
        offset,
      })
      try {
        const data = await apiJson<WorkOrdersListResponse>(
          `/api/work-orders?${params.toString()}`,
        )
        setState((prev) => {
          if (prev.generation !== expectedGeneration) return prev
          const list = data.work_orders ?? []
          const total =
            typeof data.total === 'number'
              ? data.total
              : Math.max(prev.total, offset + list.length)
          // Rows are appended in order (chunk indices are fetched sequentially).
          const rows = prev.rows.concat(list)
          return {
            ...prev,
            rows,
            total,
            loadedChunks: chunk + 1,
            loading: rows.length < total,
          }
        })
      } catch (err) {
        setState((prev) => {
          if (prev.generation !== expectedGeneration) return prev
          return { ...prev, loading: false }
        })
        if (err instanceof ApiError || err instanceof Error) {
          onErrorRef.current?.(err.message)
        }
      }
    },
    [],
  )

  // Reset-and-load effect: runs on every query change or enable toggle.
  useEffect(() => {
    if (!enabled) {
      const gen = ++generationRef.current
      setState(emptyState(queryFingerprint, gen))
      return
    }
    const gen = ++generationRef.current
    setState({ ...emptyState(queryFingerprint, gen), loading: true })
    void fetchChunk(0, gen)
  }, [enabled, queryFingerprint, fetchChunk])

  // Background pre-fetch: after each state update, kick the next chunk if any.
  useEffect(() => {
    if (!enabled) return
    if (state.loading === false && state.rows.length >= state.total) return
    if (state.loadedChunks === 0) return // chunk 0 still resolving
    if (state.rows.length >= state.total) return
    // A chunk is in flight if loading=true *and* last attempt hasn't landed.
    // We wait for the previous chunk to resolve before scheduling the next so
    // the server sees serial paging (stable offset-based pagination).
    if (state.loading) return
    const nextChunk = state.loadedChunks
    setState((prev) => {
      if (prev.generation !== generationRef.current) return prev
      if (prev.rows.length >= prev.total) return prev
      return { ...prev, loading: true }
    })
    void fetchChunk(nextChunk, generationRef.current)
  }, [
    enabled,
    state.loading,
    state.loadedChunks,
    state.rows.length,
    state.total,
    fetchChunk,
  ])

  const refresh = useCallback(() => {
    if (!enabled) return
    const gen = ++generationRef.current
    setState({ ...emptyState(queryFingerprint, gen), loading: true })
    void fetchChunk(0, gen)
  }, [enabled, queryFingerprint, fetchChunk])

  const prependRow = useCallback((wo: WorkOrder) => {
    setState((prev) => {
      const existingIdx = prev.rows.findIndex((r) => r.id === wo.id)
      let rows = prev.rows
      let total = prev.total
      if (existingIdx >= 0) {
        rows = [wo, ...rows.slice(0, existingIdx), ...rows.slice(existingIdx + 1)]
      } else {
        rows = [wo, ...rows]
        total = prev.total + 1
      }
      return { ...prev, rows, total }
    })
  }, [])

  const insertRow = useCallback((wo: WorkOrder) => {
    setState((prev) => {
      const existingIdx = prev.rows.findIndex((r) => r.id === wo.id)
      let total = prev.total
      let rows = prev.rows
      if (existingIdx >= 0) {
        rows = [...rows.slice(0, existingIdx), ...rows.slice(existingIdx + 1)]
      } else {
        total = prev.total + 1
      }
      const sort = queryRef.current.sort
      let insertAt = rows.length
      for (let i = 0; i < rows.length; i++) {
        if (compareForSort(wo, rows[i], sort) <= 0) {
          insertAt = i
          break
        }
      }
      rows = [...rows.slice(0, insertAt), wo, ...rows.slice(insertAt)]
      // If rows aren't fully loaded yet, we can't be sure the new row
      // actually belongs in the loaded slice — flag stale so the user can
      // refresh to see the authoritative ordering.
      const stale = prev.stale || rows.length < total
      return { ...prev, rows, total, stale }
    })
  }, [])

  const patchRow = useCallback((wo: WorkOrder): boolean => {
    let found = false
    setState((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === wo.id)
      if (idx < 0) return prev
      found = true
      const rows = prev.rows.slice()
      rows[idx] = wo
      return { ...prev, rows }
    })
    return found
  }, [])

  const removeRow = useCallback((id: string): boolean => {
    let found = false
    setState((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === id)
      if (idx < 0) return prev
      found = true
      const rows = [...prev.rows.slice(0, idx), ...prev.rows.slice(idx + 1)]
      return { ...prev, rows, total: Math.max(0, prev.total - 1) }
    })
    return found
  }, [])

  const dismissStale = useCallback(() => {
    setState((prev) => (prev.stale ? { ...prev, stale: false } : prev))
  }, [])

  const markStale = useCallback(() => {
    setState((prev) => (prev.stale ? prev : { ...prev, stale: true }))
  }, [])

  const getById = useCallback(
    (id: string): WorkOrder | undefined =>
      stateRef.current.rows.find((r) => r.id === id),
    [],
  )

  const fullyLoaded = state.total > 0 && state.rows.length >= state.total

  return {
    rows: state.rows,
    total: state.total,
    loading: state.loading,
    stale: state.stale,
    fullyLoaded,
    refresh,
    prependRow,
    insertRow,
    patchRow,
    removeRow,
    dismissStale,
    markStale,
    getById,
  }
}
