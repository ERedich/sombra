import { Button } from 'primereact/button'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function AppCrudDialogHeader({
  title,
  onMinimize,
  onClose,
  minimizeDisabled,
}: {
  title: ReactNode
  onMinimize: () => void
  onClose: () => void
  minimizeDisabled?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="flex align-items-center justify-content-between gap-2 w-full app-crud-dialog-header-inner">
      <div className="flex-1 min-w-0">{title}</div>
      <div className="flex align-items-center flex-shrink-0 gap-0">
        <Button
          type="button"
          icon="pi pi-window-minimize"
          text
          rounded
          severity="secondary"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMinimize()
          }}
          disabled={minimizeDisabled}
          aria-label={t('mw.minimize_aria')}
        />
        <Button
          type="button"
          icon="pi pi-times"
          text
          rounded
          severity="secondary"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }}
          aria-label={t('common.close')}
        />
      </div>
    </div>
  )
}
