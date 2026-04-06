import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Card } from 'primereact/card'
import { Checkbox } from 'primereact/checkbox'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ContextMenu } from 'primereact/contextmenu'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { Password } from 'primereact/password'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../api'
import { getStoredUser } from '../auth'
import { useRegisterCreateShortcut } from '../layout/AppCreateShortcut'
import { AppShell } from '../layout/AppShell'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../layout/crudContextMenuItems'
import { useRegisterAppToolbarSearch } from '../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../table-wizard'
import { formatDateTime } from '../utils/dateTime'
import { isValidEmailFormat } from '../utils/email'
import type { Site } from './SitesPage'
import type { UserGroup } from '../apps/user-groups/UserGroupsAppPage'

export type AdditionalSiteRef = { id: string; key: string; name: string }

export type UserGroupRef = { id: string; key: string; name: string; site_id: string }

export type EmployeeRef = {
  id: string
  key: string
  name: string
  site_id: string
  site_key: string
  site_name: string
}

export type AppUser = {
  id: string
  login_name: string
  name: string
  email: string | null
  role: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
  working_site_id: string | null
  allow_site_change_on_login: boolean
  additional_sites: AdditionalSiteRef[]
  working_site_key: string | null
  working_site_name: string | null
  working_site_colour: string | null
  employee_id: string | null
  employee_key: string | null
  employee_name: string | null
  employee_site_id: string | null
  employee_site_key: string | null
  employee_site_name: string | null
  groups: UserGroupRef[]
}

type UsersListResponse = { users: AppUser[] }
type UserResponse = { user: AppUser }
type SitesListResponse = { sites: Site[] }
type UserGroupsListResponse = { user_groups: UserGroup[] }
type EmployeesListResponse = { employees: EmployeeRef[] }


/** Matches seeded bootstrap account; API rejects edit/delete for this user. */
function isBootstrapAdminUser(u: AppUser | null): boolean {
  return u !== null && u.login_name === 'admin'
}

type UserFormFieldKey =
  | 'login_name'
  | 'name'
  | 'email'
  | 'password'
  | 'working_site'
  | 'employee'

function inferFieldErrorsFromApiMessage(
  msg: string,
): Partial<Record<UserFormFieldKey, boolean>> {
  const m = msg.toLowerCase()
  const out: Partial<Record<UserFormFieldKey, boolean>> = {}
  if (m.includes('email')) out.email = true
  if (m.includes('login_name') || m.includes('login name')) {
    out.login_name = true
  } else if (m.includes('name cannot') || m.includes('display name')) {
    out.name = true
  }
  if (m.includes('password')) out.password = true
  if (m.includes('working_site')) out.working_site = true
  if (m.includes('employee')) out.employee = true
  if (m.includes('already exists')) {
    out.login_name = true
    out.email = true
  }
  return out
}

