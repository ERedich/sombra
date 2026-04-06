import type { SearchableColumnDef, TableSearchCriterionV1, TableSearchSettingsV1 } from './types'

export function buildDefaultSearchSettings(): TableSearchSettingsV1 {
  return {
    version: 1,
    criteria: {},
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseSearchSettingsJson(raw: unknown): TableSearchSettingsV1 {
  const fallback = buildDefaultSearchSettings()
  if (!isRecord(raw)) return fallback
  if (raw.version !== 1) return fallback
  const criteriaRaw = raw.criteria
  if (!isRecord(criteriaRaw)) return fallback

  const criteria: Record<string, TableSearchCriterionV1> = {}
  for (const [field, value] of Object.entries(criteriaRaw)) {
    if (!isRecord(value)) continue
    const from = typeof value.from === 'string' ? value.from : ''
    const to = typeof value.to === 'string' ? value.to : ''
    // Backward compatibility with early single-value shape.
    const legacyValue = typeof value.value === 'string' ? value.value : ''
    const normalizedFrom = from || legacyValue
    const normalizedTo = to
    const selectedValues = Array.isArray(value.selectedValues)
      ? value.selectedValues.filter((item): item is string => typeof item === 'string')
      : []
    if (
      normalizedFrom.trim() === '' &&
      normalizedTo.trim() === '' &&
      selectedValues.length === 0
    ) {
      continue
    }
    criteria[field] = {
      from: normalizedFrom,
      to: normalizedTo,
      selectedValues,
    }
  }

  return {
    version: 1,
    criteria,
  }
}

function toComparable(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase()
  }
  if (value instanceof Date) return value.toISOString().toLowerCase()
  if (Array.isArray(value)) {
    return value.map((item) => toComparable(item)).join(' ')
  }
  return String(value).trim().toLowerCase()
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const normalized = raw.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function parseDateLike(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

export function applyColumnSearch<T extends Record<string, unknown>>(
  rows: T[],
  settings: TableSearchSettingsV1,
  searchableColumns: SearchableColumnDef<T>[],
): T[] {
  const activeCriteria = Object.entries(settings.criteria).filter(
    ([, criterion]) =>
      criterion.from.trim() !== '' ||
      criterion.to.trim() !== '' ||
      (criterion.selectedValues?.length ?? 0) > 0,
  )
  if (activeCriteria.length === 0) return rows

  const colMap: Record<string, SearchableColumnDef<T>> = {}
  for (const col of searchableColumns) colMap[col.field] = col

  return rows.filter((row) => {
    return activeCriteria.every(([field, criterion]) => {
      const column = colMap[field]
      if (!column) return true
      const searchValue = column.getSearchValue
        ? column.getSearchValue(row)
        : row[field]
      const fromRaw = criterion.from.trim()
      const toRaw = criterion.to.trim()
      if (column.inputType === 'multiselect') {
        const selectedValues = (criterion.selectedValues ?? []).map((v) =>
          toComparable(v),
        )
        if (selectedValues.length === 0) return true
        if (Array.isArray(searchValue)) {
          if (searchValue.length === 0) return false
          const currentValues = searchValue.map((v) => toComparable(v))
          return currentValues.some((v) => selectedValues.includes(v))
        }
        const currentValue = toComparable(searchValue)
        return selectedValues.includes(currentValue)
      }

      if (column.inputType === 'number') {
        const valueNum = parseNumberLike(searchValue)
        if (valueNum == null) return false
        const fromNum = parseNumberLike(fromRaw)
        const toNum = parseNumberLike(toRaw)
        if (fromNum != null && toNum != null) {
          const low = Math.min(fromNum, toNum)
          const high = Math.max(fromNum, toNum)
          return valueNum >= low && valueNum <= high
        }
        if (fromNum != null && valueNum < fromNum) return false
        if (toNum != null && valueNum > toNum) return false
        return true
      }

      if (column.inputType === 'date' || column.inputType === 'datetime') {
        const valueDate = parseDateLike(searchValue)
        if (valueDate == null) return false
        const fromDate = parseDateLike(fromRaw)
        const toDate = parseDateLike(toRaw)
        if (fromDate != null && valueDate < fromDate) return false
        if (toDate != null && valueDate > toDate) return false
        return true
      }

      const haystack = toComparable(searchValue)
      const fromNeedle = toComparable(fromRaw)
      const toNeedle = toComparable(toRaw)
      if (fromNeedle && toNeedle) {
        return haystack.includes(fromNeedle) || haystack.includes(toNeedle)
      }
      if (fromNeedle) return haystack.includes(fromNeedle)
      if (toNeedle) return haystack.includes(toNeedle)
      return true
    })
  })
}
