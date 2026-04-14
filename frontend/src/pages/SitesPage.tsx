import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Card } from 'primereact/card'
import { Checkbox } from 'primereact/checkbox'
import { ColorPicker } from 'primereact/colorpicker'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ContextMenu } from 'primereact/contextmenu'
import { DataTable } from 'primereact/datatable'
import { AppCrudDialog } from '../components/app-crud-dialog'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../api'
import { getStoredUser } from '../auth'
import { AppShell } from '../layout/AppShell'
import { useRegisterCreateShortcut } from '../layout/AppCreateShortcut'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../layout/crudContextMenuItems'
import { useRegisterAppToolbarSearch } from '../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../table-wizard'
import { formatDateTime } from '../utils/dateTime'

/** App layout baseline for CRUD list screens — see `apps/template-app/TemplateAppPage.tsx`. */

export type Site = {
  id: string
  key: string
  name: string
  colour: string
  is_plant: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type SitesListResponse = { sites: Site[] }
type SiteResponse = { site: Site }

const DEFAULT_COLOUR = '94a3b8'

function normalizeHexForPicker(colour: string): string {
  const s = colour.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(s) ? s : DEFAULT_COLOUR
}

function withHash(hexWithoutHash: string): string {
  return `#${hexWithoutHash.replace(/^#/, '')}`
}

export default function SitesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const siteIdParam = searchParams.get('siteId')?.trim() ?? ''
  const isAdmin = getStoredUser()?.role === 'admin'

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formColourHex, setFormColourHex] = useState(DEFAULT_COLOUR)
  const [formIsPlant, setFormIsPlant] = useState(false)
  const [selectedSite, setSelectedSite] = useState<Site | null>(null)
  const [search, setSearch] = useState('')

  const auditResourceId = siteIdParam || selectedSite?.id

  const filteredSites = useMemo(() => {
    let list = sites
    if (siteIdParam) {
      list = list.filter((s) => s.id === siteIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.colour.toLowerCase().includes(q) ||
        (s.is_plant ? t('sites.plant_yes') : t('sites.plant_no'))
          .toLowerCase()
          .includes(q) ||
        (s.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (s.updated_by_login_name?.toLowerCase().includes(q) ?? false) ||
        s.created_at.toLowerCase().includes(q) ||
        s.updated_at.toLowerCase().includes(q) ||
        formatDateTime(s.created_at).toLowerCase().includes(q) ||
        formatDateTime(s.updated_at).toLowerCase().includes(q),
    )
  }, [sites, search, siteIdParam, t])

  useEffect(() => {
    if (siteIdParam && sites.length > 0) {
      const s = sites.find((x) => x.id === siteIdParam)
      setSelectedSite(s ?? null)
      return
    }
    setSelectedSite((cur) => {
      if (!cur) return null
      return filteredSites.some((s) => s.id === cur.id) ? cur : null
    })
  }, [filteredSites, siteIdParam, sites])

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

  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<SitesListResponse>('/api/sites')
      setSites(data.sites ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('sites.load_fail'))
      }
      setSites([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadSites()
  }, [loadSites])

  function openCreate() {
    setSelectedSite(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setFormColourHex(DEFAULT_COLOUR)
    setFormIsPlant(false)
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: Site) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setFormColourHex(normalizeHexForPicker(row.colour))
    setFormIsPlant(row.is_plant === true)
    setDialogOpen(true)
  }

  async function saveSite() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError(t('sites.err_key_name'))
      return
    }
    const colour = withHash(formColourHex)
    setSaving(true)
    try {
      if (editingId) {
        const body: {
          key: string
          name: string
          colour: string
          is_plant: boolean
        } = {
          key,
          name,
          colour,
          is_plant: formIsPlant,
        }
        const data = await apiJson<SiteResponse>(`/api/sites/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setSites((prev) =>
          prev.map((s) => (s.id === editingId ? data.site : s)),
        )
        setSelectedSite((cur) =>
          cur?.id === editingId ? data.site : cur,
        )
        showSuccess(t('sites.updated'))
      } else {
        const data = await apiJson<SiteResponse>('/api/sites', {
          method: 'POST',
          body: JSON.stringify({ key, name, colour, is_plant: formIsPlant }),
        })
        setSites((prev) => [...prev, data.site].sort((a, b) =>
          a.name.localeCompare(b.name),
        ))
        showSuccess(t('sites.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('sites.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Site) {
    confirmDialog({
      header: t('sites.delete_header'),
      message: t('sites.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      dismissableMask: true,
      accept: () => void deleteSite(row.id),
    })
  }

  async function deleteSite(id: string) {
    try {
      await apiJson<undefined>(`/api/sites/${id}`, { method: 'DELETE' })
      setSites((prev) => prev.filter((s) => s.id !== id))
      setSelectedSite((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('sites.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('sites.delete_fail'))
      }
    }
  }

  const auditResourceIdForMenu = siteIdParam || selectedSite?.id || ''

  const crudContextMenuItems = buildCrudContextMenuModel(
    {
      onCreate: openCreate,
      onEdit: () => {
        if (selectedSite) openEdit(selectedSite)
      },
      onDelete: () => {
        if (selectedSite) confirmDelete(selectedSite)
      },
      disableEdit: !selectedSite,
      disableDelete: !selectedSite,
    },
    t,
    {
      audit: selectedSite ? rowAuditSnapshot(selectedSite) : undefined,
      auditHistory: {
        visible: isAdmin === true && !!auditResourceIdForMenu,
        onNavigate: () =>
          navigate(
            `/audit-log?resource_type=site&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const colourBody = useCallback((row: Site) => (
    <div className="flex align-items-center gap-2">
      <span
        className="border-round border-1 border-300 flex-shrink-0"
        style={{
          width: '1.25rem',
          height: '1.25rem',
          backgroundColor: row.colour,
        }}
        title={row.colour}
      />
      <span className="text-sm font-mono">{row.colour}</span>
    </div>
  ), [])

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Site>[] => {
    const em = t('common.em_dash')
    return [
      { field: 'key', headerKey: 'common.col_key', sortable: true },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
      {
        field: 'is_plant',
        headerKey: 'sites.col_plant',
        sortable: true,
        body: (row) =>
          row.is_plant ? t('sites.plant_yes') : t('sites.plant_no'),
      },
      {
        field: 'colour',
        headerKey: 'common.col_colour',
        sortable: true,
        body: (row) => colourBody(row),
      },
      {
        field: 'created_by_login_name',
        headerKey: 'common.col_created_by',
        sortable: true,
        body: (row) => row.created_by_login_name ?? em,
      },
      {
        field: 'updated_by_login_name',
        headerKey: 'common.col_updated_by',
        sortable: true,
        body: (row) => row.updated_by_login_name ?? em,
      },
      {
        field: 'created_at',
        headerKey: 'common.col_created',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.created_at),
      },
      {
        field: 'updated_at',
        headerKey: 'common.col_updated',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.updated_at),
      },
    ]
  }, [t, colourBody])

  const tw = useTableWizard<Site>({
    appPath: '/sites',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredSites.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  const sitesCardSubtitle = siteIdParam
    ? t('sites.subtitle_filtered')
    : t('sites.subtitle')

  const sitesCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-building text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('sites.title')}</h1>
          <p className="app-card-hero-desc">{sitesCardSubtitle}</p>
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
          header={sitesCardHeader}
        >
          <div className="px-1 md:px-2">
          <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-3 w-full">
            <div className="flex align-items-center gap-2 flex-wrap">
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
                  disabled={!selectedSite}
                  onClick={() => selectedSite && openEdit(selectedSite)}
                />
                <Button
                  type="button"
                  label={t('common.delete')}
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={!selectedSite}
                  onClick={() => selectedSite && confirmDelete(selectedSite)}
                />
              </ButtonGroup>
              {isAdmin && auditResourceId ? (
                <Button
                  type="button"
                  label={t('common.audit_history')}
                  icon="pi pi-history"
                  severity="secondary"
                  outlined
                  onClick={() =>
                    navigate(
                      `/audit-log?resource_type=site&resource_id=${encodeURIComponent(auditResourceId)}`,
                    )
                  }
                />
              ) : null}
            </div>
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
                  placeholder={t('sites.search_placeholder')}
                  aria-label={t('sites.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <p className="text-sm text-color-secondary mt-0 mb-3">
            {t('sites.help')}
          </p>
          <DataTable
            value={tw.prepareRows(filteredSites)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selectedSite}
            onSelectionChange={(e) => setSelectedSite(e.value as Site | null)}
            contextMenuSelection={selectedSite ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelectedSite(e.value as Site | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as Site
              setSelectedSite(row)
              openEdit(row)
            }}
            emptyMessage={
              search.trim()
                ? t('sites.empty_search')
                : t('sites.empty')
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
        title={editingId ? t('sites.dialog_edit') : t('sites.dialog_new')}
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
              onClick={() => void saveSite()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="site-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="site-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="site-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="site-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-2">
            <span className="text-sm font-medium">{t('common.col_colour')}</span>
            <div className="flex align-items-center gap-3">
              <ColorPicker
                format="hex"
                value={formColourHex}
                onChange={(e) =>
                  setFormColourHex(
                    typeof e.value === 'string'
                      ? normalizeHexForPicker(e.value)
                      : DEFAULT_COLOUR,
                  )
                }
                disabled={saving}
              />
              <span className="text-sm font-mono text-color-secondary">
                {withHash(formColourHex)}
              </span>
            </div>
          </div>
          <div className="flex align-items-center gap-2">
            <Checkbox
              inputId="site-is-plant"
              checked={formIsPlant}
              onChange={(e) => setFormIsPlant(Boolean(e.checked))}
              disabled={saving}
            />
            <label htmlFor="site-is-plant" className="text-sm cursor-pointer">
              {t('sites.plant_checkbox')}
            </label>
          </div>
        </div>
      </AppCrudDialog>
    </AppShell>
  )
}
