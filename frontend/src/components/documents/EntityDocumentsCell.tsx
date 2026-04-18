import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from 'primereact/badge'
import type { DocumentEntityType } from './types'

type Props = {
  entityType: DocumentEntityType
  entityId: string
  count: number
  onOpenDialog: (entityType: DocumentEntityType, entityId: string) => void
}

/**
 * Per-row cell for the "Assignments" column on document-enabled apps.
 * Visual: folder-open icon + numeric badge when count > 0; dimmed when 0.
 * Click opens the single-entity documents dialog for this row without
 * propagating the click up to the row selector.
 */
export function EntityDocumentsCell({
  entityType,
  entityId,
  count,
  onOpenDialog,
}: Props) {
  const { t } = useTranslation()
  const hasCount = count > 0
  const title = hasCount
    ? t('documents.cell_title_some', { count })
    : t('documents.cell_title_none')

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    onOpenDialog(entityType, entityId)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={t('documents.cell_aria', { count })}
      className={
        'border-none bg-transparent cursor-pointer border-round inline-flex align-items-center justify-content-center ' +
        'p-2 m-0 transition-colors transition-duration-150 focus:outline-none hover:text-primary'
      }
      style={{
        opacity: hasCount ? 1 : 0.2,
        color: hasCount ? 'var(--blue-500)' : undefined,
      }}
    >
      <span className="p-overlay-badge">
        <i className="pi pi-folder-open text-lg" aria-hidden />
        {hasCount ? (
          <Badge value={count} severity="info" />
        ) : null}
      </span>
    </button>
  )
}
