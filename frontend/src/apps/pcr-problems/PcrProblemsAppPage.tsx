/**
 * PCR (Problem / Cause / Remedy) Problems master CRUD.
 * Mirrors CategoriesAppPage in layout and toolbar behaviour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Card } from 'primereact/card'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ContextMenu } from 'primereact/contextmenu'
import { DataTable } from 'primereact/datatable'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { useRegisterCreateShortcut } from '../../layout/AppCreateShortcut'
import {
  buildAskKiraMenuItem,
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../../layout/crudContextMenuItems'
import { useKiraAssistant } from '../../layout/KiraAssistantProvider'
import { formatKiraRowDraft } from '../../layout/kiraRowDraft'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../../table-wizard'
import { formatDateTime } from '../../utils/dateTime'
import type { PcrProblem } from './types'

type ListResponse = { problems: PcrProblem[] }
type ItemResponse = { problem: PcrProblem }

export default function PcrProblemsAppPage() {
  const { t } = useTranslation()
  const { openKira } = useKiraAssistant()
  const navigate = useNavigate()

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<PcrProblem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [selected, setSelected] = useState<PcrProblem | null>(null)
  const [search, setSearch] = useState('')
  const emDash = t('common.em_dash')

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<PcrProblem>[] => {
    return [
      { field: 'key', headerKey: 'common.col_key', sortable: true },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
      {
        field: 'description',
        headerKey: 'pcr.col_description',
        sortable: false,
        body: (row) => row.description ?? emDash,
      },
      {
        field: 'created_at',
        headerKey: 'common.col_created_at',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.created_at),
      },
      {
        field: 'created_by_login_name',
        headerKey: 'common.col_created_by',
        sortable: true,
        body: (row) => row.created_by_login_name ?? emDash,
      },
      {
        field: 'updated_at',
        headerKey: 'common.col_updated_at',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.updated_at),
      },
      {
        field: 'updated_by_login_name',
        headerKey: 'common.col_updated_by',
        sortable: true,
        body: (row) => row.updated_by_login_name ?? emDash,
      },
    ]
  }, [emDash])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, search])

  const tw = useTableWizard<PcrProblem>({
    appPath: '/pcr-problems',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((r) => r.id === cur.id) ? cur : null
    })
  }, [filteredRows])

  const showError = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'error',
        summary: t('common.toast_error'),
        detail,
        life: 5000,
      })
    },
    [t],
  )

  const showSuccess = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'success',
        summary: t('common.toast_success'),
        detail,
        life: 3000,
      })
    },
    [t],
  )

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<ListResponse>('/api/pcr-problems')
      setRows(data.problems ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('pcr.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setFormDescription('')
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: PcrProblem) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setFormDescription(row.description ?? '')
    setDialogOpen(true)
  }

  async function saveRow() {
    const key = formKey.trim()
    const name = formName.trim()
    const description = formDescription.trim()
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    setSaving(true)
    try {
      const body = { key, name, description: description || null }
      if (editingId) {
        const data = await apiJson<ItemResponse>(
          `/api/pcr-problems/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setRows((prev) =>
          prev.map((c) => (c.id === editingId ? data.problem : c)),
        )
        setSelected((cur) => (cur?.id === editingId ? data.problem : cur))
        showSuccess(t('pcr.updated'))
      } else {
        const data = await apiJson<ItemResponse>('/api/pcr-problems', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          [...prev, data.problem].sort((a, b) =>
            `${a.site_key} ${a.key}`.localeCompare(`${b.site_key} ${b.key}`),
          ),
        )
        showSuccess(t('pcr.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('pcr.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDeleteRow(row: PcrProblem) {
    confirmDialog({
      header: t('pcr.delete_header'),
      message: t('pcr.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteRow(row.id),
    })
  }

  async function deleteRow(id: string) {
    try {
      await apiJson<undefined>(`/api/pcr-problems/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((c) => c.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('pcr.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('pcr.delete_fail'))
      }
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceIdForMenu = selected?.id ?? ''

  const crudContextMenuItems = [
    buildAskKiraMenuItem(t, {
      openKira,
      disabled: !selected,
      getDraft: () =>
        selected
          ? formatKiraRowDraft(t('pcr.problems.title'), {
              id: selected.id,
              key: selected.key,
              name: selected.name,
            })
          : '',
    }),
    { separator: true },
    ...buildCrudContextMenuModel(
      {
        onCreate: openCreate,
        onEdit: () => {
          if (selected) openEdit(selected)
        },
        onDelete: () => {
          if (selected) confirmDeleteRow(selected)
        },
        disableEdit: !selected,
        disableDelete: !selected,
      },
      t,
      {
        audit: selected ? rowAuditSnapshot(selected) : undefined,
        auditHistory: {
          visible: isAdmin === true && !!auditResourceIdForMenu,
          onNavigate: () =>
            navigate(
              `/audit-log?resource_type=pcr_problem&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
            ),
        },
      },
    ),
  ]

  const cardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-exclamation-triangle text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('pcr.problems.title')}</h1>
          <p className="app-card-hero-desc">{t('pcr.problems.subtitle')}</p>
        </div>
      </div>
      <div className="flex align-items-center gap-2 flex-shrink-0 align-self-start">
        {tw.heroTableWizard}
      </div>
    </div>
  )

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <ContextMenu
        ref={crudContextMenuRef}
        model={crudContextMenuItems}
        {...CRUD_CONTEXT_MENU_PROPS}
      />
      <ConfirmDialog dismissableMask />
      {tw.wizardDialog}

      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={cardHeader}
        >
          <div className="px-1 md:px-2">
            <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-3 w-full">
              <ButtonGroup>
                <Button
                  type="button"
                  label={t('common.create')}
                  icon="pi pi-plus"
                  onClick={openCreate}
                />
                <Button
                  type="button"
                  label={t('common.edit')}
                  icon="pi pi-pencil"
                  disabled={!selected}
                  onClick={() => selected && openEdit(selected)}
                />
                <Button
                  type="button"
                  label={t('common.delete')}
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={!selected}
                  onClick={() => selected && confirmDeleteRow(selected)}
                />
              </ButtonGroup>
              <div className="flex align-items-center gap-2 flex-wrap ml-auto">
                <IconField
                  iconPosition="left"
                  className="app-crud-toolbar-search flex-shrink-0"
                  style={{ width: 'min(20rem, 100%)' }}
                >
                  <InputIcon className="pi pi-search" />
                  <InputText
                    ref={toolbarSearchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('common.search_ellipsis')}
                    className="w-full"
                  />
                </IconField>
              </div>
            </div>
            <p className="text-sm text-color-secondary mt-0 mb-3">
              {t('pcr.problems.subtitle')}
            </p>
            <DataTable
              value={tw.prepareRows(filteredRows)}
              loading={loading || tw.tableBusy}
              dataKey="id"
              selection={selected}
              onSelectionChange={(e) =>
                setSelected(e.value as PcrProblem | null)
              }
              contextMenuSelection={selected ?? undefined}
              onContextMenuSelectionChange={(e) =>
                setSelected(e.value as PcrProblem | null)
              }
              onContextMenu={(e) => {
                e.originalEvent.preventDefault()
                crudContextMenuRef.current?.show(e.originalEvent)
              }}
              selectionMode="single"
              metaKeySelection={false}
              onRowDoubleClick={(e) => {
                const row = e.data as PcrProblem
                setSelected(row)
                openEdit(row)
              }}
              emptyMessage={
                search.trim()
                  ? t('pcr.empty_search')
                  : t('pcr.empty')
              }
              stripedRows
              {...tw.tableLayoutProps}
            >
              {tw.renderColumns()}
            </DataTable>
          </div>
        </Card>
      </div>

      <AppCrudDialog
        title={
          editingId ? t('pcr.dialog_edit') : t('pcr.dialog_create')
        }
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        dismissableMask={!saving}
        style={{ width: 'min(32rem, 95vw)' }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveRow()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="prob-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="prob-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="prob-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="prob-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="prob-desc" className="text-sm font-medium">
              {t('pcr.col_description')}
            </label>
            <InputTextarea
              id="prob-desc"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={3}
              className="w-full"
              disabled={saving}
            />
          </div>
        </div>
      </AppCrudDialog>
    </AppShell>
  )
}
