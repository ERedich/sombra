/**
 * Shared client helpers for the server-side paginated work orders list.
 *
 * The backend contract is defined in
 * [backend/src/routes/work-orders.ts](../../../../backend/src/routes/work-orders.ts).
 * `buildWorkOrderQuery` serialises the active UI filters/sort into URL params
 * the server understands. `workOrderMatchesQuery` evaluates the same predicate
 * locally — used by the monitoring WebSocket merge logic to decide whether a
 * just-arrived `work_order_created` / `work_order_updated` event belongs in
 * the currently visible (sorted, filtered, searched) result set without a
 * full server round-trip.
 *
 * Keeping both functions side by side in one module is intentional: any
 * divergence between "what the server returns" and "what the client accepts
 * into the monitoring cache" produces subtle ghost rows; any change to the
 * filter/search semantics on the server must be mirrored here and vice versa.
 */
import type { TableSearchSettingsV1 } from '../../table-search'
import type { WorkOrder } from './workOrderTypes'

export type WorkOrderSortField =
  | 'wo_key'
  | 'plan_start'
  | 'plan_end'
  | 'status'
  | 'created_at'
  | 'updated_at'
  | 'planned_duration'
  | 'work_plan_key'
  | 'work_type_key'
  | 'workgroup_key'
  | 'category_key'
  | 'site_key'
  | 'costcenter_key'
  | 'started_by_employee_key'
  | 'continued_by_employee_key'
  | 'created_by_login_name'
  | 'updated_by_login_name'

export type WorkOrderListSort = {
  field: WorkOrderSortField
  order: 'asc' | 'desc'
}

export const DEFAULT_WORK_ORDER_LIST_SORT: WorkOrderListSort = {
  field: 'wo_key',
  order: 'desc',
}

/** Columns that map onto backend filter params as array-valued multiselects. */
const MULTISELECT_FIELDS = new Set<string>([
  'status',
  'workgroup_key',
  'work_type_key',
  'category_key',
  'assigned_employee_ids',
  'created_by_login_name',
  'updated_by_login_name',
])

/** Columns that map onto backend filter params as a date(time) range. */
const DATE_RANGE_FIELDS = new Set<string>([
  'plan_start',
  'plan_end',
  'created_at',
  'updated_at',
])

export type BuildQueryOptions = {
  sort: WorkOrderListSort
  search: string
  applied: TableSearchSettingsV1
  limit: number
  offset: number
}

export function buildWorkOrderQuery(opts: BuildQueryOptions): URLSearchParams {
  const p = new URLSearchParams()
  p.set('limit', String(opts.limit))
  p.set('offset', String(opts.offset))
  p.set('sort', opts.sort.field)
  p.set('order', opts.sort.order)

  const search = opts.search.trim()
  if (search !== '') p.set('search', search)

  for (const [field, criterion] of Object.entries(opts.applied.criteria)) {
    if (MULTISELECT_FIELDS.has(field)) {
      const values = criterion.selectedValues ?? []
      for (const v of values) {
        if (typeof v === 'string' && v.trim() !== '') p.append(field, v)
      }
      continue
    }
    if (DATE_RANGE_FIELDS.has(field)) {
      const from = criterion.from.trim()
      const to = criterion.to.trim()
      if (from !== '') p.set(`${field}_from`, from)
      if (to !== '') p.set(`${field}_to`, to)
      continue
    }
    // Plain text / number ranges are evaluated client-side against the global
    // `search` input when present. Send them too so the server can match.
    const from = criterion.from.trim()
    if (from !== '') {
      // Best-effort: server does not filter by arbitrary text columns today,
      // so fold them into the global `search` if no global search was set.
      if (!p.has('search')) p.set('search', from)
    }
  }

  return p
}

/** Shape of a URL query object as seen by `matchesQuery` after URLSearchParams round-trip. */
export type ResolvedQuery = {
  sort: WorkOrderListSort
  search: string
  multiselects: Partial<Record<string, string[]>>
  dateRanges: Partial<Record<string, { from: string | null; to: string | null }>>
}

