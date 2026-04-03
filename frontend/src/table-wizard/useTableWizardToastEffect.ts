import type { TFunction } from 'i18next'
import { useEffect, type RefObject } from 'react'
import type { Toast } from 'primereact/toast'

/**
 * Shows table layout API errors in the page Toast and clears the wizard error state.
 */
export function useTableWizardToastEffect(
  toastRef: RefObject<Toast | null>,
  toastError: string | null,
  clearToastError: () => void,
  t: TFunction,
) {
  useEffect(() => {
    if (!toastError) return
    toastRef.current?.show({
      severity: 'error',
      summary: t('common.toast_error'),
      detail: toastError,
      life: 5000,
    })
    clearToastError()
  }, [toastError, clearToastError, t])
}
