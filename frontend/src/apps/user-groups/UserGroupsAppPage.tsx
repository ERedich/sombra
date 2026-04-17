/**
 * CRUD for user groups (site-scoped key & name). Membership is managed on the Users page.
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

export type UserGroup = {
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

type UserGroupsListResponse = { user_groups: UserGroup[] }
type UserGroupResponse = { user_group: UserGroup }

function siteColumnBody(row: UserGroup, dash: string) {
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

export default function UserGroupsAppPage() {
  const { t } = useTranslation()
  const { openKira } = useKiraAssistant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userGroupIdParam = searchParams.get('userGroupId')?.trim() ?? ''

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<UserGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [selected, setSelected] = useState<UserGroup | null>(null)
  const [search, setSearch] = useState('')
  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceId = userGroupIdParam || selected?.id
  const emDash = t('common.em_dash')

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<UserGroup>[] => {
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
    if (userGroupIdParam) {
      return t('user_groups.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('user_groups.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('user_groups.subtitle_no_sites')
    }
    return t('user_groups.subtitle_default')
  }, [userGroupIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (userGroupIdParam) {
      list = list.filter((g) => g.id === userGroupIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (g) =>
        g.site_key.toLowerCase().includes(q) ||
        g.site_name.toLowerCase().includes(q) ||
        (g.site_colour?.toLowerCase().includes(q) ?? false) ||
        g.key.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        g.created_at.toLowerCase().includes(q) ||
        g.updated_at.toLowerCase().includes(q) ||
        formatDateTime(g.created_at).toLowerCase().includes(q) ||
        formatDateTime(g.updated_at).toLowerCase().includes(q) ||
        (g.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (g.updated_by_login_name?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, search, userGroupIdParam])

  const tw = useTableWizard<UserGroup>({
    appPath: '/user-groups',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    if (userGroupIdParam && rows.length > 0) {
      const g = rows.find((x) => x.id === userGroupIdParam)
      setSelected(g ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((g) => g.id === cur.id) ? cur : null
    })
  }, [filteredRows, userGroupIdParam, rows])

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

  const loadUserGroups = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<UserGroupsListResponse>('/api/user-groups')
      setRows(data.user_groups ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('user_groups.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadUserGroups()
  }, [loadUserGroups])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: UserGroup) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setDialogOpen(true)
  }

  async function saveUserGroup() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const data = await apiJson<UserGroupResponse>(
          `/api/user-groups/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ key, name }),
          },
        )
        setRows((prev) =>
          prev.map((g) => (g.id === editingId ? data.user_group : g)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.user_group : cur,
        )
        showSuccess(t('user_groups.updated'))
      } else {
        const data = await apiJson<UserGroupResponse>('/api/user-groups', {
          method: 'POST',
          body: JSON.stringify({ key, name }),
        })
        setRows((prev) =>
          [...prev, data.user_group].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        )
        showSuccess(t('user_groups.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('user_groups.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: UserGroup) {
    confirmDialog({
      header: t('user_groups.delete_header'),
      message: t('user_groups.delete_msg', {
        name: row.name,
        key: row.key,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      dismissableMask: true,
      accept: () => void deleteUserGroup(row.id),
    })
  }

  async function deleteUserGroup(id: string) {
    try {
      await apiJson<undefined>(`/api/user-groups/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((g) => g.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('user_groups.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('user_groups.delete_fail'))
      }
    }
  }

  const auditResourceIdForMenu = userGroupIdParam || selected?.id || ''

  const crudContextMenuItems = [
    buildAskKiraMenuItem(t, {
      openKira,
      disabled: !selected,
      getDraft: () =>
        selected
          ? formatKiraRowDraft(t('user_groups.title'), {
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
              `/audit-log?resource_type=user_group&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
            ),
        },
      },
    ),
  ]

  const userGroupsCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-users text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('user_groups.title')}</h1>
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
          header={userGroupsCardHeader}
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
              {isAdmin && auditResourceId ? (
                <Button
                  type="button"
                  label={t('common.audit_history')}
                  icon="pi pi-history"
                  severity="secondary"
                  outlined
                  onClick={() =>
                    navigate(
                      `/audit-log?resource_type=user_group&resource_id=${encodeURIComponent(auditResourceId)}`,
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
                  placeholder={t('common.search_ellipsis')}
                  aria-label={t('user_groups.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <p className="text-sm text-color-secondary mt-0 mb-3">
            {t('user_groups.help')}
          </p>
          <DataTable
            value={tw.prepareRows(filteredRows)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selected}
            onSelectionChange={(e) => setSelected(e.value as UserGroup | null)}
            contextMenuSelection={selected ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelected(e.value as UserGroup | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as UserGroup
              setSelected(row)
              openEdit(row)
            }}
            emptyMessage={
              search.trim()
                ? 'No records match your search.'
                : 'No user groups yet. Create one to get started.'
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
          editingId ? t('user_groups.dialog_edit') : t('user_groups.dialog_new')
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
              onClick={() => void saveUserGroup()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="ug-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="ug-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="ug-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="ug-name"
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
