import type { Pool } from 'pg'

/** Same pattern as routes/sites.ts — UUID v4/v5 string form. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AuditRowForEnrich = {
  resource_type: string
  resource_id: string | null
  before_state: unknown
  after_state: unknown
  field_changes: unknown
}

export type EnrichCtx = {
  labelMap: Map<string, string>
}

/** Recursively collect UUID strings from audit JSON payloads. */
export function collectUuids(value: unknown, into: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUuids(item, into)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectUuids(v, into)
    }
  }
}

/** Resolve display labels for UUIDs (users.login_name, others.key). */
export async function resolveLabels(
  pool: Pool,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()

  const r = await pool.query<{ id: string; label: string }>(
    `SELECT id::text, label FROM (
       SELECT u.id, u.login_name AS label FROM users u WHERE u.id = ANY($1::uuid[])
       UNION ALL
       SELECT s.id, s.key AS label FROM sites s WHERE s.id = ANY($1::uuid[])
       UNION ALL
       SELECT c.id, c.key AS label FROM costcenters c WHERE c.id = ANY($1::uuid[])
       UNION ALL
       SELECT g.id, g.key AS label FROM user_groups g WHERE g.id = ANY($1::uuid[])
       UNION ALL
       SELECT a.id, a.key AS label FROM assets a WHERE a.id = ANY($1::uuid[])
       UNION ALL
       SELECT w.id, w.wo_key::text AS label FROM work_orders w WHERE w.id = ANY($1::uuid[])
       UNION ALL
       SELECT p.id, p.plan_key AS label FROM work_plans p WHERE p.id = ANY($1::uuid[])
     ) AS resolved`,
    [unique],
  )
  const m = new Map<string, string>()
  for (const row of r.rows) {
    m.set(row.id, row.label)
  }
  return m
}

function formatWithLabel(uuid: string, label: string | undefined): string {
  if (!label) return uuid
  return `${uuid} [${label}]`
}

function enrichString(
  s: string,
  key: string | null,
  ctx: EnrichCtx,
): string {
  if (!UUID_RE.test(s)) return s
  const label = ctx.labelMap.get(s)
  return formatWithLabel(s, label)
}

function enrichFieldChanges(
  fc: Record<string, unknown>,
  ctx: EnrichCtx,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [fieldName, delta] of Object.entries(fc)) {
    if (
      delta &&
      typeof delta === 'object' &&
      !Array.isArray(delta) &&
      'before' in delta &&
      'after' in delta
    ) {
      const d = delta as { before: unknown; after: unknown }
      out[fieldName] = {
        before: enrich(d.before, fieldName, ctx),
        after: enrich(d.after, fieldName, ctx),
      }
    } else {
      out[fieldName] = enrich(delta, fieldName, ctx)
    }
  }
  return out
}

function enrich(
  value: unknown,
  key: string | null,
  ctx: EnrichCtx,
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return enrichString(value, key, ctx)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((item) => enrich(item, key, ctx))
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      out[k] = enrich(v, k, ctx)
    }
    return out
  }
  return value
}

/** Apply human-readable `[label]` suffixes to UUID strings in audit JSON. */
export function enrichAuditJson(
  row: AuditRowForEnrich,
  labelMap: Map<string, string>,
): {
  before_state: unknown
  after_state: unknown
  field_changes: unknown
  resource_id_label: string | null
} {
  const ctx: EnrichCtx = { labelMap }

  const before_state =
    row.before_state !== null && row.before_state !== undefined
      ? enrich(row.before_state, null, ctx)
      : row.before_state
  const after_state =
    row.after_state !== null && row.after_state !== undefined
      ? enrich(row.after_state, null, ctx)
      : row.after_state
  const field_changes =
    row.field_changes !== null &&
    row.field_changes !== undefined &&
    typeof row.field_changes === 'object' &&
    !Array.isArray(row.field_changes)
      ? enrichFieldChanges(row.field_changes as Record<string, unknown>, ctx)
      : row.field_changes

  const rid = row.resource_id?.trim() ?? null
  const resource_id_label = rid ? labelMap.get(rid) ?? null : null

  return {
    before_state,
    after_state,
    field_changes,
    resource_id_label,
  }
}
