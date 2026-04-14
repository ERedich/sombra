/**
 * CRUD for cost centers — template-app layout + Sites-style API wiring (key & name only).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { useRegisterCreateShortcut } from '../../layout/AppCreateShortcut'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../../layout/crudContextMenuItems'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../../table-wizard'
import { formatDateTime } from '../../utils/dateTime'

export type Costcenter = {
  id: string
  site_id: string
  site_key: string
  site_name: string
  site_colour: string
  key: string
  name: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type CostcentersListResponse = { costcenters: Costcenter[] }
type CostcenterResponse = { costcenter: Costcenter }

function siteColumnBody(row: Costcenter, dash: string) {
  const colour =
    typeof row.site_colour === 'string' && row.site_colour.trim() !== ''
      ? row.site_colour.trim()
      : '#94a3b8'
  return (
    <div className="flex align-items-center gap-2">
      <span
        className="border-round border-1 border-300 flex-shrink-0"
        style={{
          width: '1.25rem',
          height: '1.25rem',
          backgroundColor: colour,
        }}
        title={colour}
      />
      <span className="text-sm">
        {row.site_key} {dash} {row.site_name}
      </span>
    </div>
  )
}

export default function CostcentersAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const costcenterIdParam = searchParams.get('costcenterId')?.trim() ?? ''

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<Costcenter[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [selected, setSelected] = useState<Costcenter | null>(null)
  const [search, setSearch] = useState('')
  const emDash = t('common.em_dash')

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Costcenter>[] => {
    return [
      {
        field: 'site_key',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        type: 'text',
        body: (row) => siteColumnBody(row, emDash),
      },
      { field: 'key', headerKey: 'common.col_key', sortable: true },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
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

  const cardSubTitle = useMemo(() => {
    if (costcenterIdParam) {
      return t('costcenters.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('costcenters.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('costcenters.subtitle_no_sites')
    }
    return t('costcenters.subtitle_default')
  }, [costcenterIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (costcenterIdParam) {
      list = list.filter((c) => c.id === costcenterIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (c) =>
        c.site_key.toLowerCase().includes(q) ||
        c.site_name.toLowerCase().includes(q) ||
        (c.site_colour?.toLowerCase().includes(q) ?? false) ||
        c.key.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.created_at.toLowerCase().includes(q) ||
        c.updated_at.toLowerCase().includes(q) ||
        formatDateTime(c.created_at).toLowerCase().includes(q) ||
        formatDateTime(c.updated_at).toLowerCase().includes(q) ||
        (c.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (c.updated_by_login_name?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, search, costcenterIdParam])

  const tw = useTableWizard<Costcenter>({
    appPath: '/costcenters',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    if (costcenterIdParam && rows.length > 0) {
      const c = rows.find((x) => x.id === costcenterIdParam)
      setSelected(c ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((c) => c.id === cur.id) ? cur : null
    })
  }, [filteredRows, costcenterIdParam, rows])

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

  const loadCostcenters = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<CostcentersListResponse>('/api/costcenters')
      setRows(data.costcenters ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('costcenters.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadCostcenters()
  }, [loadCostcenters])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: Costcenter) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setDialogOpen(true)
  }

  async function saveCostcenter() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const data = await apiJson<CostcenterResponse>(
          `/api/costcenters/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ key, name }),
          },
        )
        setRows((prev) =>
          prev.map((c) => (c.id === editingId ? data.costcenter : c)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.costcenter : cur,
        )
        showSuccess(t('costcenters.updated'))
      } else {
        const data = await apiJson<CostcenterResponse>('/api/costcenters', {
          method: 'POST',
          body: JSON.stringify({ key, name }),
        })
        setRows((prev) =>
          [...prev, data.costcenter].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        )
        showSuccess(t('costcenters.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('costcenters.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Costcenter) {
    confirmDialog({
      header: t('costcenters.delete_header'),
      message: t('costcenters.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteCostcenter(row.id),
    })
  }

  async function deleteCostcenter(id: string) {
    try {
      await apiJson<undefined>(`/api/costcenters/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((c) => c.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('costcenters.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('costcenters.delete_fail'))
      }
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceIdForMenu = costcenterIdParam || selected?.id || ''

  const crudContextMenuItems = buildCrudContextMenuModel(
    {
      onCreate: openCreate,
      onEdit: () => {
        if (selected) openEdit(selected)
      },
      onDelete: () => {
        if (selected) confirmDelete(selected)
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
            `/audit-log?resource_type=costcenter&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const costcentersCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-dollar text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('costcenters.title')}</h1>
          <p className="app-card-hero-desc">{cardSubTitle}</p>
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
          header={costcentersCardHeader}
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
                onClick={() => selected && confirmDelete(selected)}
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
                  aria-label={t('costcenters.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <p className="text-sm text-color-secondary mt-0 mb-3">
            You can read, edit, and delete rows for any site you can access
            (working ∪ additional). New rows are always created for your
            working site. Click a row to select; double-click or Edit to change;
            Delete to remove.
          </p>
          <DataTable
            value={tw.prepareRows(filteredRows)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selected}
            onSelectionChange={(e) => setSelected(e.value as Costcenter | null)}
            contextMenuSelection={selected ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelected(e.value as Costcenter | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as Costcenter
              setSelected(row)
              openEdit(row)
            }}
            emptyMessage={
              search.trim()
                ? t('costcenters.empty_search')
                : t('costcenters.empty')
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
          editingId
            ? t('costcenters.dialog_edit')
            : t('costcenters.dialog_new')
        }
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        dismissableMask={!saving}
        style={{ width: 'min(28rem, 95vw)' }}
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
              onClick={() => void saveCostcenter()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="costcenter-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="costcenter-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="costcenter-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="costcenter-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
        </div>
      </AppCrudDialog>
    </AppShell>
  )
}
