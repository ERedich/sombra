import type { ColumnRegistryEntry } from './types'
import type { TableSettingsV1 } from './types'

export function buildDefaultSettings<T>(
  defs: ColumnRegistryEntry<T>[],
): TableSettingsV1 {
  const columnOrder = defs.map((d) => d.field)
  const columnVisibility: Record<string, boolean> = {}
  for (const d of defs) {
    if (d.isSiteReference) {
      columnVisibility[d.field] = false
    } else {
      columnVisibility[d.field] = d.defaultVisible !== false
    }
  }
  return {
    version: 1,
    columnOrder,
    columnVisibility,
    columnWidths: {},
    frozenLeftCount: 0,
    multiSortMeta: [],
    groupByField: null,
    dateGroupGranularity: 'none',
  }
}

function isSortMeta(
  x: unknown,
): x is { field: string; order: 1 | -1 } {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.field === 'string' &&
    (o.order === 1 || o.order === -1)
  )
}

export function parseSettingsJson(
  raw: unknown,
  fallback: TableSettingsV1,
): TableSettingsV1 {
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as Record<string, unknown>
  if (o.version !== 1) return fallback

  const columnOrder = Array.isArray(o.columnOrder)
    ? o.columnOrder.filter((x): x is string => typeof x === 'string')
    : fallback.columnOrder
  const columnVisibility =
    o.columnVisibility && typeof o.columnVisibility === 'object' &&
    !Array.isArray(o.columnVisibility)
      ? { ...(o.columnVisibility as Record<string, boolean>) }
      : { ...fallback.columnVisibility }
  const columnWidths =
    o.columnWidths && typeof o.columnWidths === 'object' &&
    !Array.isArray(o.columnWidths)
      ? { ...(o.columnWidths as Record<string, number>) }
      : { ...fallback.columnWidths }

  let multiSortMeta: { field: string; order: 1 | -1 }[] = fallback.multiSortMeta
  if (Array.isArray(o.multiSortMeta)) {
    const parsed = o.multiSortMeta.filter(isSortMeta)
    multiSortMeta = parsed
  }

  const groupByField =
    o.groupByField === null || o.groupByField === undefined
      ? null
      : typeof o.groupByField === 'string'
        ? o.groupByField
        : fallback.groupByField ?? null

  const g = o.dateGroupGranularity
  const dateGroupGranularity =
    g === 'none' || g === 'year' || g === 'month' || g === 'iso_week'
      ? g
      : fallback.dateGroupGranularity ?? 'none'

  let frozenLeftCount = fallback.frozenLeftCount ?? 0
  const flc = o.frozenLeftCount
  if (typeof flc === 'number' && Number.isFinite(flc) && flc >= 0) {
    frozenLeftCount = Math.floor(flc)
  }

  const merged: TableSettingsV1 = {
    version: 1,
    columnOrder: columnOrder.length > 0 ? columnOrder : fallback.columnOrder,
    columnVisibility: { ...fallback.columnVisibility, ...columnVisibility },
    columnWidths,
    frozenLeftCount,
    multiSortMeta,
    groupByField,
    dateGroupGranularity,
  }

  /** Ensure every registry field appears in order and visibility */
  for (const f of fallback.columnOrder) {
    if (!merged.columnOrder.includes(f)) {
      merged.columnOrder.push(f)
    }
    if (merged.columnVisibility[f] === undefined) {
      merged.columnVisibility[f] = fallback.columnVisibility[f] ?? true
    }
  }
  merged.columnOrder = merged.columnOrder.filter((f) =>
    fallback.columnOrder.includes(f),
  )
  const extra = fallback.columnOrder.filter(
    (f) => !merged.columnOrder.includes(f),
  )
  merged.columnOrder = [...merged.columnOrder, ...extra]

  const visibleCount = merged.columnOrder.filter(
    (f) => merged.columnVisibility[f] !== false,
  ).length
  merged.frozenLeftCount = Math.min(
    merged.frozenLeftCount ?? 0,
    visibleCount,
  )

  return merged
}

export function reorderVisibleColumnOrder(
  columnOrder: string[],
  columnVisibility: Record<string, boolean>,
  dragIndex: number,
  dropIndex: number,
): string[] {
  const isVisible = (f: string) => columnVisibility[f] !== false
  const visList = columnOrder.filter(isVisible)
  if (
    dragIndex < 0 ||
    dragIndex >= visList.length ||
    dropIndex < 0 ||
    dropIndex >= visList.length
  ) {
    return columnOrder
  }
  const next = [...visList]
  const [moved] = next.splice(dragIndex, 1)
  next.splice(dropIndex, 0, moved)
  let i = 0
  return columnOrder.map((f) => (isVisible(f) ? next[i++]! : f))
}