export default function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userIdParam = searchParams.get('userId')?.trim() ?? ''
  const isAdmin = getStoredUser()?.role === 'admin'

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formLoginName, setFormLoginName] = useState('')
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState('user')
  const [formPassword, setFormPassword] = useState('')
  const [formWorkingSiteId, setFormWorkingSiteId] = useState<string | null>(null)
  const [formAdditionalSiteIds, setFormAdditionalSiteIds] = useState<string[]>(
    [],
  )
  const [formAllowSiteChangeOnLogin, setFormAllowSiteChangeOnLogin] =
    useState(false)
  const [siteOptions, setSiteOptions] = useState<Site[]>([])
  const [allUserGroups, setAllUserGroups] = useState<UserGroup[]>([])
  const [allEmployees, setAllEmployees] = useState<EmployeeRef[]>([])
  const [formGroupIds, setFormGroupIds] = useState<string[]>([])
  const [formEmployeeId, setFormEmployeeId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(0)
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null)
  const [search, setSearch] = useState('')
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<UserFormFieldKey, boolean>>
  >({})

  const auditResourceId = userIdParam || selectedUser?.id
  const emDash = t('common.em_dash')

  const usersCardSubtitle = useMemo(
    () =>
      userIdParam ? t('users.subtitle_filtered') : t('users.subtitle'),
    [userIdParam, t],
  )

  const additionalOptions = useMemo(
    () => siteOptions.filter((s) => s.id !== formWorkingSiteId),
    [siteOptions, formWorkingSiteId],
  )

  const allowedSiteIdsForGroups = useMemo(() => {
    const s = new Set<string>()
    if (formWorkingSiteId) s.add(formWorkingSiteId)
    for (const id of formAdditionalSiteIds) s.add(id)
    return s
  }, [formWorkingSiteId, formAdditionalSiteIds])

  const groupOptionsFiltered = useMemo(
    () => allUserGroups.filter((g) => allowedSiteIdsForGroups.has(g.site_id)),
    [allUserGroups, allowedSiteIdsForGroups],
  )
  const employeeOptionsFiltered = useMemo(
    () => allEmployees.filter((e) => allowedSiteIdsForGroups.has(e.site_id)),
    [allEmployees, allowedSiteIdsForGroups],
  )

  const roleOptions = useMemo(
    () => [
      { label: t('users.role_user'), value: 'user' },
      { label: t('users.role_admin'), value: 'admin' },
    ],
    [t],
  )

  useEffect(() => {
    if (allUserGroups.length === 0) return
    setFormGroupIds((prev) =>
      prev.filter((id) => groupOptionsFiltered.some((g) => g.id === id)),
    )
  }, [
    formWorkingSiteId,
    formAdditionalSiteIds,
    allUserGroups,
    groupOptionsFiltered,
  ])

  const filteredUsers = useMemo(() => {
    let list = users
    if (userIdParam) {
      list = list.filter((u) => u.id === userIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (u) =>
        u.login_name.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.employee_name?.toLowerCase().includes(q) ?? false) ||
        (u.employee_key?.toLowerCase().includes(q) ?? false) ||
        (u.email?.toLowerCase().includes(q) ?? false) ||
        (u.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (u.updated_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (u.working_site_key?.toLowerCase().includes(q) ?? false) ||
        (u.working_site_name?.toLowerCase().includes(q) ?? false) ||
        (u.working_site_colour?.toLowerCase().includes(q) ?? false) ||
        u.created_at.toLowerCase().includes(q) ||
        u.updated_at.toLowerCase().includes(q) ||
        formatDateTime(u.created_at).toLowerCase().includes(q) ||
        formatDateTime(u.updated_at).toLowerCase().includes(q),
    )
  }, [users, search, userIdParam])

  useEffect(() => {
    if (userIdParam && users.length > 0) {
      const u = users.find((x) => x.id === userIdParam)
      setSelectedUser(u ?? null)
      return
    }
    setSelectedUser((cur) => {
      if (!cur) return null
      return filteredUsers.some((u) => u.id === cur.id) ? cur : null
    })
  }, [filteredUsers, userIdParam, users])

  useEffect(() => {
    if (!dialogOpen) return
    void (async () => {
      try {
        const [sitesData, groupsData, employeesData] = await Promise.all([
          apiJson<SitesListResponse>('/api/sites'),
          apiJson<UserGroupsListResponse>('/api/user-groups'),
          apiJson<EmployeesListResponse>('/api/employees'),
        ])
        setSiteOptions(sitesData.sites ?? [])
        setAllUserGroups(groupsData.user_groups ?? [])
        setAllEmployees(employeesData.employees ?? [])
      } catch {
        setSiteOptions([])
        setAllUserGroups([])
        setAllEmployees([])
      }
    })()
  }, [dialogOpen])

  useEffect(() => {
    if (formAdditionalSiteIds.length === 0) {
      setFormAllowSiteChangeOnLogin(false)
    }
  }, [formAdditionalSiteIds.length])

  useEffect(() => {
    if (!formEmployeeId) return
    if (employeeOptionsFiltered.some((x) => x.id === formEmployeeId)) return
    setFormEmployeeId(null)
  }, [employeeOptionsFiltered, formEmployeeId])

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

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<UsersListResponse>('/api/users')
      setUsers(data.users ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('users.load_fail'))
      }
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  function openCreate() {
    setSelectedUser(null)
    setEditingId(null)
    setFormLoginName('')
    setFormName('')
    setFormEmail('')
    setFormRole('user')
    setFormPassword('')
    setFormWorkingSiteId(getStoredUser()?.working_site_id ?? null)
    setFormAdditionalSiteIds([])
    setFormGroupIds([])
    setFormEmployeeId(null)
    setFormAllowSiteChangeOnLogin(false)
    setFieldErrors({})
    setActiveTab(0)
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: AppUser) {
    setEditingId(row.id)
    setFormLoginName(row.login_name)
    setFormName(row.name)
    setFormEmail(row.email ?? '')
    setFormRole(row.role)
    setFormPassword('')
    setFormWorkingSiteId(row.working_site_id)
    setFormAdditionalSiteIds(row.additional_sites.map((s) => s.id))
    setFormGroupIds(row.groups?.map((g) => g.id) ?? [])
    setFormEmployeeId(row.employee_id)
    setFormAllowSiteChangeOnLogin(row.allow_site_change_on_login)
    setFieldErrors({})
    setActiveTab(0)
    setDialogOpen(true)
  }

  function onWorkingSiteChange(id: string | null) {
    setFormWorkingSiteId(id)
    setFormAdditionalSiteIds((prev) => prev.filter((x) => x !== id))
    setFieldErrors((p) => ({ ...p, working_site: false }))
  }

  async function saveUser() {
    const login_name = formLoginName.trim()
    const name = formName.trim()
    const emailTrim = formEmail.trim()
    const email = emailTrim === '' ? null : emailTrim

    const nextErrors: Partial<Record<UserFormFieldKey, boolean>> = {}
    if (!login_name) nextErrors.login_name = true
    if (!name) nextErrors.name = true
    if (email !== null && !isValidEmailFormat(email)) nextErrors.email = true
    if (!editingId && !formPassword) nextErrors.password = true
    if (!formWorkingSiteId) nextErrors.working_site = true
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      const hasAccount =
        nextErrors.login_name ||
        nextErrors.name ||
        nextErrors.email ||
        nextErrors.password
      setActiveTab(hasAccount ? 0 : 1)
      let message = t('users.err_check_fields')
      if (!login_name || !name) {
        message = t('users.err_required')
      } else if (email !== null && !isValidEmailFormat(email)) {
        message = t('users.err_email_detail')
      } else if (!editingId && !formPassword) {
        message = t('users.err_password_new')
      } else if (!formWorkingSiteId) {
        message = t('users.err_working_site')
      }
      showError(message)
      return
    }
    setFieldErrors({})
    const sitePayload = {
      working_site_id: formWorkingSiteId,
      additional_site_ids: formAdditionalSiteIds,
      allow_site_change_on_login:
        formAdditionalSiteIds.length > 0 && formAllowSiteChangeOnLogin,
      user_group_ids: formGroupIds,
      employee_id: formEmployeeId,
    }
    setSaving(true)
    try {
      if (editingId) {
        const body: Record<string, unknown> = {
          login_name,
          name,
          email,
          role: formRole,
          ...sitePayload,
        }
        if (formPassword) body.password = formPassword
        const data = await apiJson<UserResponse>(`/api/users/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setUsers((prev) =>
          prev.map((u) => (u.id === editingId ? data.user : u)),
        )
        setSelectedUser((cur) =>
          cur?.id === editingId ? data.user : cur,
        )
        showSuccess(t('users.updated'))
      } else {
        const data = await apiJson<UserResponse>('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            login_name,
            name,
            email,
            role: formRole,
            password: formPassword,
            ...sitePayload,
          }),
        })
        setUsers((prev) =>
          [...prev, data.user].sort((a, b) =>
            a.login_name.localeCompare(b.login_name),
          ),
        )
        showSuccess(t('users.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        const inferred = inferFieldErrorsFromApiMessage(e.message)
        if (Object.keys(inferred).length > 0) {
          setFieldErrors(inferred)
          const hasAccount =
            inferred.login_name ||
            inferred.name ||
            inferred.email ||
            inferred.password
          setActiveTab(hasAccount ? 0 : 1)
        }
        showError(e.message)
      } else {
        showError(t('users.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: AppUser) {
    confirmDialog({
      header: t('users.delete_header'),
      message: t('users.delete_msg', {
        name: row.name,
        login: row.login_name,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      dismissableMask: true,
      accept: () => void deleteUser(row.id),
    })
  }

  async function deleteUser(id: string) {
    try {
      await apiJson<undefined>(`/api/users/${id}`, { method: 'DELETE' })
      setUsers((prev) => prev.filter((u) => u.id !== id))
      setSelectedUser((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('users.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('users.delete_fail'))
      }
    }
  }

  const auditResourceIdForMenu = userIdParam || selectedUser?.id || ''

  const crudContextMenuItems = buildCrudContextMenuModel(
    {
      onCreate: openCreate,
      onEdit: () => {
        if (selectedUser && !isBootstrapAdminUser(selectedUser)) {
          openEdit(selectedUser)
        }
      },
      onDelete: () => {
        if (selectedUser && !isBootstrapAdminUser(selectedUser)) {
          confirmDelete(selectedUser)
        }
      },
      disableEdit: !selectedUser || isBootstrapAdminUser(selectedUser),
      disableDelete: !selectedUser || isBootstrapAdminUser(selectedUser),
    },
    t,
    {
      audit: selectedUser ? rowAuditSnapshot(selectedUser) : undefined,
      auditHistory: {
        visible: isAdmin === true && !!auditResourceIdForMenu,
        onNavigate: () =>
          navigate(
            `/audit-log?resource_type=user&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const workingSiteBody = useCallback(
    (row: AppUser) => {
      if (row.working_site_name && row.working_site_key) {
        const colour =
          typeof row.working_site_colour === 'string' &&
          row.working_site_colour.trim() !== ''
            ? row.working_site_colour.trim()
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
              {row.working_site_name} ({row.working_site_key})
            </span>
          </div>
        )
      }
      return emDash
    },
    [emDash],
  )

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<AppUser>[] => {
    return [
      {
        field: 'login_name',
        headerKey: 'common.col_login_name',
        sortable: true,
      },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
      {
        field: 'email',
        headerKey: 'common.col_email',
        sortable: true,
        body: (row) => row.email ?? emDash,
      },
      { field: 'role', headerKey: 'common.col_role', sortable: true },
      {
        field: 'working_site_name',
        sortField: 'working_site_name',
        headerKey: 'common.col_working_site',
        sortable: true,
        body: workingSiteBody,
      },
      {
        field: 'employee_name',
        headerKey: 'users.field_employee_optional',
        sortable: true,
        body: (row) =>
          row.employee_name && row.employee_key
            ? `${row.employee_name} (${row.employee_key})`
            : emDash,
      },
      {
        field: 'created_by_login_name',
        headerKey: 'common.col_created_by',
        sortable: true,
        body: (row) => row.created_by_login_name ?? emDash,
      },
      {
        field: 'updated_by_login_name',
        headerKey: 'common.col_updated_by',
        sortable: true,
        body: (row) => row.updated_by_login_name ?? emDash,
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
  }, [emDash, t, workingSiteBody])

  const tw = useTableWizard<AppUser>({
    appPath: '/users',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredUsers.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  const usersCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-user text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('users.title')}</h1>
          <p className="app-card-hero-desc">{usersCardSubtitle}</p>
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

      <div className="p-4 app-page-mw-xl flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={usersCardHeader}
        >
          <div className="px-1 md:px-2">
          <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-3 w-full">
            <div className="flex align-items-center gap-2 flex-wrap">
              <ButtonGroup>
                <Button
                  type="button"
                  label="Create"
                  icon="pi pi-plus"
                  onClick={openCreate}
                />
                <Button
                  type="button"
                  label="Edit"
                  icon="pi pi-pencil"
                  disabled={!selectedUser || isBootstrapAdminUser(selectedUser)}
                  onClick={() => selectedUser && openEdit(selectedUser)}
                />
                <Button
                  type="button"
                  label="Delete"
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={!selectedUser || isBootstrapAdminUser(selectedUser)}
                  onClick={() => selectedUser && confirmDelete(selectedUser)}
                />
              </ButtonGroup>
              {isAdmin && auditResourceId ? (
                <Button
                  type="button"
                  label="Audit history"
                  icon="pi pi-history"
                  severity="secondary"
                  outlined
                  onClick={() =>
                    navigate(
                      `/audit-log?resource_type=user&resource_id=${encodeURIComponent(auditResourceId)}`,
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
                  placeholder={t('users.search_placeholder')}
                  aria-label={t('users.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <p className="text-sm text-color-secondary mt-0 mb-3">
            {t('users.help_full')}
          </p>
          <DataTable
            value={tw.prepareRows(filteredUsers)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selectedUser}
            onSelectionChange={(e) => setSelectedUser(e.value as AppUser | null)}
            contextMenuSelection={selectedUser ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelectedUser(e.value as AppUser | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as AppUser
              setSelectedUser(row)
              if (!isBootstrapAdminUser(row)) openEdit(row)
            }}
            emptyMessage={
              search.trim() ? t('users.empty_search') : t('users.empty')
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
        header={editingId ? t('users.dialog_edit') : t('users.dialog_new')}
        visible={dialogOpen}
        onHide={() => {
          setFieldErrors({})
          setDialogOpen(false)
        }}
        dismissableMask={!saving}
        style={{ width: 'min(56rem, 96vw)' }}
        breakpoints={{ '960px': '92vw', '640px': '96vw' }}
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
              onClick={() => void saveUser()}
              loading={saving}
            />
          </div>
        }
      >
        <TabView
          className="app-modal-tabview"
          activeIndex={activeTab}
          onTabChange={(e) => setActiveTab(e.index)}
        >
          <TabPanel header={t('users.tab_account')}>
            <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
              <div className="flex flex-column gap-2">
                <label htmlFor="user-login-name" className="text-sm font-medium">
                  {t('users.field_login_name')}
                </label>
                <InputText
                  id="user-login-name"
                  value={formLoginName}
                  onChange={(e) => {
                    setFormLoginName(e.target.value)
                    setFieldErrors((p) => ({ ...p, login_name: false }))
                  }}
                  className="w-full"
                  disabled={saving}
                  autoComplete="off"
                  invalid={fieldErrors.login_name === true}
                  aria-invalid={fieldErrors.login_name === true}
                />
              </div>
              <div className="flex flex-column gap-2">
                <label
                  htmlFor="user-display-name"
                  className="text-sm font-medium"
                >
                  {t('users.field_display_name')}
                </label>
                <InputText
                  id="user-display-name"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value)
                    setFieldErrors((p) => ({ ...p, name: false }))
                  }}
                  className="w-full"
                  disabled={saving}
                  invalid={fieldErrors.name === true}
                  aria-invalid={fieldErrors.name === true}
                />
              </div>
              <div className="flex flex-column gap-2">
                <label htmlFor="user-email" className="text-sm font-medium">
                  {t('users.field_email_optional')}
                </label>
                <InputText
                  id="user-email"
                  value={formEmail}
                  onChange={(e) => {
                    setFormEmail(e.target.value)
                    setFieldErrors((p) => ({ ...p, email: false }))
                  }}
                  className="w-full"
                  disabled={saving}
                  type="email"
                  maxLength={254}
                  placeholder={t('users.placeholder_email')}
                  invalid={fieldErrors.email === true}
                  aria-invalid={fieldErrors.email === true}
                />
              </div>
              <div className="flex flex-column gap-2">
                <span className="text-sm font-medium">
                  {t('users.field_role')}
                </span>
                <Dropdown
                  value={formRole}
                  onChange={(e) => setFormRole(String(e.value))}
                  options={roleOptions}
                  className="w-full"
                  disabled={saving}
                />
              </div>
              <div className="flex flex-column gap-2">
                <label htmlFor="user-password" className="text-sm font-medium">
                  {editingId
                    ? t('users.field_password_new_blank')
                    : t('users.field_password')}
                </label>
                <Password
                  id="user-password"
                  value={formPassword}
                  onChange={(e) => {
                    setFormPassword(e.target.value)
                    setFieldErrors((p) => ({ ...p, password: false }))
                  }}
                  feedback={editingId ? false : true}
                  toggleMask
                  className="w-full"
                  inputClassName="w-full"
                  disabled={saving}
                  autoComplete="new-password"
                  invalid={fieldErrors.password === true}
                />
              </div>
              <div className="flex flex-column gap-2">
                <label htmlFor="user-employee" className="text-sm font-medium">
                  {t('users.field_employee_optional')}
                </label>
                <Dropdown
                  inputId="user-employee"
                  value={formEmployeeId}
                  onChange={(e) => {
                    setFormEmployeeId((e.value as string | null) ?? null)
                    setFieldErrors((p) => ({ ...p, employee: false }))
                  }}
                  options={employeeOptionsFiltered}
                  optionLabel="name"
                  optionValue="id"
                  className="w-full"
                  disabled={saving}
                  showClear
                  filter
                  placeholder={t('users.placeholder_employee_optional')}
                  invalid={fieldErrors.employee === true}
                  itemTemplate={(opt) => {
                    const e = opt as EmployeeRef
                    return (
                      <span>
                        {e.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({e.key}) · {e.site_key}
                        </span>
                      </span>
                    )
                  }}
                  valueTemplate={(opt) => {
                    if (!opt) return <span>{t('users.placeholder_employee_optional')}</span>
                    const e = opt as EmployeeRef
                    return (
                      <span>
                        {e.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({e.key})
                        </span>
                      </span>
                    )
                  }}
                />
              </div>
              <p className="text-xs text-color-secondary m-0">
                {t('users.employee_note')}
              </p>
            </div>
          </TabPanel>
          <TabPanel header={t('users.tab_site')}>
            <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
              <div className="flex flex-column gap-2">
                <label htmlFor="user-working-site" className="text-sm font-medium">
                  {t('users.field_working_site')}
                </label>
                <Dropdown
                  inputId="user-working-site"
                  value={formWorkingSiteId}
                  onChange={(e) =>
                    onWorkingSiteChange((e.value as string | null) ?? null)
                  }
                  options={siteOptions}
                  optionLabel="name"
                  optionValue="id"
                  className="w-full"
                  disabled={saving}
                  placeholder={t('users.placeholder_working_site')}
                  invalid={fieldErrors.working_site === true}
                  itemTemplate={(opt) => {
                    const s = opt as Site
                    return (
                      <span>
                        {s.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({s.key})
                        </span>
                      </span>
                    )
                  }}
                  valueTemplate={(opt) => {
                    if (!opt) return <span>{t('users.placeholder_select_main_site')}</span>
                    const s = opt as Site
                    return (
                      <span>
                        {s.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({s.key})
                        </span>
                      </span>
                    )
                  }}
                />
              </div>
              <div className="flex flex-column gap-2">
                <span className="text-sm font-medium">
                  {t('users.field_additional_sites')}
                </span>
                <MultiSelect
                  value={formAdditionalSiteIds}
                  onChange={(e) =>
                    setFormAdditionalSiteIds((e.value as string[]) ?? [])
                  }
                  options={additionalOptions}
                  optionLabel="name"
                  optionValue="id"
                  display="chip"
                  className="w-full"
                  disabled={saving}
                  placeholder={t('users.placeholder_additional_sites')}
                  filter
                />
              </div>
              <div className="flex align-items-center gap-2">
                <Checkbox
                  inputId="allow-site-change"
                  checked={formAllowSiteChangeOnLogin}
                  onChange={(e) =>
                    setFormAllowSiteChangeOnLogin(Boolean(e.checked))
                  }
                  disabled={
                    saving || formAdditionalSiteIds.length === 0
                  }
                />
                <label htmlFor="allow-site-change" className="text-sm">
                  Allow site change on login
                </label>
              </div>
              <p className="text-xs text-color-secondary m-0">
                {t('users.site_tab_note')}
              </p>
            </div>
          </TabPanel>
          <TabPanel header="Group assignment">
            <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
              <div className="flex flex-column gap-2">
                <span className="text-sm font-medium">Groups</span>
                <MultiSelect
                  value={formGroupIds}
                  onChange={(e) =>
                    setFormGroupIds((e.value as string[]) ?? [])
                  }
                  options={groupOptionsFiltered}
                  optionLabel="name"
                  optionValue="id"
                  display="chip"
                  className="w-full"
                  disabled={saving}
                  placeholder={
                    allowedSiteIdsForGroups.size === 0
                      ? t('users.placeholder_groups_need_ws')
                      : t('users.placeholder_groups_optional')
                  }
                  filter
                  itemTemplate={(opt) => {
                    const g = opt as UserGroup
                    return (
                      <span>
                        {g.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({g.key}) · {g.site_key}
                        </span>
                      </span>
                    )
                  }}
                  selectedItemTemplate={(opt) => {
                    if (opt == null || opt === '') return <span>{emDash}</span>
                    const id =
                      typeof opt === 'string'
                        ? opt
                        : (opt as UserGroup).id
                    const g =
                      groupOptionsFiltered.find((x) => x.id === id) ??
                      allUserGroups.find((x) => x.id === id)
                    if (!g) {
                      return (
                        <span className="text-color-secondary text-sm">
                          {id}
                        </span>
                      )
                    }
                    return (
                      <span>
                        {g.name}{' '}
                        <span className="text-color-secondary text-sm">
                          ({g.key})
                        </span>
                      </span>
                    )
                  }}
                />
              </div>
              <p className="text-xs text-color-secondary m-0">
                {t('users.groups_tab_note')}
              </p>
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
    </AppShell>
  )
}
