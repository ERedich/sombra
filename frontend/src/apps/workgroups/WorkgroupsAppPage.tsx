/**
 * CRUD for workgroups — site, key, name, optional cost center; member management.
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
import { Dropdown } from 'primereact/dropdown'
import { PickList } from 'primereact/picklist'
import { ProgressSpinner } from 'primereact/progressspinner'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputNumber } from 'primereact/inputnumber'
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
import { useAppParameters } from '../../layout/AppParametersProvider'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../../table-wizard'
import {
  BulkOperationOverlay,
  shouldShowBulkTableFeedback,
  useTableWizard,
  useTableWizardToastEffect,
} from '../../table-wizard'
import { formatDateTime } from '../../utils/dateTime'
import type { Employee } from '../employees/EmployeesAppPage'

export type Workgroup = {
  id: string
  site_id: string
  site_key: string
  site_name: string
  site_colour: string
  key: string
  name: string
  costcenter_id: string | null
  costcenter_key: string | null
  costcenter_name: string | null
  /** Hourly rate; API may return string from numeric column. */
  hour_rate?: string | number | null
  hour_rate_currency?: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type CostcenterRow = { id: string; site_id: string; key: string; name: string }
type CostcentersListResponse = { costcenters: CostcenterRow[] }

type WorkgroupsListResponse = { workgroups: Workgroup[] }
type WorkgroupResponse = { workgroup: Workgroup }

type WgMemberRow = {
  employee_id: string
  employee_key: string
  employee_name: string
}

type WgEmployeesResponse = { employees: WgMemberRow[] }

type PoolItem = { id: string; key: string; name: string }

