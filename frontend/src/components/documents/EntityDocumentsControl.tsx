import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { DataTable } from 'primereact/datatable'
import { Toast } from 'primereact/toast'
import { cmmsPaths } from '@sombra/shared'
import { ApiError, apiFetch, apiJson } from '../../api'
import { AppCrudDialog } from '../app-crud-dialog'
import { formatDateTime } from '../../utils/dateTime'
import {
  deleteDocument as deleteDocumentRequest,
  formatDocumentSize,
  viewDocumentInNewTab,
} from './documentActions'
import type {
  DocumentEntityType,
  DocumentSummary,
  DocumentsListResponse,
  DocumentUploadResponse,
} from './types'

type Props = {
  entityType: DocumentEntityType
  entityId: string | null | undefined
  /** Optional shared toast ref for success/error messages. When omitted a local Toast is rendered. */
  toastRef?: RefObject<Toast | null>
  /** Disable the button regardless of selection (e.g. parent-level busy state). */
  disabled?: boolean
  className?: string
  /**
   * Controlled open state. When provided, the internal open state is ignored
   * and the component mirrors the parent. Must be used together with
   * `onOpenChange`.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * When false, the trigger button is not rendered. Useful when the parent
   * drives the dialog from a row cell or external action.
   */
  showTrigger?: boolean
  /**
   * Notified after an upload or delete changes the persisted set for this
   * entity. Parents can use this to refresh per-row count badges.
   */
  onChanged?: (entityId: string) => void
}

