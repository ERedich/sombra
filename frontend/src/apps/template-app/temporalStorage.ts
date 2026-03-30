import type { TemplateEntity } from './types'

const STORAGE_KEY = 'cmms-template-app-entities'

function isValidRow(x: unknown): x is TemplateEntity {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.site_id === 'string' &&
    typeof o.key === 'string' &&
    typeof o.name === 'string' &&
    typeof o.created_at === 'string' &&
    typeof o.updated_at === 'string'
  )
}

function normalizeRow(o: TemplateEntity): TemplateEntity {
  return {
    id: o.id,
    site_id: o.site_id,
    key: o.key,
    name: o.name,
    created_at: o.created_at,
    updated_at: o.updated_at,
  }
}

export function loadTemplateEntities(): TemplateEntity[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidRow).map(normalizeRow)
  } catch {
    return []
  }
}

export function persistTemplateEntities(rows: TemplateEntity[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

/** Replace rows for one working site; keep rows for other sites unchanged. */
export function persistForWorkingSite(
  workingSiteId: string,
  rowsForSite: TemplateEntity[],
): void {
  const all = loadTemplateEntities()
  const other = all.filter((r) => r.site_id !== workingSiteId)
  persistTemplateEntities([...other, ...rowsForSite])
}

export function keyTakenByOther(
  rows: TemplateEntity[],
  key: string,
  exceptId?: string,
): boolean {
  const k = key.trim().toLowerCase()
  return rows.some(
    (r) => r.key.trim().toLowerCase() === k && r.id !== exceptId,
  )
}
