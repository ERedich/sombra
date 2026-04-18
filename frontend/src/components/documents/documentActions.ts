import { cmmsPaths } from '@sombra/shared'
import { ApiError, apiBlob, apiFetch } from '../../api'
import type { DocumentSummary } from './types'

/**
 * Fetch a document as a Blob and open it in a new tab. Falls back to a
 * synthetic anchor click when popups are blocked. Object URL is revoked
 * after 60s so the opened tab has time to consume it.
 */
export async function viewDocumentInNewTab(doc: DocumentSummary): Promise<void> {
  const blob = await apiBlob(cmmsPaths.documentFile(doc.id))
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  if (!win) {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.download = doc.original_filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** DELETE /api/documents/:id; throws ApiError on non-2xx. */
export async function deleteDocument(doc: DocumentSummary): Promise<void> {
  const res = await apiFetch(cmmsPaths.document(doc.id), { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? res.statusText, res.status, body)
  }
}

export function formatDocumentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}