export function EntityDocumentsControl({
  entityType,
  entityId,
  toastRef,
  disabled = false,
  className,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  onChanged,
}: Props) {
  const { t } = useTranslation()
  const localToastRef = useRef<Toast>(null)
  const resolvedToastRef = toastRef ?? localToastRef
  const [openInternal, setOpenInternal] = useState(false)
  const open = openProp ?? openInternal
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenInternal(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )
  const [count, setCount] = useState(0)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showError = useCallback(
    (detail: string) => {
      resolvedToastRef.current?.show({
        severity: 'error',
        summary: t('common.toast_error'),
        detail,
        life: 5000,
      })
    },
    [resolvedToastRef, t],
  )

  const showSuccess = useCallback(
    (detail: string) => {
      resolvedToastRef.current?.show({
        severity: 'success',
        summary: t('common.toast_success'),
        detail,
        life: 3000,
      })
    },
    [resolvedToastRef, t],
  )

  const refreshBadge = useCallback(
    async (id: string | null | undefined) => {
      if (!id) {
        setCount(0)
        return
      }
      try {
        const data = await apiJson<DocumentsListResponse>(
          `${cmmsPaths.documents}?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(id)}`,
        )
        setCount(data.count ?? data.documents?.length ?? 0)
      } catch {
        setCount(0)
      }
    },
    [entityType],
  )

  useEffect(() => {
    void refreshBadge(entityId ?? null)
  }, [entityId, refreshBadge])

  const loadDocuments = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const data = await apiJson<DocumentsListResponse>(
        `${cmmsPaths.documents}?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
      )
      const list = data.documents ?? []
      setDocuments(list)
      setCount(data.count ?? list.length)
    } catch (e) {
      if (e instanceof ApiError) showError(e.message)
      else showError(t('documents.load_fail'))
    } finally {
      setLoading(false)
    }
  }, [entityId, entityType, showError, t])

  useEffect(() => {
    if (open && entityId) {
      void loadDocuments()
    }
  }, [open, entityId, loadDocuments])

  const openDialog = useCallback(() => {
    if (!entityId) return
    setOpen(true)
  }, [entityId, setOpen])

  const uploadFile = useCallback(
    async (file: File) => {
      if (!entityId) return
      setUploading(true)
      try {
        const form = new FormData()
        form.append('entity_type', entityType)
        form.append('entity_id', entityId)
        form.append('file', file)
        const res = await apiFetch(cmmsPaths.documents, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new ApiError(body.error ?? res.statusText, res.status, body)
        }
        const data = (await res.json()) as DocumentUploadResponse
        setDocuments((prev) => [data.document, ...prev])
        setCount((prev) => prev + 1)
        showSuccess(t('documents.upload_success'))
        onChanged?.(entityId)
      } catch (e) {
        if (e instanceof ApiError) showError(e.message)
        else showError(t('documents.upload_fail'))
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [entityId, entityType, onChanged, showError, showSuccess, t],
  )

  const onFileSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) void uploadFile(file)
    },
    [uploadFile],
  )

  const viewDocument = useCallback(
    async (doc: DocumentSummary) => {
      setViewingId(doc.id)
      try {
        await viewDocumentInNewTab(doc)
      } catch (e) {
        if (e instanceof ApiError) showError(e.message)
        else showError(t('documents.view_fail'))
      } finally {
        setViewingId(null)
      }
    },
    [showError, t],
  )

  const deleteDocument = useCallback(
    (doc: DocumentSummary) => {
      confirmDialog({
        header: t('documents.delete_confirm_header'),
        message: t('documents.delete_confirm', {
          filename: doc.original_filename,
        }),
        icon: 'pi pi-exclamation-triangle',
        acceptClassName: 'p-button-danger',
        accept: async () => {
          setDeletingId(doc.id)
          try {
            await deleteDocumentRequest(doc)
            setDocuments((prev) => prev.filter((row) => row.id !== doc.id))
            setCount((prev) => Math.max(0, prev - 1))
            showSuccess(t('documents.delete_success'))
            if (entityId) onChanged?.(entityId)
          } catch (e) {
            if (e instanceof ApiError) showError(e.message)
            else showError(t('documents.delete_fail'))
          } finally {
            setDeletingId(null)
          }
        },
      })
    },
    [entityId, onChanged, showError, showSuccess, t],
  )

  const buttonDisabled = disabled || !entityId
  const hasCount = count > 0
  const buttonTitle = useMemo(() => {
    if (!entityId) return t('documents.button_disabled_hint')
    return t('documents.button_title', { count })
  }, [count, entityId, t])

  return (
    <>
      {toastRef ? null : <Toast ref={localToastRef} position="top-right" />}
      <ConfirmDialog dismissableMask />
      {showTrigger ? (
        <Button
          type="button"
          icon="pi pi-folder-open"
          rounded
          outlined
          size="small"
          severity="info"
          badge={hasCount ? String(count) : undefined}
          badgeClassName="p-badge-info"
          onClick={openDialog}
          disabled={buttonDisabled}
          aria-label={t('documents.button_aria')}
          title={buttonTitle}
          className={className}
        />
      ) : null}

      <AppCrudDialog
        title={t('documents.dialog_title')}
        visible={open}
        onHide={() => setOpen(false)}
        dismissableMask={!uploading && deletingId === null}
        style={{ width: 'min(60rem, 96vw)' }}
        minimizable={false}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.close')}
              severity="secondary"
              outlined
              onClick={() => setOpen(false)}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3">
          <div className="flex flex-wrap align-items-center justify-content-between gap-2">
            <p className="text-sm text-color-secondary m-0">
              {t('documents.dialog_subtitle')}
            </p>
            <div className="flex align-items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={onFileSelected}
                style={{ display: 'none' }}
              />
              <Button
                type="button"
                label={t('documents.upload')}
                icon="pi pi-upload"
                loading={uploading}
                disabled={uploading || !entityId}
                onClick={() => fileInputRef.current?.click()}
              />
            </div>
          </div>

          <DataTable
            value={documents}
            dataKey="id"
            loading={loading}
            size="small"
            stripedRows
            emptyMessage={t('documents.empty')}
            tableStyle={{ minWidth: '36rem' }}
          >
            <Column
              field="original_filename"
              header={t('documents.col_filename')}
              body={(row: DocumentSummary) => (
                <span title={row.mime_type}>{row.original_filename}</span>
              )}
            />
            <Column
              field="size_bytes"
              header={t('documents.col_size')}
              body={(row: DocumentSummary) => formatDocumentSize(row.size_bytes)}
              style={{ width: '7rem' }}
            />
            <Column
              field="created_at"
              header={t('documents.col_created_at')}
              body={(row: DocumentSummary) => formatDateTime(row.created_at)}
              style={{ width: '12rem' }}
            />
            <Column
              field="created_by_login_name"
              header={t('documents.col_created_by')}
              body={(row: DocumentSummary) =>
                row.created_by_login_name ?? ''
              }
              style={{ width: '10rem' }}
            />
            <Column
              header=""
              body={(row: DocumentSummary) => (
                <div className="flex justify-content-end gap-1">
                  <Button
                    type="button"
                    icon="pi pi-external-link"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    loading={viewingId === row.id}
                    onClick={() => void viewDocument(row)}
                    aria-label={t('documents.view_aria')}
                    title={t('documents.view')}
                  />
                  <Button
                    type="button"
                    icon="pi pi-trash"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    loading={deletingId === row.id}
                    onClick={() => deleteDocument(row)}
                    aria-label={t('documents.delete_aria')}
                    title={t('documents.delete')}
                  />
                </div>
              )}
              style={{ width: '7rem' }}
            />
          </DataTable>
        </div>
      </AppCrudDialog>
    </>
  )
}
