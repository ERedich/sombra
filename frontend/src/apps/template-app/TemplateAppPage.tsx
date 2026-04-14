/**
 * Reference CRUD screen: layout and behaviour mirror Sites (`pages/SitesPage.tsx`).
 * Data lives in sessionStorage only (tab session, not the API / DB).
 * Each row is scoped to `site_id` = the signed-in user’s working site (JWT / stored user).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { TemplateEntity } from './types'
import {
  keyTakenByOther,
  loadTemplateEntities,
  persistForWorkingSite,
} from './temporalStorage'

type TemplateRow = TemplateEntity & { site_label: string }

export default function TemplateAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<TemplateEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [selected, setSelected] = useState<TemplateEntity | null>(null)
  const [search, setSearch] = useState('')

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (s) =>
        s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    )
  }, [rows, search])

  const enrichedRows = useMemo((): TemplateRow[] => {
    const u = getStoredUser()
    const map = new Map<string, string>()
    for (const s of u?.selectable_working_sites ?? []) {
      map.set(s.id, `${s.key} — ${s.name}`)
    }
    return filteredRows.map((r) => ({
      ...r,
      site_label: map.get(r.site_id) ?? r.site_id.slice(0, 8),
    }))
  }, [filteredRows])

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<TemplateRow>[] => {
    return [
      { field: 'key', headerKey: 'common.col_key', sortable: true },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
      {
        field: 'site_label',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        type: 'text',
      },
    ]
  }, [])

  const tw = useTableWizard<TemplateRow>({
    appPath: '/template-app',
    columnDefs: tableColumnDefs,
    largeTableRowCount: enrichedRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((s) => s.id === cur.id) ? cur : null
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

  const refreshRowsForWorkingSite = useCallback(() => {
    const ws = getStoredUser()?.working_site_id ?? null
    const all = loadTemplateEntities()
    setRows(ws ? all.filter((r) => r.site_id === ws) : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshRowsForWorkingSite()
    const onFocus = () => refreshRowsForWorkingSite()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshRowsForWorkingSite])

  function commit(next: TemplateEntity[]) {
    const ws = getStoredUser()?.working_site_id
    if (!ws) return
    persistForWorkingSite(ws, next)
    setRows(next)
  }

  function openCreate() {
    if (!getStoredUser()?.working_site_id) {
      showError(t('template.err_no_ws_detail'))
      return
    }
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: TemplateEntity) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setDialogOpen(true)
  }

  function saveEntity() {
    const siteId = getStoredUser()?.working_site_id
    if (!siteId) {
      showError(t('template.err_no_working_site'))
      return
    }
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError(t('template.err_key_name'))
      return
    }
    if (keyTakenByOther(rows, key, editingId ?? undefined)) {
      showError(t('template.err_key_taken'))
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (editingId) {
        const next = rows.map((s) =>
          s.id === editingId ? { ...s, key, name, updated_at: now } : s,
        )
        commit(next)
        const updated = next.find((s) => s.id === editingId)!
        setSelected((cur) => (cur?.id === editingId ? updated : cur))
        showSuccess(t('template.updated'))
      } else {
        const row: TemplateEntity = {
          id: crypto.randomUUID(),
          site_id: siteId,
          key,
          name,
          created_at: now,
          updated_at: now,
        }
        const next = [...rows, row].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        commit(next)
        showSuccess(t('template.created'))
      }
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: TemplateEntity) {
    confirmDialog({
      header: t('template.delete_header'),
      message: t('template.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteEntity(row.id),
    })
  }

  function deleteEntity(id: string) {
    const next = rows.filter((s) => s.id !== id)
    commit(next)
    setSelected((cur) => (cur?.id === id ? null : cur))
    showSuccess(t('template.deleted'))
  }

  const crudContextMenuItems = buildCrudContextMenuModel(
    {
      onCreate: openCreate,
      onEdit: () => {
        if (selected) openEdit(selected)
      },
      onDelete: () => {
        if (selected) confirmDelete(selected)
      },
      disableCreate: !getStoredUser()?.working_site_id,
      disableEdit: !selected,
      disableDelete: !selected,
    },
    t,
    {
      audit: selected
        ? rowAuditSnapshot({
            created_at: selected.created_at,
            updated_at: selected.updated_at,
            created_by_login_name: null,
            updated_by_login_name: null,
          })
        : undefined,
    },
  )

  const templateCardSubtitle = getStoredUser()?.working_site_id
    ? t('template.subtitle_ok')
    : t('template.subtitle_no_ws')

  const templateCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-th-large text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('template.title')}</h1>
          <p className="app-card-hero-desc">{templateCardSubtitle}</p>
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
          header={templateCardHeader}
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
                  aria-label={t('template.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <p className="text-sm text-color-secondary mt-0 mb-3">
            {t('template.help_tab_session')}
          </p>
          <DataTable
            value={tw.prepareRows(enrichedRows)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selected}
            onSelectionChange={(e) =>
              setSelected(e.value as TemplateEntity | null)
            }
            contextMenuSelection={selected ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelected(e.value as TemplateEntity | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as TemplateRow
              setSelected(row)
              openEdit(row)
            }}
            emptyMessage={
              !getStoredUser()?.working_site_id
                ? t('template.empty_no_ws')
                : search.trim()
                  ? t('template.empty_search')
                  : t('template.empty_rows')
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
          editingId ? t('template.dialog_edit') : t('template.dialog_new')
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
              onClick={() => saveEntity()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="template-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="template-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="template-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="template-name"
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
