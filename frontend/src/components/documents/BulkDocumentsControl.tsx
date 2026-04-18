import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { DataTable } from 'primereact/datatable'
import { Toast } from 'primereact/toast'
import { cmmsPaths } from '@sombra/shared'
import { ApiError, apiJson } from '../../api'
import { AppCrudDialog } from '../app-crud-dialog'
import { formatDateTime } from '../../utils/dateTime'
import {
  deleteDocument as deleteDocumentRequest,
  formatDocumentSize,
  viewDocumentInNewTab,
} from './documentActions'
import type {
  DocumentCountsResponse,
  DocumentEntityType,
  DocumentSummary,
  DocumentsListResponse,
} from './types'

type Props = {
  entityType: DocumentEntityType
  /** Entity IDs of the rows currently visible/filtered in the parent table. */
  entityIds: string[]
  toastRef?: RefObject<Toast | null>
  disabled?: boolean
  className?: string
  /**
   * Optional label resolver used in the bulk dialog's "Entity" column. When
   * omitted, the column falls back to a short form of the entity UUID.
   */
  resolveEntityLabel?: (entityId: string) => string
  /** Called after a successful delete so the parent can refresh counts. */
  onChanged?: (entityId: string) => void
}

/**
 * Toolbar button that opens a read-and-delete dialog listing every document
 * attached to any of the provided `entityIds`. Upload is intentionally not
 * offered here because the target row is ambiguous — use the per-row cell.
 */
export function BulkDocumentsControl({
  entityType,
  entityIds,
  toastRef,
  disabled = false,
  className,
  resolveEntityLabel,
  onChanged,
}: Props) {
  const { t } = useTranslation()
  const localToastRef = useRef<Toast>(null)
  const resolvedToastRef = toastRef ?? localToastRef
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)

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

  const stableIds = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of entityIds) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }, [entityIds])
  const idsKey = stableIds.join(',')

  const refreshBadge = useCallback(async () => {
    if (stableIds.length === 0) {
      setCount(0)
      return
    }
    try {
      const data = await apiJson<DocumentCountsResponse>(
        `${cmmsPaths.documentsCounts}?entity_type=${encodeURIComponent(entityType)}&entity_ids=${encodeURIComponent(idsKey)}`,
      )
      let total = 0
      for (const n of Object.values(data.counts ?? {})) total += Number(n) || 0
      setCount(total)
    } catch {
      setCount(0)
    }
  }, [entityType, idsKey, stableIds.length])

  useEffect(() => {
    void refreshBadge()
  }, [refreshBadge])

  const loadDocuments = useCallback(async () => {
    if (stableIds.length === 0) {
      setDocuments([])
      setCount(0)
      return
    }
    setLoading(true)
    try {
      const data = await apiJson<DocumentsListResponse>(
        `${cmmsPaths.documents}?entity_type=${encodeURIComponent(entityType)}&entity_ids=${encodeURIComponent(idsKey)}`,
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
  }, [entityType, idsKey, showError, stableIds.length, t])

  useEffect(() => {
    if (open) void loadDocuments()
  }, [open, loadDocuments])

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
            onChanged?.(doc.entity_id)
          } catch (e) {
            if (e instanceof ApiError) showError(e.message)
            else showError(t('documents.delete_fail'))
          } finally {
            setDeletingId(null)
          }
        },
      })
    },
    [onChanged, showError, showSuccess, t],
  )

  const buttonDisabled = disabled || stableIds.length === 0
  const hasCount = count > 0
  const buttonTitle = useMemo(() => {
    if (stableIds.length === 0) return t('documents.bulk_button_disabled_hint')
    return t('documents.bulk_button_title', {
      count,
      rows: stableIds.length,
    })
  }, [count, stableIds.length, t])

  function entityLabel(id: string): string {
    if (resolveEntityLabel) {
      const v = resolveEntityLabel(id)
      if (v) return v
    }
    return id.slice(0, 8)
  }

  return (
    <>
      {toastRef ? null : <Toast ref={localToastRef} position="top-right" />}
      <ConfirmDialog dismissableMask />
      <Button
        type="button"
        icon="pi pi-folder-open"
        rounded
        outlined
        size="small"
        severity="info"
        badge={hasCount ? String(count) : undefined}
        badgeClassName="p-badge-info"
        onClick={() => setOpen(true)}
        disabled={buttonDisabled}
        aria-label={t('documents.bulk_button_aria')}
        title={buttonTitle}
        className={className}
      />

      <AppCrudDialog
        title={t('documents.bulk_dialog_title')}
        visible={open}
        onHide={() => setOpen(false)}
        dismissableMask={deletingId === null}
        style={{ width: 'min(70rem, 96vw)' }}
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
          <p className="text-sm text-color-secondary m-0">
            {t('documents.bulk_dialog_subtitle', {
              rows: stableIds.length,
            })}
          </p>

          <DataTable
            value={documents}
            dataKey="id"
            loading={loading}
            size="small"
            stripedRows
            emptyMessage={t('documents.empty')}
            tableStyle={{ minWidth: '48rem' }}
          >
            <Column
              field="entity_id"
              header={t('documents.col_entity')}
              body={(row: DocumentSummary) => (
                <span title={row.entity_id}>{entityLabel(row.entity_id)}</span>
              )}
              style={{ width: '10rem' }}
            />
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