function buildMemberPools(
  allEmployees: Employee[],
  members: WgMemberRow[],
  siteId: string,
): { source: PoolItem[]; target: PoolItem[] } {
  const assignedIds = new Set(members.map((m) => m.employee_id))
  const target: PoolItem[] = members
    .map((m) => ({
      id: m.employee_id,
      key: m.employee_key,
      name: m.employee_name,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    )
  const source: PoolItem[] = allEmployees
    .filter((e) => e.site_id === siteId && !assignedIds.has(e.id))
    .map((e) => ({ id: e.id, key: e.key, name: e.name }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    )
  return { source, target }
}

function siteColumnBody(row: Workgroup, dash: string) {
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

function costcenterBody(row: Workgroup, emDash: string) {
  const k = row.costcenter_key?.trim() ?? ''
  const n = row.costcenter_name?.trim() ?? ''
  if (!k && !n) return emDash
  if (k && n) return `${k} — ${n}`
  return k || n || emDash
}

function parseWorkgroupHourRate(
  v: string | number | null | undefined,
): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

function hourRateBody(row: Workgroup, emDash: string) {
  const rate = parseWorkgroupHourRate(row.hour_rate)
  const cur = row.hour_rate_currency?.trim().toUpperCase() ?? ''
  if (rate === null || !cur) return emDash
  return `${rate} ${cur}`
}

export default function WorkgroupsAppPage() {
  const { t } = useTranslation()
  const { currencies } = useAppParameters()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workgroupIdParam = searchParams.get('workgroupId')?.trim() ?? ''

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<Workgroup[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [costcenters, setCostcenters] = useState<CostcenterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formCostcenterId, setFormCostcenterId] = useState<string | null>(null)
  const [formHourRate, setFormHourRate] = useState<number | null>(null)
  const [formHourCurrency, setFormHourCurrency] = useState<string | null>(null)
  const [selected, setSelected] = useState<Workgroup | null>(null)
  const [search, setSearch] = useState('')
  const [membersOpen, setMembersOpen] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberRows, setMemberRows] = useState<WgMemberRow[]>([])
  const [sourcePool, setSourcePool] = useState<PoolItem[]>([])
  const [targetPool, setTargetPool] = useState<PoolItem[]>([])
  const targetPoolRef = useRef<PoolItem[]>([])
  const baselineIdsRef = useRef<Set<string>>(new Set())
  const [assignmentDirty, setAssignmentDirty] = useState(false)
  const [memberSaving, setMemberSaving] = useState(false)
  const [bulkMembersOverlay, setBulkMembersOverlay] = useState(false)
  const emDash = t('common.em_dash')

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Workgroup>[] => {
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
        field: 'costcenter_key',
        headerKey: 'workgroups.field_costcenter',
        sortable: true,
        sortField: 'costcenter_key',
        body: (row) => costcenterBody(row, emDash),
      },
      {
        field: 'hour_rate',
        headerKey: 'workgroups.col_hour_rate',
        sortable: true,
        sortField: 'hour_rate',
        body: (row) => hourRateBody(row, emDash),
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

  const workingSiteId = getStoredUser()?.working_site_id ?? null

  const cardSubTitle = useMemo(() => {
    if (workgroupIdParam) {
      return t('workgroups.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('workgroups.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('workgroups.subtitle_no_sites')
    }
    return t('workgroups.subtitle_default')
  }, [workgroupIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (workgroupIdParam) {
      list = list.filter((c) => c.id === workgroupIdParam)
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
        (c.costcenter_key?.toLowerCase().includes(q) ?? false) ||
        (c.costcenter_name?.toLowerCase().includes(q) ?? false) ||
        hourRateBody(c, '').toLowerCase().includes(q) ||
        c.created_at.toLowerCase().includes(q) ||
        c.updated_at.toLowerCase().includes(q) ||
        formatDateTime(c.created_at).toLowerCase().includes(q) ||
        formatDateTime(c.updated_at).toLowerCase().includes(q) ||
        (c.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
        (c.updated_by_login_name?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, search, workgroupIdParam])

  const tw = useTableWizard<Workgroup>({
    appPath: '/workgroups',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    if (workgroupIdParam && rows.length > 0) {
      const c = rows.find((x) => x.id === workgroupIdParam)
      setSelected(c ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((c) => c.id === cur.id) ? cur : null
    })
  }, [filteredRows, workgroupIdParam, rows])

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

  const loadWorkgroups = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<WorkgroupsListResponse>('/api/workgroups')
      setRows(data.workgroups ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('workgroups.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  const loadRefs = useCallback(async () => {
    try {
      const [empData, ccData] = await Promise.all([
        apiJson<{ employees: Employee[] }>('/api/employees'),
        apiJson<CostcentersListResponse>('/api/costcenters'),
      ])
      setEmployees(empData.employees ?? [])
      setCostcenters(ccData.costcenters ?? [])
    } catch {
      setEmployees([])
      setCostcenters([])
    }
  }, [])

  useEffect(() => {
    void loadWorkgroups()
    void loadRefs()
  }, [loadWorkgroups, loadRefs])

  const currencyOptionsForForm = useMemo(() => {
    return currencies.map((code) => ({
      label: code,
      value: code,
    }))
  }, [currencies])

  const costcenterOptionsForForm = useMemo(() => {
    const sid = editingId
      ? rows.find((r) => r.id === editingId)?.site_id
      : workingSiteId
    const opts: { label: string; value: string | null }[] = [
      { label: emDash, value: null },
    ]
    if (!sid) return opts
    for (const c of costcenters) {
      if (c.site_id === sid) {
        opts.push({
          label: `${c.key} — ${c.name}`,
          value: c.id,
        })
      }
    }
    return opts
  }, [costcenters, editingId, emDash, rows, workingSiteId])

  useEffect(() => {
    if (!membersOpen || !selected || membersLoading || assignmentDirty) return
    const { source, target } = buildMemberPools(
      employees,
      memberRows,
      selected.site_id,
    )
    setSourcePool(source)
    setTargetPool(target)
    targetPoolRef.current = target
  }, [
    membersOpen,
    selected,
    membersLoading,
    employees,
    memberRows,
    assignmentDirty,
  ])

  const persistMemberPoolChange = useCallback(
    async (
      added: PoolItem[],
      removed: PoolItem[],
    ): Promise<WgMemberRow[] | null> => {
      if (!selected || (added.length === 0 && removed.length === 0)) return null
      const mutationCount = added.length + removed.length
      const bulk = shouldShowBulkTableFeedback(memberRows.length, mutationCount)
      setBulkMembersOverlay(bulk)
      if (bulk) {
        toast.current?.show({
          severity: 'info',
          summary: t('common.bulk_table_rows_busy'),
          life: 8000,
        })
      }
      setMemberSaving(true)
      try {
        if (added.length > 0) {
          await apiJson<{ added: number; skipped: number }>(
            `/api/workgroups/${encodeURIComponent(selected.id)}/employees`,
            {
              method: 'POST',
              body: JSON.stringify({
                employee_ids: added.map((x) => x.id),
              }),
            },
          )
        }
        await Promise.all(
          removed.map((r) =>
            apiJson<undefined>(
              `/api/workgroups/${encodeURIComponent(selected.id)}/employees/${encodeURIComponent(r.id)}`,
              { method: 'DELETE' },
            ),
          ),
        )
        const data = await apiJson<WgEmployeesResponse>(
          `/api/workgroups/${encodeURIComponent(selected.id)}/employees`,
        )
        const list = data.employees ?? []
        setMemberRows(list)
        return list
      } catch (e) {
        if (e instanceof ApiError) {
          showError(e.message)
        } else {
          showError(t('workgroups.member_fail'))
        }
        try {
          const data = await apiJson<WgEmployeesResponse>(
            `/api/workgroups/${encodeURIComponent(selected.id)}/employees`,
          )
          const list = data.employees ?? []
          setMemberRows(list)
        } catch {
          /* ignore */
        }
        return null
      } finally {
        setMemberSaving(false)
        setBulkMembersOverlay(false)
      }
    },
    [selected, showError, t, memberRows],
  )

  const confirmMemberAssignment = useCallback(async () => {
    if (!selected) return
    const currentIds = new Set(targetPoolRef.current.map((x) => x.id))
    const base = baselineIdsRef.current
    const addedIds = [...currentIds].filter((id) => !base.has(id))
    const removedIds = [...base].filter((id) => !currentIds.has(id))
    if (addedIds.length === 0 && removedIds.length === 0) return

    const addedItems = targetPoolRef.current.filter((x) =>
      addedIds.includes(x.id),
    )
    const removedItems = removedIds.map((id) => ({
      id,
      key: '',
      name: '',
    }))

    const list = await persistMemberPoolChange(addedItems, removedItems)
    if (list) {
      baselineIdsRef.current = new Set(list.map((m) => m.employee_id))
      setAssignmentDirty(false)
      showSuccess(t('workgroups.members_saved'))
    }
  }, [persistMemberPoolChange, selected, showSuccess, t])

  const revertMemberAssignment = useCallback(() => {
    setAssignmentDirty(false)
  }, [])

  const tryCloseMembersDialog = useCallback(() => {
    if (assignmentDirty) {
      confirmDialog({
        header: t('workgroups.members_discard_header'),
        message: t('workgroups.members_discard_msg'),
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          setAssignmentDirty(false)
          setMembersOpen(false)
        },
      })
    } else {
      setMembersOpen(false)
    }
  }, [assignmentDirty, t])

  const onPickListChange = useCallback(
    (e: { source: PoolItem[]; target: PoolItem[] }) => {
      setSourcePool(e.source)
      setTargetPool(e.target)
      targetPoolRef.current = e.target
      setAssignmentDirty(true)
    },
    [],
  )

  const poolItemTemplate = useCallback((item: PoolItem) => {
    return (
      <div className="flex flex-column gap-0 py-1">
        <span className="text-sm font-medium">{item.key}</span>
        <span className="text-xs text-color-secondary">{item.name}</span>
      </div>
    )
  }, [])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setFormCostcenterId(null)
    setFormHourRate(null)
    setFormHourCurrency(null)
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function openEdit(row: Workgroup) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setFormCostcenterId(row.costcenter_id)
    setFormHourRate(parseWorkgroupHourRate(row.hour_rate))
    const cur = row.hour_rate_currency?.trim().toUpperCase() ?? null
    setFormHourCurrency(cur && cur.length === 3 ? cur : null)
    setDialogOpen(true)
  }

  async function saveWorkgroup() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    if (formHourRate !== null && !formHourCurrency) {
      showError(t('workgroups.err_hour_rate_currency'))
      return
    }
    if (
      formHourCurrency &&
      !currencies.map((c) => c.toUpperCase()).includes(formHourCurrency)
    ) {
      showError(t('workgroups.err_hour_rate_currency_invalid'))
      return
    }
    const body: Record<string, unknown> = { key, name }
    body.costcenter_id = formCostcenterId
    if (formHourRate === null) {
      body.hour_rate = null
      body.hour_rate_currency = null
    } else {
      body.hour_rate = formHourRate
      body.hour_rate_currency = formHourCurrency
    }

    setSaving(true)
    try {
      if (editingId) {
        const data = await apiJson<WorkgroupResponse>(
          `/api/workgroups/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setRows((prev) =>
          prev.map((c) => (c.id === editingId ? data.workgroup : c)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.workgroup : cur,
        )
        showSuccess(t('workgroups.updated'))
      } else {
        const data = await apiJson<WorkgroupResponse>('/api/workgroups', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          [...prev, data.workgroup].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        )
        showSuccess(t('workgroups.created'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('workgroups.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Workgroup) {
    confirmDialog({
      header: t('workgroups.delete_header'),
      message: t('workgroups.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteWorkgroup(row.id),
    })
  }

  async function deleteWorkgroup(id: string) {
    try {
      await apiJson<undefined>(`/api/workgroups/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((c) => c.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('workgroups.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('workgroups.delete_fail'))
      }
    }
  }

  async function openMembers() {
    if (!selected) return
    setMembersOpen(true)
    setMembersLoading(true)
    try {
      const data = await apiJson<WgEmployeesResponse>(
        `/api/workgroups/${encodeURIComponent(selected.id)}/employees`,
      )
      const rows = data.employees ?? []
      setMemberRows(rows)
      baselineIdsRef.current = new Set(rows.map((m) => m.employee_id))
      setAssignmentDirty(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('workgroups.member_fail'))
      }
      setMemberRows([])
      baselineIdsRef.current = new Set()
      setAssignmentDirty(false)
    } finally {
      setMembersLoading(false)
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceIdForMenu = workgroupIdParam || selected?.id || ''

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
            `/audit-log?resource_type=workgroup&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const cardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-users text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('workgroups.title')}</h1>
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
      <BulkOperationOverlay visible={bulkMembersOverlay && memberSaving} />
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
                label={t('workgroups.members')}
                icon="pi pi-user-plus"
                disabled={!selected}
                onClick={() => void openMembers()}
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
                  aria-label={t('workgroups.search_aria')}
                  className="w-full"
                />
              </IconField>
            </div>
          </div>
          <DataTable
            value={tw.prepareRows(filteredRows)}
            loading={loading || tw.tableBusy}
            dataKey="id"
            selection={selected}
            onSelectionChange={(e) => setSelected(e.value as Workgroup | null)}
            contextMenuSelection={selected ?? undefined}
            onContextMenuSelectionChange={(e) =>
              setSelected(e.value as Workgroup | null)
            }
            onContextMenu={(e) => {
              e.originalEvent.preventDefault()
              crudContextMenuRef.current?.show(e.originalEvent)
            }}
            selectionMode="single"
            metaKeySelection={false}
            onRowDoubleClick={(e) => {
              const row = e.data as Workgroup
              setSelected(row)
              openEdit(row)
            }}
            emptyMessage={
              search.trim()
                ? t('workgroups.empty_search')
                : t('workgroups.empty')
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
            ? t('workgroups.dialog_edit')
            : t('workgroups.dialog_new')
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
              onClick={() => void saveWorkgroup()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="wg-key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="wg-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="wg-name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="wg-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="wg-cc" className="text-sm font-medium">
              {t('workgroups.field_costcenter')}
            </label>
            <Dropdown
              id="wg-cc"
              value={formCostcenterId}
              options={costcenterOptionsForForm}
              onChange={(e) => setFormCostcenterId(e.value as string | null)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-2">
            <span className="text-sm font-medium" id="wg-hour-rate-group-label">
              {t('workgroups.col_hour_rate')}
            </span>
            <div
              className="flex gap-2 align-items-end flex-wrap"
              aria-labelledby="wg-hour-rate-group-label"
            >
              <div className="flex flex-column gap-2 flex-1" style={{ minWidth: '8rem' }}>
                <label htmlFor="wg-hour-rate" className="text-xs text-color-secondary">
                  {t('workgroups.field_hour_rate')}
                </label>
                <InputNumber
                  id="wg-hour-rate"
                  value={formHourRate}
                  onValueChange={(e) => {
                    const v = e.value
                    const next =
                      v === null || v === undefined || typeof v !== 'number'
                        ? null
                        : v
                    setFormHourRate(next)
                    if (next === null) {
                      setFormHourCurrency(null)
                    } else {
                      setFormHourCurrency((cur) => {
                        if (cur) return cur
                        const d = currencies[0]?.toUpperCase() ?? null
                        return d
                      })
                    }
                  }}
                  min={0}
                  minFractionDigits={0}
                  maxFractionDigits={4}
                  className="w-full"
                  inputClassName="w-full"
                  disabled={saving}
                />
              </div>
              <div className="flex flex-column gap-2 flex-1" style={{ minWidth: '8rem' }}>
                <label htmlFor="wg-hour-curr" className="text-xs text-color-secondary">
                  {t('workgroups.field_hour_rate_currency')}
                </label>
                <Dropdown
                  id="wg-hour-curr"
                  value={formHourCurrency}
                  options={currencyOptionsForForm}
                  onChange={(e) =>
                    setFormHourCurrency((e.value as string | null) ?? null)
                  }
                  className="w-full"
                  disabled={saving || formHourRate === null}
                  showClear={formHourRate !== null}
                />
              </div>
            </div>
          </div>
        </div>
      </AppCrudDialog>

      <AppCrudDialog
        title={t('workgroups.members_title')}
        visible={membersOpen}
        onHide={tryCloseMembersDialog}
        dismissableMask={!memberSaving}
        style={{ width: 'min(56rem, 98vw)' }}
        footer={
          <div className="flex justify-content-between align-items-center gap-2 flex-wrap w-full">
            <Button
              type="button"
              label={t('workgroups.members_revert')}
              icon="pi pi-undo"
              severity="secondary"
              outlined
              onClick={revertMemberAssignment}
              disabled={
                !assignmentDirty || memberSaving || membersLoading
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                label={t('common.cancel')}
                severity="secondary"
                outlined
                onClick={tryCloseMembersDialog}
                disabled={memberSaving}
              />
              <Button
                type="button"
                label={t('workgroups.members_apply')}
                icon="pi pi-check"
                onClick={() => void confirmMemberAssignment()}
                loading={memberSaving}
                disabled={
                  !assignmentDirty || memberSaving || membersLoading
                }
              />
            </div>
          </div>
        }
      >
        <p className="text-sm text-color-secondary mt-0 mb-3">
          {t('workgroups.pool_hint_confirm')}
        </p>
        {membersLoading ? (
          <div className="flex justify-content-center py-6">
            <ProgressSpinner style={{ width: '3rem', height: '3rem' }} />
          </div>
        ) : (
          <div
            className={
              memberSaving ? 'opacity-60 pointer-events-none select-none' : ''
            }
          >
            <PickList
              className="workgroup-members-picklist w-full"
              dataKey="id"
              source={sourcePool}
              target={targetPool}
              onChange={onPickListChange}
              itemTemplate={poolItemTemplate}
              sourceHeader={t('workgroups.pool_available')}
              targetHeader={t('workgroups.pool_assigned')}
              filter
              filterBy="key,name"
              sourceFilterPlaceholder={t('common.search_ellipsis')}
              targetFilterPlaceholder={t('common.search_ellipsis')}
              showSourceControls={false}
              showTargetControls={false}
              metaKeySelection={false}
              breakpoint="768px"
            />
          </div>
        )}
      </AppCrudDialog>
    </AppShell>
  )
}
