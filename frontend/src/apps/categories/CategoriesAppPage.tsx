/**
 * CRUD for categories — key, name, site (usable from work orders and work plans).
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
import { Dialog } from 'primereact/dialog'
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

export type Category = {
  id: string
  site_id: string
  key: string
  name: string
  site_key: string
  site_name: string
  site_colour: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type CategoriesListResponse = { categories: Category[] }
type CategoryResponse = { category: Category }

function siteColumnBody(row: Category, dash: string) {
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

export default function CategoriesAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const categoryIdParam = searchParams.get('categoryId')?.trim() ?? ''

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [selected, setSelected] = useState<Category | null>(null)
  const [search, setSearch] = useState('')
  const emDash = t('common.em_dash')

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Category>[] => {
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
    if (categoryIdParam) {
      return t('categories.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('categories.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('categories.subtitle_no_sites')
    }
    return t('categories.subtitle_default')
  }, [categoryIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (categoryIdParam) {
      list = list.filter((r) => r.id === categoryIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        r.site_key.toLowerCase().includes(q) ||
        r.site_name.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (r.updated_by_login_name?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, search, categoryIdParam])

  const tw = useTableWizard<Category>({
    appPath: '/categories',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    if (categoryIdParam && rows.length > 0) {
      const c = rows.find((x) => x.id === categoryIdParam)
      setSelected(c ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((r) => r.id === cur.id) ? cur : null
    })
  }, [filteredRows, categoryIdParam, rows])

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

  const loadCategories = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<CategoriesListResponse>('/api/categories')
      setRows(data.categories ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('categories.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: Category) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setDialogOpen(true)
  }

  async function saveCategory() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const data = await apiJson<CategoryResponse>(
          `/api/categories/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ key, name }),
          },
        )
        setRows((prev) =>
          prev.map((c) => (c.id === editingId ? data.category : c)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.category : cur,
        )
        showSuccess(t('categories.updated'))
      } else {
        const data = await apiJson<CategoryResponse>('/api/categories', {
          method: 'POST',
          body: JSON.stringify({ key, name }),
        })
        setRows((prev) =>
          [...prev, data.category].sort((a, b) =>
            `${a.site_key} ${a.key}`.localeCompare(`${b.site_key} ${b.key}`),
          ),
        )
        showSuccess(t('categories.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('categories.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Category) {
    confirmDialog({
      header: t('categories.delete_header'),
      message: t('categories.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteCategory(row.id),
    })
  }

  async function deleteCategory(id: string) {
    try {
      await apiJson<undefined>(`/api/categories/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((c) => c.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('categories.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('categories.delete_fail'))
      }
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceIdForMenu = categoryIdParam || selected?.id || ''

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
            `/audit-log?resource_type=category&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const categoriesCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-folder text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('categories.title')}</h1>
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
          header={categoriesCardHeader}
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
                    aria-label={t('categories.search_aria')}
                    className="w-full"
                />
              </IconField>
            </div>
            </div>
            <p className="text-sm text-color-secondary mt-0 mb-3">
              {t('categories.subtitle_default')}
            </p>
            <DataTable
              value={tw.prepareRows(filteredRows)}
              loading={loading || tw.tableBusy}
              dataKey="id"
              selection={selected}
              onSelectionChange={(e) => setSelected(e.value as Category | null)}
              contextMenuSelection={selected ?? undefined}
              onContextMenuSelectionChange={(e) =>
                setSelected(e.value as Category | null)
              }
              onContextMenu={(e) => {
                e.originalEvent.preventDefault()
                crudContextMenuRef.current?.show(e.originalEvent)
              }}
              selectionMode="single"
              metaKeySelection={false}
              onRowDoubleClick={(e) => {
                const row = e.data as Category
                setSelected(row)
                openEdit(row)
              }}
              emptyMessage={
                search.trim()
                  ? t('categories.empty_search')
                  : t('categories.empty')
              }
              stripedRows
              {...tw.tableLayoutProps}
            >
              {tw.renderColumns()}
            </DataTable>
          </div>
        </Card>
      </div>

      <Dialog
        header={
          editingId ? t('categories.dialog_edit') : t('categories.dialog_new')
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
              onClick={() => void saveCategory()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="cat-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="cat-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="cat-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="cat-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
        </div>
      </Dialog>
    </AppShell>
  )
}
