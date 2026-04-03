import { ProgressSpinner } from 'primereact/progressspinner'

type BulkOperationOverlayProps = {
  visible: boolean
  /** `fixed` = viewport cover; `absolute` = parent must be `position: relative` */
  position?: 'fixed' | 'absolute'
  className?: string
}

/**
 * Dimmed overlay with spinner while a large-table bulk operation runs.
 * Use with `shouldShowBulkTableFeedback` + an info toast at operation start.
 */
export function BulkOperationOverlay({
  visible,
  position = 'fixed',
  className = '',
}: BulkOperationOverlayProps) {
  if (!visible) return null
  const pos =
    position === 'fixed' ? 'fixed top-0 left-0 w-full h-full' : 'absolute top-0 left-0 w-full h-full'
  return (
    <div
      className={`${pos} flex align-items-center justify-content-center border-round-md bulk-operation-overlay ${className}`}
      style={{
        zIndex: 1090,
        background: 'color-mix(in srgb, var(--surface-ground) 65%, transparent)',
        backdropFilter: 'blur(1px)',
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <ProgressSpinner style={{ width: '3rem', height: '3rem' }} />
    </div>
  )
}
