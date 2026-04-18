import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'

/**
 * Resolve the configured Application-side root directory to an absolute path.
 * Relative paths are resolved against the API process cwd (backend working directory).
 */
export function resolveDocumentsRoot(configuredPath: string): string {
  const trimmed = configuredPath.trim()
  if (!trimmed) {
    throw new Error('Application-side document path is not configured.')
  }
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
}

/**
 * Build a per-entity relative path that is safe for the filesystem and preserves
 * the original extension so the browser can infer a default handler.
 */
export function buildDocumentRelpath(
  entityType: string,
  entityId: string,
  originalFilename: string,
): string {
  const ext = extname(originalFilename).toLowerCase().slice(0, 16)
  const safeExt = /^\.[a-z0-9.]{1,16}$/.test(ext) ? ext : ''
  return `${entityType}/${entityId}/${randomUUID()}${safeExt}`
}

/** Absolute filesystem path for a document under the configured root. */
export function absoluteDocumentPath(
  configuredPath: string,
  storageRelpath: string,
): string {
  const root = resolveDocumentsRoot(configuredPath)
  const full = resolve(root, storageRelpath)
  const normalizedRoot = resolve(root)
  if (!full.startsWith(normalizedRoot)) {
    throw new Error('Document path resolves outside the configured directory.')
  }
  return full
}

/** Write a file atomically (temp + rename) under the configured directory. */
export async function writeDocumentFile(
  configuredPath: string,
  storageRelpath: string,
  data: Buffer,
): Promise<void> {
  const full = absoluteDocumentPath(configuredPath, storageRelpath)
  const dir = join(full, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(full, data)
}

/** Best-effort delete; swallow ENOENT so DELETE stays idempotent. */
export async function removeDocumentFile(
  configuredPath: string,
  storageRelpath: string,
): Promise<void> {
  try {
    const full = absoluteDocumentPath(configuredPath, storageRelpath)
    await rm(full, { force: true })
  } catch {
    // ignored: filesystem cleanup is best-effort
  }
}
