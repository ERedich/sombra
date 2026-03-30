import type { ReactNode } from 'react'
import { useState } from 'react'
import { firstThumbnailImageFile } from './assetThumbnailUpload'

type AssetThumbnailDropAreaProps = {
  disabled?: boolean
  onImageFile: (file: File) => void
  children: ReactNode
  className?: string
}

/**
 * Enables drag-and-drop for thumbnail images; combine with a file input using the same `onImageFile` / change handler.
 */
export function AssetThumbnailDropArea({
  disabled,
  onImageFile,
  children,
  className = '',
}: AssetThumbnailDropAreaProps) {
  const [over, setOver] = useState(false)

  return (
    <div
      className={`border-round border-1 border-dashed p-3 transition-colors transition-duration-150 ${
        disabled
          ? 'border-300 surface-ground'
          : over
            ? 'border-primary surface-hover'
            : 'border-300 surface-ground'
      } ${className}`}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) setOver(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (
          !disabled &&
          !e.currentTarget.contains(e.relatedTarget as Node | null)
        ) {
          setOver(false)
        }
      }}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const f = firstThumbnailImageFile(e.dataTransfer.files)
        if (f) onImageFile(f)
      }}
    >
      {children}
    </div>
  )
}
