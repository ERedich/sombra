import type { Pool, PoolClient } from 'pg'

export type AuditOperation = 'create' | 'update' | 'delete'

export type AuditEntry = {
  actorUserId: string | null
  actorKey: string
  actorName: string
  operation: AuditOperation
  resourceType: string
  resourceId: string | null
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  fieldChanges: Record<string, { before: unknown; after: unknown }> | null
  httpMethod: string
  path: string
}

/** Normalize values for stable JSON (e.g. pg Date → ISO string). */
export function serializeRowForAudit(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = v.toISOString()
    } else {
      out[k] = v
    }
  }
  return out
}

export function redactForAudit(
  resourceType: string,
  row: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (row === null) return null
  const serialized = serializeRowForAudit(row)
  if (resourceType === 'user') {
    const { password_hash: _p, ...rest } = serialized
    return rest
  }
  if (resourceType === 'asset') {
    const { thumbnail_data: _t, thumbnail_mime_type: _m, ...rest } = serialized
    return rest
  }
  return serialized
}

/** Shallow diff: only keys present in both objects; values compared after JSON serialization. */
export function fieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of keys) {
    const b = before[key]
    const a = after[key]
    const same =
      JSON.stringify(b) === JSON.stringify(a) ||
      (b === undefined && a === undefined)
    if (!same) {
      changes[key] = { before: b ?? null, after: a ?? null }
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export async function writeAudit(
  client: PoolClient,
  entry: AuditEntry,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (
       actor_user_id, actor_key, actor_name, operation, resource_type, resource_id,
       before_state, after_state, field_changes, http_method, path
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entry.actorUserId,
      entry.actorKey,
      entry.actorName,
      entry.operation,
      entry.resourceType,
      entry.resourceId,
      entry.beforeState,
      entry.afterState,
      entry.fieldChanges,
      entry.httpMethod,
      entry.path,
    ],
  )
}

/** Single-statement append (e.g. login) outside a request transaction. */
export async function appendAuditLog(
  pool: Pool,
  entry: AuditEntry,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (
       actor_user_id, actor_key, actor_name, operation, resource_type, resource_id,
       before_state, after_state, field_changes, http_method, path
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entry.actorUserId,
      entry.actorKey,
      entry.actorName,
      entry.operation,
      entry.resourceType,
      entry.resourceId,
      entry.beforeState,
      entry.afterState,
      entry.fieldChanges,
      entry.httpMethod,
      entry.path,
    ],
  )
}
