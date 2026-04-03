import type { ColumnRegistryEntry } from './types'
import { TW_GROUP_FIELD } from './types'

/** ISO 8601 week label (year + week number). */
function isoWeekLabel(d: Date): string {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7))
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
  const isoYear = new Date(firstThursday).getFullYear()
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

export function computeGroupLabel(
  value: unknown,
  gran: 'none' | 'year' | 'month' | 'iso_week',
  colType: 'text' | 'date' | 'datetime' | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (gran === 'none' || !colType || colType === 'text') {
    return String(value)
  }
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  if (gran === 'year') return String(d.getFullYear())
  if (gran === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return isoWeekLabel(d)
}

export function prepareRowsWithGroup<T extends Record<string, unknown>>(
  rows: T[],
  groupByField: string | null | undefined,
  gran: 'none' | 'year' | 'month' | 'iso_week',
  defsByField: Record<string, ColumnRegistryEntry<T>>,
): (T & Record<string, unknown>)[] {
  if (!groupByField) return rows
  const col = defsByField[groupByField]
  const colType = col?.type
  return rows.map((r) => ({
    ...r,
    [TW_GROUP_FIELD]: computeGroupLabel(
      r[groupByField],
      gran,
      colType,
    ),
  }))
}

function compareVal(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** One representative row per contiguous group (sorted by group first). Used for Prime `expandedRows` when `expandableRowGroups` is set. */
export function seedExpandedRowGroups<T extends Record<string, unknown>>(
  rows: T[],
): T[] {
  if (rows.length === 0) return []
  const out: T[] = []
  let prevKey: string | null = null
  for (const r of rows) {
    const k = String(r[TW_GROUP_FIELD] ?? '')
    if (k !== prevKey) {
      out.push(r)
      prevKey = k
    }
  }
  return out
}

/** Stable string for “prepared rows / groups” changes (filters, sort, data load). */
export function preparedGroupedDataFingerprint(
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return '0:'
  const seed = seedExpandedRowGroups(rows)
  const keys = seed.map((r) => String(r[TW_GROUP_FIELD] ?? ''))
  return `${rows.length}:${keys.join('\0')}`
}

/** Same expanded groups (by __twGroup on representative rows), order-independent. */
export function sameExpandedGroupKeys<T extends Record<string, unknown>>(
  a: T[],
  b: T[],
): boolean {
  const sig = (rows: T[]) =>
    [...rows]
      .map((r) => String(r[TW_GROUP_FIELD] ?? ''))
      .sort()
      .join(',')
  return sig(a) === sig(b)
}

/** Keep user collapse/expand per group key; drop missing groups; add new groups as expanded. */
export function mergeExpandedRowGroups<T extends Record<string, unknown>>(
  prev: T[],
  seed: T[],
): T[] {
  const seedKeys = new Set(seed.map((r) => String(r[TW_GROUP_FIELD] ?? '')))
  const kept = prev.filter((r) =>
    seedKeys.has(String(r[TW_GROUP_FIELD] ?? '')),
  )
  const keptKeys = new Set(
    kept.map((r) => String(r[TW_GROUP_FIELD] ?? '')),
  )
  const out = [...kept]
  for (const row of seed) {
    const k = String(row[TW_GROUP_FIELD] ?? '')
    if (!keptKeys.has(k)) {
      out.push(row)
      keptKeys.add(k)
    }
  }
  return out
}

export function sortRowsForDataTable<T extends Record<string, unknown>>(
  rows: (T & Record<string, unknown>)[],
  groupByField: string | null | undefined,
  multiSortMeta: { field: string; order: 1 | -1 }[],
): (T & Record<string, unknown>)[] {
  const list = [...rows]
  list.sort((ra, rb) => {
    const a = ra as Record<string, unknown>
    const b = rb as Record<string, unknown>
    if (groupByField) {
      const ga = String(a[TW_GROUP_FIELD] ?? '')
      const gb = String(b[TW_GROUP_FIELD] ?? '')
      if (ga !== gb) return ga.localeCompare(gb)
    }
    for (const m of multiSortMeta) {
      const cmp = compareVal(a[m.field], b[m.field])
      if (cmp !== 0) return m.order === -1 ? -cmp : cmp
    }
    return 0
  })
  return list
}
