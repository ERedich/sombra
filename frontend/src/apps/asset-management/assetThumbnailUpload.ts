import type { Dispatch, SetStateAction } from 'react'

/** Matches `<input accept>` and server validation. */
export const THUMBNAIL_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif' as const

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export function isThumbnailImageFile(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type)
}

/** First image in the list that matches accepted types, or null. */
export function firstThumbnailImageFile(
  files: FileList | File[] | null | undefined
): File | null {
  if (!files || files.length === 0) return null
  const list = Array.isArray(files) ? files : Array.from(files)
  for (const f of list) {
    if (isThumbnailImageFile(f)) return f
  }
  return null
}

export function applyPendingThumbnailFile(
  file: File | null,
  setPendingThumbnailFile: (v: File | null) => void,
  setThumbnailClear: (v: boolean) => void,
  setThumbnailPreviewUrl: Dispatch<SetStateAction<string | null>>
): void {
  setPendingThumbnailFile(file ?? null)
  setThumbnailClear(false)
  setThumbnailPreviewUrl((prev) => {
    if (prev) URL.revokeObjectURL(prev)
    return file ? URL.createObjectURL(file) : null
  })
}