export function resolveQuery(opts: BuildQueryOptions): ResolvedQuery {
  const multiselects: Partial<Record<string, string[]>> = {}
  const dateRanges: Partial<
    Record<string, { from: string | null; to: string | null }>
  > = {}
  for (const [field, criterion] of Object.entries(opts.applied.criteria)) {
    if (MULTISELECT_FIELDS.has(field)) {
      const values = (criterion.selectedValues ?? []).filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      )
      if (values.length > 0) multiselects[field] = values
    } else if (DATE_RANGE_FIELDS.has(field)) {
      const from = criterion.from.trim() || null
      const to = criterion.to.trim() || null
      if (from || to) dateRanges[field] = { from, to }
    }
  }
  return {
    sort: opts.sort,
    search: opts.search.trim(),
    multiselects,
    dateRanges,
  }
}

function toDateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * True when `wo` matches the filters, search and (implicit) site scope of the
 * resolved query. Must stay aligned with
 * `buildWorkOrderListFilters` in the backend. Site scope itself is not checked
 * here — the server already restricts the WebSocket feed to the user's
 * accessible sites, so any WO that reached the client is in scope.
 */
export function workOrderMatchesQuery(
  wo: WorkOrder,
  q: ResolvedQuery,
): boolean {
  const search = q.search
  if (search !== '') {
    const needle = search.toLowerCase()
    const haystack = [
      String(wo.wo_key),
      wo.short_text ?? '',
      wo.asset_key ?? '',
      wo.asset_name ?? '',
    ]
      .join('\u0001')
      .toLowerCase()
    if (!haystack.includes(needle)) return false
  }

  for (const [field, values] of Object.entries(q.multiselects)) {
    if (!values || values.length === 0) continue
    if (field === 'assigned_employee_ids') {
      const assigned = wo.assigned_employee_ids ?? []
      if (assigned.length === 0) return false
      if (!assigned.some((id) => values.includes(id))) return false
      continue
    }
    const raw = (wo as unknown as Record<string, unknown>)[field]
    const cell =
      typeof raw === 'string'
        ? raw
        : raw == null
          ? ''
          : typeof raw === 'number' || typeof raw === 'boolean'
            ? String(raw)
            : ''
    if (!values.includes(cell)) return false
  }

  for (const [field, range] of Object.entries(q.dateRanges)) {
    if (!range) continue
    const raw = (wo as unknown as Record<string, unknown>)[field]
    const valueMs = toDateMs(typeof raw === 'string' ? raw : null)
    if (valueMs == null) return false
    const fromMs = toDateMs(range.from)
    const toMs = toDateMs(range.to)
    if (fromMs != null && valueMs < fromMs) return false
    if (toMs != null && valueMs > toMs) return false
  }

  return true
}

/**
 * Compare two work orders along the current sort axis. Returns a number
 * suitable for `Array.prototype.sort`. Used when a WebSocket event inserts a
 * new row into the sparse cache — we need the index where it belongs under
 * the active sort.
 */
export function compareForSort(
  a: WorkOrder,
  b: WorkOrder,
  sort: WorkOrderListSort,
): number {
  const { field, order } = sort
  const mult = order === 'asc' ? 1 : -1
  if (field === 'wo_key') {
    return (a.wo_key - b.wo_key) * mult
  }
  if (
    field === 'plan_start' ||
    field === 'plan_end' ||
    field === 'created_at' ||
    field === 'updated_at'
  ) {
    const av = toDateMs((a as unknown as Record<string, string | null>)[field])
    const bv = toDateMs((b as unknown as Record<string, string | null>)[field])
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * mult
  }
  const ar = (a as unknown as Record<string, unknown>)[field]
  const br = (b as unknown as Record<string, unknown>)[field]
  const as = typeof ar === 'string' ? ar : ar == null ? '' : String(ar)
  const bs = typeof br === 'string' ? br : br == null ? '' : String(br)
  return as.localeCompare(bs) * mult
}
