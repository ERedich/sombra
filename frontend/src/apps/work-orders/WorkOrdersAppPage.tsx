/**
 * CRUD for work orders — template-app layout + Sites-style API wiring.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { MenuItem } from 'primereact/menuitem'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Card } from 'primereact/card'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ContextMenu } from 'primereact/contextmenu'
import { DataTable } from 'primereact/datatable'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import {
  BulkDocumentsControl,
  EntityDocumentsCell,
  useDocumentsAssignments,
} from '../../components/documents'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { PickList } from 'primereact/picklist'
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import {
  mergeDisplayStatusColours,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'
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
import {
  buildWorkOrderWsUrl,
  type WorkOrderWsMessage,
} from '../../realtime/workOrderWs'
import { formatDateTime } from '../../utils/dateTime'
import { contrastTextOnHex } from '../../utils/contrastTextOnHex'
import { WorkAssignmentsIcons } from '../../components/work-instructions/WorkAssignmentsIcons'
import { WorkInstructionViewModal } from '../../components/work-instructions/WorkInstructionViewModal'
import type { ColumnRegistryEntry } from '../../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../../table-wizard'
import {
  SearchPanel,
  SearchPresetsDialog,
  applyColumnSearch,
  buildSearchableColumns,
  useTableSearch,
} from '../../table-search'
import type { Asset } from '../asset-management/assetTypes'
import type { WorkType } from '../work-types/WorkTypesAppPage'
import type { Category } from '../categories/CategoriesAppPage'
import type { Workgroup } from '../workgroups/WorkgroupsAppPage'
import { useWorkOrderMw } from '../../layout/WorkOrderMwProvider'
import type { WoMwEvent } from '../../layout/workOrderMwTypes'
import type { WorkOrder } from './workOrderTypes'
import { feedbackTabIndexForRow } from './workOrderFormShared'

export type { WorkOrder } from './workOrderTypes'

type WorkOrdersListResponse = { work_orders: WorkOrder[] }
type WorkOrderResponse = { work_order: WorkOrder }
type WorkOrderSubscriptionsBulkResponse = {
  ok: boolean
  action: 'subscribe' | 'unsubscribe'
  changed_count: number
  requested_count: number
}
type WorkOrderSubscriptionsListResponse = { work_order_ids: string[] }
type WorkTypesListResponse = { work_types: WorkType[] }
type CategoriesListResponse = { categories: Category[] }
type WorkgroupsListResponse = { workgroups: Workgroup[] }
type AssetsListResponse = { assets: Asset[] }
type EmployeesListResponse = {
  employees: { id: string; key: string; name: string }[]
}
type WorkOrderEmployeePoolItemDto = {
  employee_id: string
  employee_key: string
  employee_name: string
}
type WorkOrderEmployeePoolResponse = {
  available: WorkOrderEmployeePoolItemDto[]
  assigned: WorkOrderEmployeePoolItemDto[]
}
type WorkOrderEmployeeAssignResponse = {
  work_order: WorkOrder
  employees: WorkOrderEmployeePoolItemDto[]
}
type EmployeePickItem = {
  id: string
  key: string
  name: string
}

const WO_STATUS_I18N_KEYS: Record<string, string> = {
  open: 'wo.status_open',
  assigned: 'wo.status_assigned',
  started: 'wo.status_started',
  continued: 'wo.status_continued',
  on_hold: 'wo.status_on_hold',
  done: 'wo.status_done',
  closed: 'wo.status_closed',
}

function statusBody(
  row: WorkOrder,
  t: TFunction,
  mergedColours: Record<WorkOrderStatusColourKey, string>,
) {
  const k = WO_STATUS_I18N_KEYS[row.status]
  const label = k ? t(k) : row.status
  const sk = row.status as WorkOrderStatusColourKey
  const colour = mergedColours[sk] ?? mergedColours.open
  const fg = contrastTextOnHex(colour)
  return (
    <Tag
      value={label}
      rounded
      className="text-sm font-medium white-space-nowrap"
      style={{
        backgroundColor: colour,
        color: fg,
        border: `1px solid ${colour}`,
      }}
    />
  )
}

function sortedWorkOrders(rows: WorkOrder[]): WorkOrder[] {
  return [...rows].sort((a, b) => b.wo_key - a.wo_key)
}

const WO_PRIMARY_COLUMN_FLASH_FIELDS = new Set([
  'wo_key',
  'short_text',
  'asset_key',
  'asset_name',
])

/** First table column: WO key, name, asset — three lines only. */
function workOrderPrimaryColumnBody(row: WorkOrder, emDash: string): ReactNode {
  const name = row.short_text?.trim() ?? ''
  const ak = row.asset_key?.trim() ?? ''
  const an = row.asset_name?.trim() ?? ''
  const assetLine =
    ak && an ? `${ak} ${emDash} ${an}` : ak || an ? ak || an : emDash

  return (
    <div className="flex flex-column gap-0 wo-primary-col py-1">
      <span className="font-semibold">{row.wo_key}</span>
      <span className="white-space-normal break-word line-height-3">
        {name || emDash}
      </span>
      <span className="text-sm text-color-secondary white-space-normal break-word line-height-3">
        {assetLine}
      </span>
    </div>
  )
}

function poolDtoToItem(row: WorkOrderEmployeePoolItemDto): EmployeePickItem {
  return {
    id: row.employee_id,
    key: row.employee_key,
    name: row.employee_name,
  }
}

function WorkOrderStartCell(props: {
  row: WorkOrder
  currentEmployeeId: string | null
  employeeWorkgroupIds: string[]
  startRequiresAssignment: boolean
  /** When true, another assigned WO is already started/continued and policy disallows another start. */
  mswoBlocksStart: boolean
  onStart: (row: WorkOrder) => void
  onStop: (row: WorkOrder) => void
  t: TFunction
  emDash: string
}) {
  const {
    row,
    currentEmployeeId,
    employeeWorkgroupIds,
    startRequiresAssignment,
    mswoBlocksStart,
    onStart,
    onStop,
    t,
    emDash,
  } = props
  const assignedToWo =
    !!currentEmployeeId &&
    (row.assigned_employee_ids ?? []).includes(currentEmployeeId)
  const wgId = row.workgroup_id?.trim() ?? ''
  const inWorkgroup =
    wgId.length === 0 || employeeWorkgroupIds.includes(wgId)

  const canStop =
    startRequiresAssignment ? assignedToWo : !!currentEmployeeId
  const canStart =
    !!currentEmployeeId &&
    inWorkgroup &&
    (startRequiresAssignment ? assignedToWo : true) &&
    !mswoBlocksStart

  const playStatuses = new Set(['open', 'assigned', 'on_hold'])
  const stopStatuses = new Set(['started', 'continued'])
  const terminalStartStopStatuses = new Set(['done', 'closed'])

  function startDisabledTitle(): string {
    if (!currentEmployeeId) {
      return startRequiresAssignment
        ? t('wo.start_disabled_no_employee')
        : t('wo.start_disabled_no_employee_user_only')
    }
    if (!inWorkgroup) return t('wo.start_disabled_not_in_workgroup')
    if (startRequiresAssignment && !assignedToWo) {
      return t('wo.start_disabled_must_assign')
    }
    if (mswoBlocksStart) return t('wo.start_disabled_mswo')
    return t('wo.start_tooltip')
  }

  function stopDisabledTitle(): string {
    if (!currentEmployeeId) {
      return startRequiresAssignment
        ? t('wo.start_disabled_no_employee')
        : t('wo.start_disabled_no_employee_user_only')
    }
    if (startRequiresAssignment && !assignedToWo) {
      return t('wo.start_disabled_must_assign')
    }
    return t('wo.stop_tooltip')
  }

  if (playStatuses.has(row.status)) {
    const disabled = !canStart
    return (
      <Button
        type="button"
        icon="pi pi-play"
        rounded
        text
        severity="success"
        disabled={disabled}
        className={disabled ? 'opacity-40' : ''}
        title={disabled ? startDisabledTitle() : t('wo.start_tooltip')}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) onStart(row)
        }}
        aria-label={t('wo.start_tooltip')}
      />
    )
  }
  if (stopStatuses.has(row.status)) {
    const disabled = !canStop
    return (
      <Button
        type="button"
        icon="pi pi-stop"
        rounded
        text
        severity="danger"
        disabled={disabled}
        className={disabled ? 'opacity-40' : ''}
        title={disabled ? stopDisabledTitle() : t('wo.stop_tooltip')}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) onStop(row)
        }}
        aria-label={t('wo.stop_tooltip')}
      />
    )
  }
  if (terminalStartStopStatuses.has(row.status)) {
    return (
      <Button
        type="button"
        icon="pi pi-ban"
        rounded
        text
        severity="secondary"
        disabled
        className="opacity-40"
        title={t('wo.start_stop_disabled_terminal')}
        aria-label={t('wo.start_stop_disabled_terminal')}
      />
    )
  }
  return <span className="text-sm text-color-secondary">{emDash}</span>
}

const MONITORING_UPDATE_FLASH_MS = 2200
const MONITORING_CREATED_HIGHLIGHT_MS = 10_000
const MONITORING_DELETE_HOLD_MS = 10_000
const CURRENT_EMPLOYEE_FILTER_VALUE = '__CURRENT_EMPLOYEE__'
const CURRENT_EMPLOYEE_MISSING_SENTINEL = '__CURRENT_EMPLOYEE_MISSING__'
const EMPTY_EMPLOYEE_WORKGROUP_IDS: string[] = []

function workTypeColumnBody(
  row: WorkOrder,
  dash: string,
  workTypes: WorkType[],
) {
  const pmRow = row.work_plan_id
    ? workTypes.find((wt) => wt.site_id === row.site_id && wt.key === 'PM')
    : undefined
  const colour =
    pmRow && typeof pmRow.colour === 'string' && pmRow.colour.trim() !== ''
      ? pmRow.colour.trim()
      : typeof row.work_type_colour === 'string' &&
          row.work_type_colour.trim() !== ''
        ? row.work_type_colour.trim()
        : '#94a3b8'
  const label =
    pmRow?.key?.trim() ||
    row.work_type_key?.trim() ||
    row.work_type_name?.trim() ||
    dash
  const fg = contrastTextOnHex(colour)
  return (
    <Tag
      value={label}
      rounded
      title={colour}
      className="text-sm font-medium white-space-nowrap"
      style={{
        backgroundColor: colour,
        color: fg,
        border: `1px solid ${colour}`,
      }}
    />
  )
}

function siteColumnBody(row: WorkOrder, tr: TFunction) {
  const colour =
    typeof row.site_colour === 'string' && row.site_colour.trim() !== ''
      ? row.site_colour.trim()
      : '#94a3b8'
  const dash = tr('common.em_dash')
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

function rowMatchesGlobalSearch(w: WorkOrder, q: string, t: TFunction): boolean {
  return (
    String(w.wo_key).includes(q) ||
    w.short_text.toLowerCase().includes(q) ||
    w.asset_key.toLowerCase().includes(q) ||
    w.asset_name.toLowerCase().includes(q) ||
    (w.costcenter_key?.toLowerCase().includes(q) ?? false) ||
    (w.costcenter_name?.toLowerCase().includes(q) ?? false) ||
    w.status.toLowerCase().includes(q) ||
    (WO_STATUS_I18N_KEYS[w.status]
      ? t(WO_STATUS_I18N_KEYS[w.status]).toLowerCase().includes(q)
      : false) ||
    w.instruction_text.toLowerCase().includes(q) ||
    w.created_at.toLowerCase().includes(q) ||
    w.updated_at.toLowerCase().includes(q) ||
    formatDateTime(w.created_at).toLowerCase().includes(q) ||
    formatDateTime(w.updated_at).toLowerCase().includes(q) ||
    (w.plan_start?.toLowerCase().includes(q) ?? false) ||
    (w.plan_end?.toLowerCase().includes(q) ?? false) ||
    (w.work_plan_key?.toLowerCase().includes(q) ?? false) ||
    String(w.planned_duration ?? '').includes(q) ||
    (w.created_by_login_name?.toLowerCase().includes(q) ?? false) ||
    (w.updated_by_login_name?.toLowerCase().includes(q) ?? false) ||
    w.site_key.toLowerCase().includes(q) ||
    w.site_name.toLowerCase().includes(q) ||
    (w.work_type_key?.toLowerCase().includes(q) ?? false) ||
    (w.work_type_name?.toLowerCase().includes(q) ?? false) ||
    (w.category_key?.toLowerCase().includes(q) ?? false) ||
    (w.category_name?.toLowerCase().includes(q) ?? false) ||
    (w.workgroup_key?.toLowerCase().includes(q) ?? false) ||
    (w.workgroup_name?.toLowerCase().includes(q) ?? false)
  )
}

export type WorkOrdersPageMode = 'work-orders' | 'monitoring'

export function WorkOrdersPage({
  mode = 'work-orders',
}: {
  mode?: WorkOrdersPageMode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const workOrderIdParam = searchParams.get('workOrderId')?.trim() ?? ''

  const emDash = t('common.em_dash')

  const { openKira } = useKiraAssistant()
  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const {
    openCreateWorkOrderMw,
    openEditWorkOrderMw,
    subscribeWorkOrderMwEvents,
  } = useWorkOrderMw()
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [dummyCreating, setDummyCreating] = useState(false)
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([])
  const [employeesForFilter, setEmployeesForFilter] = useState<
    { id: string; key: string; name: string }[]
  >([])
  const [subscribedWorkOrderIds, setSubscribedWorkOrderIds] = useState<Set<string>>(
    new Set(),
  )
  const [selected, setSelected] = useState<WorkOrder | null>(null)
  const [recentlyChangedWorkOrderIds, setRecentlyChangedWorkOrderIds] = useState<
    Set<string>
  >(new Set())
  const [recentlyCreatedWorkOrderIds, setRecentlyCreatedWorkOrderIds] = useState<
    Set<string>
  >(new Set())
  const [recentlyDeletedWorkOrderIds, setRecentlyDeletedWorkOrderIds] = useState<
    Set<string>
  >(new Set())
  const [recentlyChangedFieldsByWorkOrderId, setRecentlyChangedFieldsByWorkOrderId] =
    useState<Record<string, Set<string>>>({})
  const [search, setSearch] = useState('')
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [searchPresetsOpen, setSearchPresetsOpen] = useState(false)
  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [holdDialogReason, setHoldDialogReason] = useState('')
  const [holdDialogRow, setHoldDialogRow] = useState<WorkOrder | null>(null)
  const [holdSubmitting, setHoldSubmitting] = useState(false)
  const [instructionViewOpen, setInstructionViewOpen] = useState(false)
  const [instructionViewWoId, setInstructionViewWoId] = useState<string | null>(
    null,
  )
  const [employeeAssignOpen, setEmployeeAssignOpen] = useState(false)
  const [employeeAssignLoading, setEmployeeAssignLoading] = useState(false)
  const [employeeAssignSaving, setEmployeeAssignSaving] = useState(false)
  const [employeeAssignDirty, setEmployeeAssignDirty] = useState(false)
  const [employeeAssignWoId, setEmployeeAssignWoId] = useState<string | null>(null)
  const [employeeSourcePool, setEmployeeSourcePool] = useState<EmployeePickItem[]>(
    [],
  )
  const [employeeTargetPool, setEmployeeTargetPool] = useState<EmployeePickItem[]>(
    [],
  )
  /** Dedupes React Strict Mode double `useEffect` when opening edit from `?openEdit=1`. */
  const openEditFromUrlKeyRef = useRef<string>('')
  const employeeTargetPoolRef = useRef<EmployeePickItem[]>([])
  const employeeInitialSourceRef = useRef<EmployeePickItem[]>([])
  const employeeInitialTargetRef = useRef<EmployeePickItem[]>([])
  const flashTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  )
  const fieldFlashTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const createHighlightTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const deleteHoldTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const postStartWorkOrderRef = useRef<(row: WorkOrder) => void>(() => {})
  const openFeedbackTabRef = useRef<(row: WorkOrder) => void>(() => {})

  const isMonitoring = mode === 'monitoring'
  const authUserSnapshot = getStoredUser()
  const currentEmployeeId = authUserSnapshot?.employee_id ?? null
  const employeeWorkgroupIds =
    authUserSnapshot?.employee_workgroup_ids ?? EMPTY_EMPLOYEE_WORKGROUP_IDS
  const [woStartRequiresAssignment, setWoStartRequiresAssignment] =
    useState(true)
  const [woAllowMultipleStarted, setWoAllowMultipleStarted] = useState(false)
  const [woStatusColourOverrides, setWoStatusColourOverrides] = useState<
    Partial<Record<WorkOrderStatusColourKey, string>>
  >({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<{
          wo: {
            start_requires_assignment: boolean
            allow_multiple_started_work_orders?: boolean
            work_order_status_colours?: Partial<
              Record<WorkOrderStatusColourKey, string>
            >
          }
        }>('/api/app-parameters')
        if (!cancelled) {
          setWoStartRequiresAssignment(
            data.wo?.start_requires_assignment !== false,
          )
          setWoAllowMultipleStarted(
            data.wo?.allow_multiple_started_work_orders === true,
          )
          const raw = data.wo?.work_order_status_colours
          setWoStatusColourOverrides(
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Partial<Record<WorkOrderStatusColourKey, string>>)
              : {},
          )
        }
      } catch {
        if (!cancelled) {
          setWoStartRequiresAssignment(true)
          setWoAllowMultipleStarted(false)
          setWoStatusColourOverrides({})
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const woStatusMergedColours = useMemo(
    () => mergeDisplayStatusColours(woStatusColourOverrides),
    [woStatusColourOverrides],
  )

  const flashMonitoringWorkOrderRow = useCallback(
    (id: string, durationMs = MONITORING_UPDATE_FLASH_MS) => {
      if (!isMonitoring || !id) return
      setRecentlyChangedWorkOrderIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      const existing = flashTimeoutsRef.current[id]
      if (existing !== undefined) window.clearTimeout(existing)
      flashTimeoutsRef.current[id] = window.setTimeout(() => {
        setRecentlyChangedWorkOrderIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        delete flashTimeoutsRef.current[id]
      }, durationMs)
    },
    [isMonitoring],
  )

  const markMonitoringCreatedRow = useCallback(
    (id: string) => {
      if (!isMonitoring || !id) return
      setRecentlyCreatedWorkOrderIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      const existing = createHighlightTimeoutsRef.current[id]
      if (existing !== undefined) window.clearTimeout(existing)
      createHighlightTimeoutsRef.current[id] = window.setTimeout(() => {
        setRecentlyCreatedWorkOrderIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        delete createHighlightTimeoutsRef.current[id]
      }, MONITORING_CREATED_HIGHLIGHT_MS)
    },
    [isMonitoring],
  )

  const flashMonitoringChangedFields = useCallback(
    (before: WorkOrder | null | undefined, after: WorkOrder | null | undefined) => {
      if (!isMonitoring || !before || !after?.id) return
      const changedFields = new Set<string>()
      const prev = before as unknown as Record<string, unknown>
      const next = after as unknown as Record<string, unknown>
      for (const [field, value] of Object.entries(next)) {
        if (prev[field] !== value) changedFields.add(field)
      }
      if (changedFields.size === 0) return
      const id = after.id
      setRecentlyChangedFieldsByWorkOrderId((cur) => ({
        ...cur,
        [id]: changedFields,
      }))
      const existing = fieldFlashTimeoutsRef.current[id]
      if (existing !== undefined) window.clearTimeout(existing)
      fieldFlashTimeoutsRef.current[id] = window.setTimeout(() => {
        setRecentlyChangedFieldsByWorkOrderId((cur) => {
          if (!(id in cur)) return cur
          const { [id]: _removed, ...rest } = cur
          return rest
        })
        delete fieldFlashTimeoutsRef.current[id]
      }, MONITORING_UPDATE_FLASH_MS)
    },
    [isMonitoring],
  )

  const markMonitoringDeletedRow = useCallback(
    (id: string) => {
      if (!isMonitoring || !id) return
      setRecentlyDeletedWorkOrderIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      setSelected((cur) => (cur?.id === id ? null : cur))

      const existing = deleteHoldTimeoutsRef.current[id]
      if (existing !== undefined) window.clearTimeout(existing)
      deleteHoldTimeoutsRef.current[id] = window.setTimeout(() => {
        setRows((prev) => prev.filter((w) => w.id !== id))
        setRecentlyDeletedWorkOrderIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setRecentlyChangedWorkOrderIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setRecentlyCreatedWorkOrderIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setRecentlyChangedFieldsByWorkOrderId((cur) => {
          if (!(id in cur)) return cur
          const { [id]: _removed, ...rest } = cur
          return rest
        })
        delete deleteHoldTimeoutsRef.current[id]
      }, MONITORING_DELETE_HOLD_MS)
    },
    [isMonitoring],
  )

  const cardSubTitle = useMemo(() => {
    if (isMonitoring) {
      return t('monitoring.subtitle')
    }
    if (workOrderIdParam) {
      return t('work_orders.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('work_orders.subtitle_admin_short')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('work_orders.subtitle_no_sites')
    }
    return t('work_orders.subtitle_admin')
  }, [isMonitoring, workOrderIdParam, t])

  const allWorkOrderIds = useMemo(() => rows.map((r) => r.id), [rows])
  const workOrderLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.id, String(r.wo_key))
    return map
  }, [rows])
  const docsAssignments = useDocumentsAssignments(
    'work_order',
    allWorkOrderIds,
    { toastRef: toast },
  )
  const { counts: documentCounts, openSingle: openDocumentsForEntity } =
    docsAssignments

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<WorkOrder>[] => {
    const admin = getStoredUser()?.role === 'admin'
    const statusOptions = Object.entries(WO_STATUS_I18N_KEYS).map(([value, key]) => ({
      value,
      label: t(key),
    }))
    const workTypeOptions = workTypes
      .map((wt) => ({
        value: wt.key,
        label: `${wt.key} ${emDash} ${wt.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    const categoryOptions = categories
      .map((category) => ({
        value: category.key,
        label: `${category.key} ${emDash} ${category.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    const workgroupOptions = workgroups
      .map((group) => ({
        value: group.key,
        label: `${group.key} ${emDash} ${group.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    const employeeOptions = [
      {
        value: CURRENT_EMPLOYEE_FILTER_VALUE,
        label: t('monitoring.employee_current_option'),
      },
      ...employeesForFilter
        .map((employee) => ({
          value: employee.id,
          label: `${employee.key} ${emDash} ${employee.name}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
    const createdByOptions = [...new Set(rows.map((r) => r.created_by_login_name).filter((v): v is string => !!v))]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
    const updatedByOptions = [...new Set(rows.map((r) => r.updated_by_login_name).filter((v): v is string => !!v))]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
    const defs: ColumnRegistryEntry<WorkOrder>[] = [
      {
        field: 'wo_key',
        headerKey: isMonitoring ? 'common.col_key' : 'wo.col_wo_primary',
        sortable: true,
        body: (row) => (isMonitoring ? row.wo_key : workOrderPrimaryColumnBody(row, emDash)),
        search: {
          getSearchValue: (row) =>
            isMonitoring
              ? String(row.wo_key)
              : [
                  row.wo_key,
                  row.short_text,
                  row.asset_key,
                  row.asset_name,
                ]
                  .filter((v) => v != null && String(v).trim() !== '')
                  .join(' '),
        },
      },
      {
        field: 'wo_start',
        headerKey: 'wo.col_start',
        sortable: false,
        body: (row) => {
          const mswoBlocks =
            !woAllowMultipleStarted &&
            !!currentEmployeeId &&
            rows.some(
              (w) =>
                w.id !== row.id &&
                (w.status === 'started' || w.status === 'continued') &&
                (w.assigned_employee_ids ?? []).includes(currentEmployeeId),
            )
          return (
            <WorkOrderStartCell
              row={row}
              currentEmployeeId={currentEmployeeId}
              employeeWorkgroupIds={employeeWorkgroupIds}
              startRequiresAssignment={woStartRequiresAssignment}
              mswoBlocksStart={mswoBlocks}
              onStart={(r) => postStartWorkOrderRef.current(r)}
              onStop={(r) => openFeedbackTabRef.current(r)}
              t={t}
              emDash={emDash}
            />
          )
        },
      },
    ]
    if (admin) {
      defs.push({
        field: 'site_key',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        body: (row) => siteColumnBody(row, t),
        search: { getSearchValue: (row) => `${row.site_key} ${row.site_name}` },
      })
    }
    defs.push(
      {
        field: 'costcenter_key',
        headerKey: 'wo.col_cost_center',
        sortable: true,
        body: (row) => {
          const ck = row.costcenter_key ?? ''
          const cn = row.costcenter_name ?? ''
          if (!ck && !cn) return emDash
          return `${ck} ${emDash} ${cn}`.trim()
        },
        search: {
          getSearchValue: (row) =>
            `${row.costcenter_key ?? ''} ${row.costcenter_name ?? ''}`.trim(),
        },
      },
      {
        field: 'workgroup_key',
        headerKey: 'wo.col_workgroup',
        sortable: true,
        sortField: 'workgroup_key',
        body: (row) => {
          const k = row.workgroup_key?.trim() ?? ''
          const n = row.workgroup_name?.trim() ?? ''
          if (!k && !n) return emDash
          if (k && n) return `${k} ${emDash} ${n}`
          return k || n
        },
        search: {
          inputType: 'multiselect',
          options: workgroupOptions,
          getSearchValue: (row) => row.workgroup_key ?? '',
        },
      },
      {
        field: 'assigned_employee_ids',
        headerKey: 'monitoring.col_employee',
        sortable: false,
        defaultVisible: false,
        body: () => emDash,
        search: {
          inputType: 'multiselect',
          options: employeeOptions,
          getSearchValue: (row) => row.assigned_employee_ids ?? [],
        },
      },
      {
        field: 'work_plan_key',
        headerKey: 'wo.field_work_plan',
        sortable: true,
        body: (row) => row.work_plan_key ?? emDash,
        search: { getSearchValue: (row) => row.work_plan_key ?? '' },
      },
      {
        field: 'work_type_key',
        headerKey: 'wo.col_work_type',
        sortable: true,
        sortField: 'work_type_key',
        body: (row) => workTypeColumnBody(row, emDash, workTypes),
        search: {
          inputType: 'multiselect',
          options: workTypeOptions,
          getSearchValue: (row) =>
            row.work_type_key ?? '',
        },
      },
      {
        field: 'category_key',
        headerKey: 'wo.col_category',
        sortable: true,
        sortField: 'category_key',
        body: (row) => {
          const k = row.category_key?.trim() ?? ''
          const n = row.category_name?.trim() ?? ''
          if (!k && !n) return emDash
          if (k && n) return `${k} ${emDash} ${n}`
          return k || n
        },
        search: {
          inputType: 'multiselect',
          options: categoryOptions,
          getSearchValue: (row) =>
            row.category_key ?? '',
        },
      },
      {
        field: 'work_instruction_count',
        headerKey: 'wo.col_assignments',
        sortable: true,
        sortField: 'work_instruction_count',
        body: (row) => (
          <WorkAssignmentsIcons
            row={{
              ...row,
              has_notification_assignment: subscribedWorkOrderIds.has(row.id),
            }}
            t={t}
            showNotificationIcon
            onAssignmentClick={(kind) => {
              if (kind === 'employee') {
                void openEmployeeAssignment(row)
                return
              }
              if (kind === 'instructions') {
                setInstructionViewWoId(row.id)
                setInstructionViewOpen(true)
                return
              }
              if (kind === 'notification') {
                toggleRowSubscription(row)
              }
            }}
          />
        ),
        search: {
          inputType: 'number',
          getSearchValue: (row) => row.work_instruction_count ?? null,
        },
      },
      {
        field: 'document_count',
        headerKey: 'documents.col_assignments',
        sortable: true,
        sortField: 'document_count',
        body: (row) => (
          <EntityDocumentsCell
            entityType="work_order"
            entityId={row.id}
            count={documentCounts.get(row.id) ?? 0}
            onOpenDialog={openDocumentsForEntity}
          />
        ),
        search: {
          inputType: 'number',
          getSearchValue: (row) => documentCounts.get(row.id) ?? 0,
        },
      },
      {
        field: 'plan_start',
        headerKey: 'wo.col_plan_start',
        sortable: true,
        type: 'datetime',
        body: (row) =>
          row.plan_start ? formatDateTime(row.plan_start) : emDash,
        search: {
          inputType: 'datetime',
          getSearchValue: (row) => row.plan_start,
        },
      },
      {
        field: 'plan_end',
        headerKey: 'wo.col_plan_end',
        sortable: true,
        type: 'datetime',
        body: (row) => (row.plan_end ? formatDateTime(row.plan_end) : emDash),
        search: {
          inputType: 'datetime',
          getSearchValue: (row) => row.plan_end,
        },
      },
      {
        field: 'planned_duration',
        headerKey: 'wo.field_planned_duration_hours',
        sortable: true,
        body: (row) => Number(row.planned_duration ?? '0'),
        search: {
          inputType: 'number',
          getSearchValue: (row) => Number(row.planned_duration ?? '0'),
        },
      },
      {
        field: 'status',
        headerKey: 'wo.col_status',
        sortable: true,
        body: (row) => statusBody(row, t, woStatusMergedColours),
        search: {
          inputType: 'multiselect',
          options: statusOptions,
          getSearchValue: (row) =>
            row.status,
        },
      },
      {
        field: 'created_at',
        headerKey: 'common.col_created_at',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.created_at),
        search: {
          inputType: 'datetime',
          getSearchValue: (row) => row.created_at,
        },
      },
      {
        field: 'created_by_login_name',
        headerKey: 'common.col_created_by',
        sortable: true,
        body: (row) => row.created_by_login_name ?? emDash,
        search: {
          inputType: 'multiselect',
          options: createdByOptions,
          getSearchValue: (row) => row.created_by_login_name ?? '',
        },
      },
      {
        field: 'updated_at',
        headerKey: 'common.col_updated_at',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.updated_at),
        search: {
          inputType: 'datetime',
          getSearchValue: (row) => row.updated_at,
        },
      },
      {
        field: 'updated_by_login_name',
        headerKey: 'common.col_updated_by',
        sortable: true,
        body: (row) => row.updated_by_login_name ?? emDash,
        search: {
          inputType: 'multiselect',
          options: updatedByOptions,
          getSearchValue: (row) => row.updated_by_login_name ?? '',
        },
      },
    )
    if (!isMonitoring) return defs
    return defs.map((def) => ({
      ...def,
      cellClassName: (row: WorkOrder) => {
        const changed = recentlyChangedFieldsByWorkOrderId[row.id]
        if (!changed) return undefined
        if (def.field === 'wo_key') {
          for (const f of WO_PRIMARY_COLUMN_FLASH_FIELDS) {
            if (changed.has(f)) return 'monitoring-wo-flash-cell'
          }
          return undefined
        }
        return changed.has(def.field) ? 'monitoring-wo-flash-cell' : undefined
      },
    }))
  }, [
    t,
    emDash,
    workTypes,
    categories,
    workgroups,
    rows,
    subscribedWorkOrderIds,
    employeesForFilter,
    isMonitoring,
    recentlyChangedFieldsByWorkOrderId,
    currentEmployeeId,
    employeeWorkgroupIds,
    woStartRequiresAssignment,
    woAllowMultipleStarted,
    woStatusMergedColours,
    documentCounts,
    openDocumentsForEntity,
  ])

  const searchableColumns = useMemo(
    () => buildSearchableColumns(tableColumnDefs),
    [tableColumnDefs],
  )

  const tableSearch = useTableSearch<WorkOrder>({
    appPath: isMonitoring ? '/monitoring' : '/work-orders',
    searchableColumns,
    enabled: isMonitoring,
  })

  const resolvedMonitoringSearch = useMemo(() => {
    if (!isMonitoring) return tableSearch.applied
    const criterion = tableSearch.applied.criteria.assigned_employee_ids
    const selectedValues = criterion?.selectedValues ?? []
    if (!selectedValues.includes(CURRENT_EMPLOYEE_FILTER_VALUE)) {
      return tableSearch.applied
    }
    const resolvedValues = selectedValues.map((value) => {
      if (value !== CURRENT_EMPLOYEE_FILTER_VALUE) return value
      return currentEmployeeId ?? CURRENT_EMPLOYEE_MISSING_SENTINEL
    })
    return {
      ...tableSearch.applied,
      criteria: {
        ...tableSearch.applied.criteria,
        assigned_employee_ids: {
          ...(criterion ?? { from: '', to: '', selectedValues: [] }),
          selectedValues: [...new Set(resolvedValues)],
        },
      },
    }
  }, [currentEmployeeId, isMonitoring, tableSearch.applied])

  const searchPresetQuickOptions = useMemo(
    () =>
      tableSearch.presets
        .map((preset) => ({
          value: preset.id,
          label:
            preset.owner_login_name && preset.owner_login_name.trim() !== ''
              ? `${preset.preset_key} ${emDash} ${preset.owner_login_name}`
              : preset.preset_key,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [tableSearch.presets, emDash],
  )

  const filteredRows = useMemo(() => {
    let list = rows
    if (workOrderIdParam) {
      list = list.filter((w) => w.id === workOrderIdParam)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((w) => rowMatchesGlobalSearch(w, q, t))
    }
    if (isMonitoring) {
      list = applyColumnSearch(list, resolvedMonitoringSearch, searchableColumns)
    }
    return list
  }, [
    isMonitoring,
    rows,
    search,
    searchableColumns,
    resolvedMonitoringSearch,
    t,
    workOrderIdParam,
  ])

  const workOrdersDefaultMultiSortMeta = useMemo(
    () => [{ field: 'wo_key', order: -1 as const }],
    [],
  )

  const tw = useTableWizard<WorkOrder>({
    appPath: isMonitoring ? '/monitoring' : '/work-orders',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
    defaultMultiSortMeta: workOrdersDefaultMultiSortMeta,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  const twLp = tw.tableLayoutProps as { className?: string } & Record<
    string,
    unknown
  >
  const twTableClass = twLp.className
  const tableLayoutRest = { ...twLp, className: undefined }
  const tableSearchToastError = tableSearch.toastError
  const clearTableSearchToastError = tableSearch.clearToastError

  useEffect(() => {
    if (workOrderIdParam && rows.length > 0) {
      const w = rows.find((x) => x.id === workOrderIdParam)
      setSelected(w ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((w) => w.id === cur.id) ? cur : null
    })
  }, [filteredRows, workOrderIdParam, rows])

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

  const postStartWo = useCallback(
    async (row: WorkOrder) => {
      try {
        const data = await apiJson<WorkOrderResponse>(
          `/api/work-orders/${encodeURIComponent(row.id)}/actions/start`,
          { method: 'POST', body: JSON.stringify({}) },
        )
        setRows((prev) =>
          sortedWorkOrders(
            prev.map((w) => (w.id === row.id ? data.work_order : w)),
          ),
        )
        setSelected((cur) =>
          cur?.id === row.id ? data.work_order : cur,
        )
        flashMonitoringWorkOrderRow(data.work_order.id)
        flashMonitoringChangedFields(row, data.work_order)
        showSuccess(t('wo.updated'))
      } catch (e) {
        if (e instanceof ApiError) {
          showError(e.message)
        } else {
          showError(t('wo.save_fail'))
        }
      }
    },
    [
      flashMonitoringChangedFields,
      flashMonitoringWorkOrderRow,
      showError,
      showSuccess,
      t,
    ],
  )

  postStartWorkOrderRef.current = (r) => {
    void postStartWo(r)
  }

  useEffect(() => {
    if (!tableSearchToastError) return
    showError(t(tableSearchToastError))
    clearTableSearchToastError()
  }, [clearTableSearchToastError, showError, t, tableSearchToastError])

  const loadWorkOrders = useCallback(
    async (opts?: { silent?: boolean }): Promise<WorkOrder[]> => {
      const silent = opts?.silent === true
      if (!silent) setLoading(true)
      try {
        const data = await apiJson<WorkOrdersListResponse>('/api/work-orders')
        const list = data.work_orders ?? []
        const ordered = sortedWorkOrders(list)
        setRows(ordered)
        return ordered
      } catch (e) {
        if (e instanceof ApiError) {
          showError(e.message)
        } else {
          showError(t('wo.load_fail'))
        }
        setRows([])
        return []
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [showError, t],
  )

  useEffect(() => {
    void loadWorkOrders()
  }, [loadWorkOrders])

  const loadSubscriptions = useCallback(async () => {
    try {
      const data = await apiJson<WorkOrderSubscriptionsListResponse>(
        '/api/work-orders/subscriptions',
      )
      setSubscribedWorkOrderIds(new Set(data.work_order_ids ?? []))
    } catch {
      setSubscribedWorkOrderIds(new Set())
    }
  }, [])

  useEffect(() => {
    void loadSubscriptions()
  }, [loadSubscriptions])

  const loadWorkTypes = useCallback(async () => {
    try {
      const data = await apiJson<WorkTypesListResponse>('/api/work-types')
      setWorkTypes(data.work_types ?? [])
    } catch {
      setWorkTypes([])
    }
  }, [])

  useEffect(() => {
    void loadWorkTypes()
  }, [loadWorkTypes])

  const loadCategories = useCallback(async () => {
    try {
      const data = await apiJson<CategoriesListResponse>('/api/categories')
      setCategories(data.categories ?? [])
    } catch {
      setCategories([])
    }
  }, [])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const loadWorkgroups = useCallback(async () => {
    try {
      const data = await apiJson<WorkgroupsListResponse>('/api/workgroups')
      setWorkgroups(data.workgroups ?? [])
    } catch {
      setWorkgroups([])
    }
  }, [])

  useEffect(() => {
    void loadWorkgroups()
  }, [loadWorkgroups])

  const loadEmployeesForFilter = useCallback(async () => {
    try {
      const data = await apiJson<EmployeesListResponse>('/api/employees')
      setEmployeesForFilter(data.employees ?? [])
    } catch {
      setEmployeesForFilter([])
    }
  }, [])

  useEffect(() => {
    void loadEmployeesForFilter()
  }, [loadEmployeesForFilter])

  useEffect(() => {
    let ws: WebSocket | null = null
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const connect = () => {
      const url = buildWorkOrderWsUrl()
      if (!url) return
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      ws.onopen = () => {
        attempt = 0
      }
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WorkOrderWsMessage
          if (data.type === 'work_order_created' && data.work_order?.id) {
            const wo = data.work_order
            setRows((prev) => {
              const map = new Map(prev.map((w) => [w.id, w]))
              map.set(wo.id, wo)
              return sortedWorkOrders([...map.values()])
            })
            markMonitoringCreatedRow(wo.id)
            return
          }
          if (isMonitoring && data.type === 'work_order_updated' && data.work_order?.id) {
            const wo = data.work_order
            let previousRow: WorkOrder | undefined
            setRows((prev) => {
              previousRow = prev.find((w) => w.id === wo.id)
              const map = new Map(prev.map((w) => [w.id, w]))
              map.set(wo.id, wo)
              return sortedWorkOrders([...map.values()])
            })
            setSelected((cur) => (cur?.id === wo.id ? wo : cur))
            flashMonitoringWorkOrderRow(wo.id)
            flashMonitoringChangedFields(previousRow, wo)
            return
          }
          if (isMonitoring && data.type === 'work_order_deleted') {
            const deletedId = data.work_order_id?.trim()
            if (!deletedId) return
            markMonitoringDeletedRow(deletedId)
          }
        } catch {
          /* ignore malformed */
        }
      }
      ws.onerror = () => {
        ws?.close()
      }
      ws.onclose = () => {
        if (cancelled) return
        scheduleReconnect()
      }
    }

    function scheduleReconnect() {
      if (cancelled) return
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      const delay = Math.min(30_000, 1000 * 2 ** attempt)
      attempt += 1
      reconnectTimer = window.setTimeout(() => {
        connect()
      }, delay)
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [
    flashMonitoringChangedFields,
    flashMonitoringWorkOrderRow,
    isMonitoring,
    markMonitoringCreatedRow,
    markMonitoringDeletedRow,
  ])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(flashTimeoutsRef.current)) {
        window.clearTimeout(timer)
      }
      flashTimeoutsRef.current = {}
      for (const timer of Object.values(fieldFlashTimeoutsRef.current)) {
        window.clearTimeout(timer)
      }
      fieldFlashTimeoutsRef.current = {}
      for (const timer of Object.values(createHighlightTimeoutsRef.current)) {
        window.clearTimeout(timer)
      }
      createHighlightTimeoutsRef.current = {}
      for (const timer of Object.values(deleteHoldTimeoutsRef.current)) {
        window.clearTimeout(timer)
      }
      deleteHoldTimeoutsRef.current = {}
    }
  }, [])

  const workingSiteId = useMemo(
    () => getStoredUser()?.working_site_id ?? null,
    [],
  )
  const workTypesForSite = useMemo(() => {
    if (!workingSiteId) return []
    return workTypes.filter((wt) => wt.site_id === workingSiteId)
  }, [workTypes, workingSiteId])
  const categoriesForSite = useMemo(() => {
    if (!workingSiteId) return []
    return categories.filter((c) => c.site_id === workingSiteId)
  }, [categories, workingSiteId])
  const workgroupsForSite = useMemo(() => {
    if (!workingSiteId) return []
    return workgroups.filter((wg) => wg.site_id === workingSiteId)
  }, [workgroups, workingSiteId])

  const handleMwEvent = useCallback(
    (ev: WoMwEvent) => {
      if (ev.type === 'merged_row') {
        setRows((prev) =>
          sortedWorkOrders(
            prev.map((w) => (w.id === ev.workOrder.id ? ev.workOrder : w)),
          ),
        )
        setSelected((cur) =>
          cur?.id === ev.workOrder.id ? ev.workOrder : cur,
        )
        flashMonitoringWorkOrderRow(ev.workOrder.id)
        flashMonitoringChangedFields(ev.beforeRow ?? null, ev.workOrder)
      } else if (ev.type === 'created_row') {
        setRows((prev) => {
          const map = new Map(prev.map((w) => [w.id, w]))
          map.set(ev.workOrder.id, ev.workOrder)
          return sortedWorkOrders([...map.values()])
        })
        markMonitoringCreatedRow(ev.workOrder.id)
        setSelected(ev.workOrder)
      } else if (ev.type === 'silent_list_refresh') {
        void loadWorkOrders({ silent: true })
      }
    },
    [
      flashMonitoringChangedFields,
      flashMonitoringWorkOrderRow,
      loadWorkOrders,
      markMonitoringCreatedRow,
    ],
  )

  useEffect(
    () => subscribeWorkOrderMwEvents(handleMwEvent),
    [subscribeWorkOrderMwEvents, handleMwEvent],
  )

  function openCreate() {
    openCreateWorkOrderMw()
  }

  useRegisterCreateShortcut(openCreate)

  const openEditRef = useRef(openEditWorkOrderMw)
  openEditRef.current = openEditWorkOrderMw

  useEffect(() => {
    if (searchParams.get('openEdit') !== '1') {
      openEditFromUrlKeyRef.current = ''
      return
    }
    const woId = workOrderIdParam
    if (!woId || loading || rows.length === 0) return
    const dedupeKey = woId + ':openEdit'
    if (openEditFromUrlKeyRef.current === dedupeKey) return
    const w = rows.find((x) => x.id === woId)
    const next = new URLSearchParams(searchParams)
    next.delete('openEdit')
    setSearchParams(next, { replace: true })
    openEditFromUrlKeyRef.current = dedupeKey
    if (w) void openEditRef.current(w)
  }, [workOrderIdParam, searchParams, rows, loading, setSearchParams])

  openFeedbackTabRef.current = (row) => {
    void openEditWorkOrderMw(row, feedbackTabIndexForRow(row))
  }

  async function createDummyWorkOrder() {
    const currentSiteId = getStoredUser()?.working_site_id ?? null
    if (!currentSiteId) {
      showError('No working site selected.')
      return
    }

    const workTypeId =
      workTypesForSite.find((wt) => wt.key === 'CM')?.id ??
      workTypesForSite[0]?.id ??
      null
    if (!workTypeId) {
      showError('No work type found for current site.')
      return
    }

    const workgroupId =
      workgroupsForSite.find((wg) => wg.key === '_DEFAULT')?.id ??
      workgroupsForSite[0]?.id ??
      null
    if (!workgroupId) {
      showError('No workgroup found for current site.')
      return
    }

    setDummyCreating(true)
    try {
      const assetsData = await apiJson<AssetsListResponse>('/api/assets')
      const assetsForSite = (assetsData.assets ?? []).filter(
        (asset) => asset.site_id === currentSiteId,
      )
      const pickedAssetForDummy =
        assetsForSite.find((asset) => asset.asset_type === 'maintenance_object') ??
        assetsForSite[0]
      if (!pickedAssetForDummy) {
        showError('No asset found for current site.')
        return
      }

      const now = new Date()
      const ts = now.toISOString().replace('T', ' ').slice(0, 16)
      const body: Record<string, unknown> = {
        short_text: `Dummy WO ${ts}`.slice(0, 200),
        instruction_text: 'Dummy work order created from maintenance.',
        asset_id: pickedAssetForDummy.id,
        work_type_id: workTypeId,
        workgroup_id: workgroupId,
        category_id: categoriesForSite[0]?.id ?? null,
        plan_start: now.toISOString(),
        planned_duration: 1,
      }

      const data = await apiJson<WorkOrderResponse>('/api/work-orders', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await loadWorkOrders()
      setSelected(data.work_order)
      showSuccess('Dummy work order created.')
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.save_fail'))
      }
    } finally {
      setDummyCreating(false)
    }
  }

  function confirmDelete(row: WorkOrder) {
    confirmDialog({
      header: t('wo.delete_header'),
      message: t('wo.delete_msg', {
        key: String(row.wo_key),
        name: row.short_text,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      dismissableMask: true,
      accept: () => void deleteWorkOrder(row.id),
    })
  }

  async function deleteWorkOrder(id: string) {
    try {
      await apiJson<undefined>(`/api/work-orders/${id}`, { method: 'DELETE' })
      if (isMonitoring) {
        markMonitoringDeletedRow(id)
      } else {
        setRows((prev) => prev.filter((w) => w.id !== id))
        setSelected((cur) => (cur?.id === id ? null : cur))
      }
      showSuccess(t('wo.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.delete_fail'))
      }
    }
  }

  const employeePoolItemTemplate = useCallback((item: EmployeePickItem) => {
    return (
      <div className="flex flex-column gap-0 py-1">
        <span className="text-sm font-medium">{item.key}</span>
        <span className="text-xs text-color-secondary">{item.name}</span>
      </div>
    )
  }, [])

  function closeEmployeeAssignmentDialog() {
    if (employeeAssignSaving) return
    setEmployeeAssignOpen(false)
    setEmployeeAssignWoId(null)
    setEmployeeAssignDirty(false)
    setEmployeeAssignLoading(false)
    setEmployeeSourcePool([])
    setEmployeeTargetPool([])
    employeeTargetPoolRef.current = []
    employeeInitialSourceRef.current = []
    employeeInitialTargetRef.current = []
  }

  async function openEmployeeAssignment(row: WorkOrder) {
    setSelected(row)
    setEmployeeAssignWoId(row.id)
    setEmployeeAssignOpen(true)
    setEmployeeAssignLoading(true)
    setEmployeeAssignDirty(false)
    try {
      const data = await apiJson<WorkOrderEmployeePoolResponse>(
        `/api/work-orders/${encodeURIComponent(row.id)}/employees/pool`,
      )
      const source = (data.available ?? []).map(poolDtoToItem)
      const target = (data.assigned ?? []).map(poolDtoToItem)
      setEmployeeSourcePool(source)
      setEmployeeTargetPool(target)
      employeeTargetPoolRef.current = target
      employeeInitialSourceRef.current = source
      employeeInitialTargetRef.current = target
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.assignment_load_fail'))
      }
      closeEmployeeAssignmentDialog()
    } finally {
      setEmployeeAssignLoading(false)
    }
  }

  const onEmployeePickListChange = useCallback(
    (e: { source: EmployeePickItem[]; target: EmployeePickItem[] }) => {
      setEmployeeSourcePool(e.source)
      setEmployeeTargetPool(e.target)
      employeeTargetPoolRef.current = e.target
      setEmployeeAssignDirty(true)
    },
    [],
  )

  function revertEmployeeAssignment() {
    const source = employeeInitialSourceRef.current
    const target = employeeInitialTargetRef.current
    setEmployeeSourcePool(source)
    setEmployeeTargetPool(target)
    employeeTargetPoolRef.current = target
    setEmployeeAssignDirty(false)
  }

  async function saveEmployeeAssignment() {
    if (!employeeAssignWoId) return
    setEmployeeAssignSaving(true)
    try {
      const before = rows.find((w) => w.id === employeeAssignWoId) ?? null
      const data = await apiJson<WorkOrderEmployeeAssignResponse>(
        `/api/work-orders/${encodeURIComponent(employeeAssignWoId)}/employees`,
        {
          method: 'PUT',
          body: JSON.stringify({
            employee_ids: employeeTargetPoolRef.current.map((item) => item.id),
          }),
        },
      )
      setRows((prev) =>
        sortedWorkOrders(
          prev.map((w) => (w.id === employeeAssignWoId ? data.work_order : w)),
        ),
      )
      setSelected((cur) =>
        cur?.id === employeeAssignWoId ? data.work_order : cur,
      )
      flashMonitoringWorkOrderRow(data.work_order.id)
      flashMonitoringChangedFields(before, data.work_order)
      showSuccess(t('wo.assignment_saved'))
      closeEmployeeAssignmentDialog()
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.assignment_save_fail'))
      }
    } finally {
      setEmployeeAssignSaving(false)
    }
  }

  function openHoldDialog(row: WorkOrder) {
    setHoldDialogRow(row)
    setHoldDialogReason('')
    setHoldDialogOpen(true)
  }

  async function submitHoldDialog() {
    const row = holdDialogRow
    const reason = holdDialogReason.trim()
    if (!row || !reason) {
      showError(t('wo.hold_reason_required'))
      return
    }
    setHoldSubmitting(true)
    try {
      const data = await apiJson<WorkOrderResponse>(
        `/api/work-orders/${encodeURIComponent(row.id)}/actions/hold`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      )
      setRows((prev) =>
        sortedWorkOrders(
          prev.map((w) => (w.id === row.id ? data.work_order : w)),
        ),
      )
      setSelected((cur) => (cur?.id === row.id ? data.work_order : cur))
      flashMonitoringWorkOrderRow(data.work_order.id)
      flashMonitoringChangedFields(row, data.work_order)
      showSuccess(t('wo.updated'))
      setHoldDialogOpen(false)
      setHoldDialogRow(null)
      setHoldDialogReason('')
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.save_fail'))
      }
    } finally {
      setHoldSubmitting(false)
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'

  const auditResourceIdForMenu = workOrderIdParam || selected?.id || ''

  const selectedIsDeleting =
    !!selected && recentlyDeletedWorkOrderIds.has(selected.id)
  const canOpenEmployeeAssignment =
    !!selected && !selectedIsDeleting && !employeeAssignSaving
  const selectedForSubscription = useMemo(
    () =>
      (selected ? [selected] : []).filter(
        (row) => !recentlyDeletedWorkOrderIds.has(row.id),
      ),
    [recentlyDeletedWorkOrderIds, selected],
  )
  const hasSubscriptionTargets = selectedForSubscription.length > 0

  async function bulkSubscription(action: 'subscribe' | 'unsubscribe') {
    if (!hasSubscriptionTargets) return
    try {
      const data = await apiJson<WorkOrderSubscriptionsBulkResponse>(
        '/api/work-orders/subscriptions/bulk',
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            work_order_ids: selectedForSubscription.map((row) => row.id),
          }),
        },
      )
      showSuccess(
        t(
          action === 'subscribe'
            ? 'notifications.subscribe_success'
            : 'notifications.unsubscribe_success',
          {
            changed: data.changed_count,
            requested: data.requested_count,
          },
        ),
      )
      setSubscribedWorkOrderIds((prev) => {
        const next = new Set(prev)
        for (const row of selectedForSubscription) {
          if (action === 'subscribe') next.add(row.id)
          else next.delete(row.id)
        }
        return next
      })
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('notifications.subscription_error'))
      }
    }
  }

  function toggleRowSubscription(row: WorkOrder) {
    const action: 'subscribe' | 'unsubscribe' = subscribedWorkOrderIds.has(row.id)
      ? 'unsubscribe'
      : 'subscribe'
    setSelected(row)
    void (async () => {
      try {
        const data = await apiJson<WorkOrderSubscriptionsBulkResponse>(
          '/api/work-orders/subscriptions/bulk',
          {
            method: 'POST',
            body: JSON.stringify({
              action,
              work_order_ids: [row.id],
            }),
          },
        )
        showSuccess(
          t(
            action === 'subscribe'
              ? 'notifications.subscribe_success'
              : 'notifications.unsubscribe_success',
            {
              changed: data.changed_count,
              requested: data.requested_count,
            },
          ),
        )
        setSubscribedWorkOrderIds((prev) => {
          const next = new Set(prev)
          if (action === 'subscribe') next.add(row.id)
          else next.delete(row.id)
          return next
        })
      } catch (e) {
        if (e instanceof ApiError) {
          showError(e.message)
        } else {
          showError(t('notifications.subscription_error'))
        }
      }
    })()
  }

  const crudContextMenuItems: MenuItem[] = [
    buildAskKiraMenuItem(t, {
      openKira,
      disabled: !selected || selectedIsDeleting,
      getDraft: () => {
        const w = selected
        if (!w) return ''
        return formatKiraRowDraft(
          isMonitoring ? t('monitoring.title') : t('work_orders.title'),
          {
            id: w.id,
            key: String(w.wo_key),
            name: w.short_text,
          },
        )
      },
    }),
    { separator: true },
    ...buildCrudContextMenuModel(
      {
        onCreate: openCreate,
        onEdit: () => {
          if (selected && !selectedIsDeleting) openEditWorkOrderMw(selected)
        },
        onDelete: () => {
          if (selected && !selectedIsDeleting) confirmDelete(selected)
        },
        disableEdit: !selected || selectedIsDeleting,
        disableDelete: !selected || selectedIsDeleting,
      },
      t,
      {
        audit: selected ? rowAuditSnapshot(selected) : undefined,
        auditHistory: {
          visible: isAdmin === true && !!auditResourceIdForMenu,
          onNavigate: () =>
            navigate(
              `/audit-log?resource_type=work_order&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
            ),
        },
      },
    ),
    { separator: true } as MenuItem,
    {
      label: t('wo.employee_assignment_action'),
      icon: 'pi pi-user-plus',
      disabled: !canOpenEmployeeAssignment,
      command: () => {
        if (selected) void openEmployeeAssignment(selected)
      },
    } as MenuItem,
    { separator: true } as MenuItem,
    {
      label: t('wo.action_set_hold'),
      icon: 'pi pi-pause',
      disabled:
        !selected ||
        selectedIsDeleting ||
        (selected.status !== 'started' && selected.status !== 'continued'),
      command: () => {
        if (selected) openHoldDialog(selected)
      },
    } as MenuItem,
    {
      label: t('wo.action_create_feedback'),
      icon: 'pi pi-comments',
      disabled:
        !selected ||
        selectedIsDeleting ||
        (selected.status !== 'started' && selected.status !== 'continued'),
      command: () => {
        if (selected) openFeedbackTabRef.current(selected)
      },
    } as MenuItem,
    { separator: true } as MenuItem,
    {
      label: t('notifications.subscribe_action'),
      icon: 'pi pi-bell',
      disabled: !hasSubscriptionTargets,
      command: () => void bulkSubscription('subscribe'),
    } as MenuItem,
    {
      label: t('notifications.unsubscribe_action'),
      icon: 'pi pi-bell-slash',
      disabled: !hasSubscriptionTargets,
      command: () => void bulkSubscription('unsubscribe'),
    } as MenuItem,
  ]

  const workOrdersCardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 flex-wrap p-4 md:p-5">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-file-edit text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">
            {isMonitoring ? t('monitoring.title') : t('work_orders.title')}
          </h1>
          <p className="app-card-hero-desc">{cardSubTitle}</p>
        </div>
      </div>
      <div className="flex align-items-center gap-2 flex-shrink-0 align-self-start">
        <BulkDocumentsControl
          entityType="work_order"
          entityIds={filteredRows.map((r) => r.id)}
          toastRef={toast}
          resolveEntityLabel={(id) => workOrderLabelById.get(id) ?? id}
          onChanged={docsAssignments.refresh}
        />
        {tw.heroTableWizard}
      </div>
    </div>
  )

  const pageContent = (
    <>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog dismissableMask />
      <ContextMenu
        ref={crudContextMenuRef}
        model={crudContextMenuItems}
        {...CRUD_CONTEXT_MENU_PROPS}
      />
      {tw.wizardDialog}
      {docsAssignments.singleDialog}
      <SearchPanel
        visible={isMonitoring && searchPanelOpen}
        onHide={() => setSearchPanelOpen(false)}
        t={t}
        columns={searchableColumns}
        draft={tableSearch.draft}
        onDraftRangeFieldChange={tableSearch.setDraftRangeField}
        onDraftMultiValuesChange={tableSearch.setDraftMultiValues}
        onApply={() => {
          tableSearch.applyDraft()
          setSearchPanelOpen(false)
        }}
        onClear={tableSearch.clearDraft}
        onReset={tableSearch.resetDraftToApplied}
        onOpenPresets={() => setSearchPresetsOpen(true)}
        presetCount={tableSearch.presets.length}
      />
      <SearchPresetsDialog
        visible={isMonitoring && searchPresetsOpen}
        onHide={() => setSearchPresetsOpen(false)}
        t={t}
        presets={tableSearch.presets}
        ownPresets={tableSearch.ownPresets}
        activePresetId={tableSearch.activePresetId}
        defaultPresetId={tableSearch.defaultPresetId}
        presetKey={tableSearch.presetKey}
        setPresetKey={tableSearch.setPresetKey}
        onPickPreset={tableSearch.pickPreset}
        onSave={() => void tableSearch.savePreset()}
        onDeleteOwnPreset={(presetId) => void tableSearch.deletePresetById(presetId)}
        onSetDefault={(presetId) => void tableSearch.setDefault(presetId)}
        saving={tableSearch.saving}
      />

      <WorkInstructionViewModal
        visible={instructionViewOpen}
        onHide={() => {
          setInstructionViewOpen(false)
          setInstructionViewWoId(null)
        }}
        mode="wo"
        entityId={instructionViewWoId}
        t={t}
        reportError={showError}
        onAfterInstructionsChange={() => void loadWorkOrders({ silent: true })}
      />

      <AppCrudDialog
        title={t('wo.employee_assignment_title')}
        visible={employeeAssignOpen}
        onHide={closeEmployeeAssignmentDialog}
        dismissableMask={!employeeAssignSaving}
        style={{ width: 'min(56rem, 98vw)' }}
        footer={
          <div className="flex justify-content-between align-items-center gap-2 flex-wrap w-full">
            <Button
              type="button"
              label={t('wo.employee_assignment_revert')}
              icon="pi pi-undo"
              severity="secondary"
              outlined
              onClick={revertEmployeeAssignment}
              disabled={
                !employeeAssignDirty || employeeAssignSaving || employeeAssignLoading
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                label={t('common.cancel')}
                severity="secondary"
                outlined
                onClick={closeEmployeeAssignmentDialog}
                disabled={employeeAssignSaving}
              />
              <Button
                type="button"
                label={t('common.save')}
                icon="pi pi-check"
                onClick={() => void saveEmployeeAssignment()}
                loading={employeeAssignSaving}
                disabled={
                  !employeeAssignDirty || employeeAssignSaving || employeeAssignLoading
                }
              />
            </div>
          </div>
        }
      >
        <p className="text-sm text-color-secondary mt-0 mb-3">
          {t('wo.employee_assignment_hint')}
        </p>
        {employeeAssignLoading ? (
          <div className="text-sm text-color-secondary py-4">
            {t('common.loading')}
          </div>
        ) : (
          <div
            className={
              employeeAssignSaving ? 'opacity-60 pointer-events-none select-none' : ''
            }
          >
            <PickList
              className="wo-employee-picklist w-full"
              dataKey="id"
              source={employeeSourcePool}
              target={employeeTargetPool}
              onChange={onEmployeePickListChange}
              itemTemplate={employeePoolItemTemplate}
              sourceHeader={t('wo.pool_available')}
              targetHeader={t('wo.pool_assigned')}
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

      <div
        className={[
          'w-full app-page-mw-none flex flex-column',
          isMonitoring ? 'p-2 h-full min-h-0 gap-2' : 'p-4 gap-3',
        ].join(' ')}
      >
        {isMonitoring ? (
          <div className="surface-card p-3 flex flex-column gap-3 min-h-0 flex-1">
            <div className="flex justify-content-between align-items-center gap-3 flex-wrap w-full">
              <div className="flex align-items-center gap-3 flex-wrap min-w-0">
                <div className="min-w-0">
                  <h1 className="text-xl m-0">{t('monitoring.title')}</h1>
                  <p className="text-sm text-color-secondary m-0 mt-1">
                    {cardSubTitle}
                  </p>
                </div>
                <ButtonGroup>
                  <Button
                    type="button"
                    label={t('common.create')}
                    icon="pi pi-plus"
                    size="small"
                    onClick={openCreate}
                  />
                  <Button
                    type="button"
                    label={t('common.edit')}
                    icon="pi pi-pencil"
                    size="small"
                    disabled={!selected || selectedIsDeleting}
                    onClick={() => selected && openEditWorkOrderMw(selected)}
                  />
                  <Button
                    type="button"
                    label={t('common.delete')}
                    icon="pi pi-trash"
                    severity="danger"
                    size="small"
                    disabled={!selected || selectedIsDeleting}
                    onClick={() => selected && confirmDelete(selected)}
                  />
                  <Button
                    type="button"
                    label={t('wo.employee_assignment_action')}
                    icon="pi pi-user-plus"
                    size="small"
                    disabled={!canOpenEmployeeAssignment}
                    onClick={() => selected && void openEmployeeAssignment(selected)}
                  />
                  <Button
                    type="button"
                    label={t('notifications.subscribe_action')}
                    icon="pi pi-bell"
                    size="small"
                    outlined
                    disabled={!hasSubscriptionTargets}
                    onClick={() => void bulkSubscription('subscribe')}
                  />
                  <Button
                    type="button"
                    label={t('notifications.unsubscribe_action')}
                    icon="pi pi-bell-slash"
                    size="small"
                    outlined
                    disabled={!hasSubscriptionTargets}
                    onClick={() => void bulkSubscription('unsubscribe')}
                  />
                </ButtonGroup>
              </div>
              <div className="flex align-items-center gap-2 ml-auto flex-nowrap">
                <Dropdown
                  value={tableSearch.activePresetId}
                  options={searchPresetQuickOptions}
                  optionLabel="label"
                  optionValue="value"
                  onChange={(e) =>
                    tableSearch.pickPreset((e.value as string | null) ?? null)
                  }
                  placeholder={t('search_panel.select_preset')}
                  showClear
                  className="w-15rem"
                  disabled={!isMonitoring || searchPresetQuickOptions.length === 0}
                />
                <div
                  className="p-inputgroup app-monitoring-searchgroup flex-shrink-0"
                  style={{ width: '20rem' }}
                >
                  <IconField iconPosition="left" className="app-crud-toolbar-search w-full">
                    <InputIcon className="pi pi-search" />
                    <InputText
                      ref={toolbarSearchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('common.search_ellipsis')}
                      aria-label={t('monitoring.search_aria')}
                      className="w-full"
                    />
                  </IconField>
                  <Button
                    type="button"
                    icon="pi pi-sliders-h"
                    size="small"
                    outlined
                    severity={
                      tableSearch.activeCriteriaCount > 0 ? 'help' : 'secondary'
                    }
                    className="app-monitoring-searchpanel-trigger"
                    aria-label={t('search_panel.title')}
                    onClick={() => setSearchPanelOpen(true)}
                    disabled={tableSearch.loading}
                  />
                </div>
                <BulkDocumentsControl
                  entityType="work_order"
                  entityIds={filteredRows.map((r) => r.id)}
                  toastRef={toast}
                  resolveEntityLabel={(id) =>
                    workOrderLabelById.get(id) ?? id
                  }
                  onChanged={docsAssignments.refresh}
                />
                {tw.heroTableWizard}
              </div>
            </div>
            <div className="w-full overflow-x-auto flex-1 min-h-0">
              <DataTable
                {...tableLayoutRest}
                className={['work-orders-table', twTableClass]
                  .filter(Boolean)
                  .join(' ')}
                value={tw.prepareRows(filteredRows)}
                loading={loading || tw.tableBusy}
                dataKey="id"
                selection={selected}
                tableStyle={{ minWidth: '96rem', width: 'max-content' }}
                scrollable
                scrollHeight="flex"
                rowClassName={(row) =>
                  [
                    recentlyCreatedWorkOrderIds.has((row as WorkOrder).id)
                      ? 'monitoring-wo-new-row'
                      : '',
                    recentlyChangedWorkOrderIds.has((row as WorkOrder).id)
                      ? 'monitoring-wo-flash-row'
                      : '',
                    recentlyDeletedWorkOrderIds.has((row as WorkOrder).id)
                      ? 'monitoring-wo-deleting-row'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
                onSelectionChange={(e) =>
                  setSelected((prev) => {
                    const next = e.value as WorkOrder | null
                    if (next && recentlyDeletedWorkOrderIds.has(next.id)) return prev
                    return next
                  })
                }
                contextMenuSelection={selected ?? undefined}
                onContextMenuSelectionChange={(e) =>
                  setSelected((prev) => {
                    const next = e.value as WorkOrder | null
                    if (next && recentlyDeletedWorkOrderIds.has(next.id)) return prev
                    return next
                  })
                }
                onContextMenu={(e) => {
                  const row = e.data as WorkOrder | undefined
                  if (row && recentlyDeletedWorkOrderIds.has(row.id)) return
                  e.originalEvent.preventDefault()
                  crudContextMenuRef.current?.show(e.originalEvent)
                }}
                selectionMode="single"
                metaKeySelection={false}
                onRowDoubleClick={(e) => {
                  const row = e.data as WorkOrder
                  if (recentlyDeletedWorkOrderIds.has(row.id)) return
                  setSelected(row)
                  openEditWorkOrderMw(row)
                }}
                emptyMessage={
                  search.trim() || tableSearch.activeCriteriaCount > 0
                    ? t('monitoring.empty_search')
                    : t('monitoring.empty')
                }
                stripedRows
              >
                {tw.renderColumns()}
              </DataTable>
            </div>
          </div>
        ) : (
          <Card
            className="shadow-1 border-round-xl overflow-hidden"
            pt={{ header: { className: 'p-0 border-none' } }}
            header={workOrdersCardHeader}
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
                      label="Create Dummy"
                      icon="pi pi-wrench"
                      outlined
                      disabled={dummyCreating}
                      loading={dummyCreating}
                      onClick={() => void createDummyWorkOrder()}
                    />
                    <Button
                      type="button"
                      label={t('common.edit')}
                      icon="pi pi-pencil"
                      disabled={!selected}
                      onClick={() => selected && openEditWorkOrderMw(selected)}
                    />
                    <Button
                      type="button"
                      label={t('common.delete')}
                      icon="pi pi-trash"
                      severity="danger"
                      disabled={!selected}
                      onClick={() => selected && confirmDelete(selected)}
                    />
                    <Button
                      type="button"
                      label={t('wo.employee_assignment_action')}
                      icon="pi pi-user-plus"
                      disabled={!canOpenEmployeeAssignment}
                      onClick={() => selected && void openEmployeeAssignment(selected)}
                    />
                    <Button
                      type="button"
                      label={t('notifications.subscribe_action')}
                      icon="pi pi-bell"
                      outlined
                      disabled={!hasSubscriptionTargets}
                      onClick={() => void bulkSubscription('subscribe')}
                    />
                    <Button
                      type="button"
                      label={t('notifications.unsubscribe_action')}
                      icon="pi pi-bell-slash"
                      outlined
                      disabled={!hasSubscriptionTargets}
                      onClick={() => void bulkSubscription('unsubscribe')}
                    />
                  </ButtonGroup>
                </div>
                <IconField
                  iconPosition="left"
                  className="app-crud-toolbar-search flex-shrink-0 ml-auto"
                  style={{ width: 'min(20rem, 100%)' }}
                >
                  <InputIcon className="pi pi-search" />
                  <InputText
                    ref={toolbarSearchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('common.search_ellipsis')}
                    aria-label={t('work_orders.search_aria')}
                    className="w-full"
                  />
                </IconField>
              </div>
              <p className="text-sm text-color-secondary mt-0 mb-3">
                {t('wo.help_intro')}
              </p>
              <div className="w-full overflow-x-auto">
                <DataTable
                  {...tableLayoutRest}
                  className={['work-orders-table', twTableClass]
                    .filter(Boolean)
                    .join(' ')}
                  value={tw.prepareRows(filteredRows)}
                  loading={loading || tw.tableBusy}
                  dataKey="id"
                  selection={selected}
                  tableStyle={{ minWidth: '96rem', width: 'max-content' }}
                  onSelectionChange={(e) =>
                    setSelected(e.value as WorkOrder | null)
                  }
                  contextMenuSelection={selected ?? undefined}
                  onContextMenuSelectionChange={(e) =>
                    setSelected(e.value as WorkOrder | null)
                  }
                  onContextMenu={(e) => {
                    e.originalEvent.preventDefault()
                    crudContextMenuRef.current?.show(e.originalEvent)
                  }}
                  selectionMode="single"
                  metaKeySelection={false}
                  onRowDoubleClick={(e) => {
                    const row = e.data as WorkOrder
                    setSelected(row)
                    openEditWorkOrderMw(row)
                  }}
                  emptyMessage={
                    search.trim()
                      ? t('work_orders.empty_search')
                      : t('work_orders.empty')
                  }
                  stripedRows
                >
                  {tw.renderColumns()}
                </DataTable>
              </div>
            </div>
          </Card>
        )}
      </div>

      <AppCrudDialog
        title={t('wo.hold_dialog_title')}
        visible={holdDialogOpen}
        onHide={() => {
          if (holdSubmitting) return
          setHoldDialogOpen(false)
          setHoldDialogRow(null)
          setHoldDialogReason('')
        }}
        style={{ width: 'min(36rem, 96vw)' }}
        dismissableMask={!holdSubmitting}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              disabled={holdSubmitting}
              onClick={() => {
                setHoldDialogOpen(false)
                setHoldDialogRow(null)
                setHoldDialogReason('')
              }}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              loading={holdSubmitting}
              onClick={() => void submitHoldDialog()}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-2">
          <label htmlFor="wo-hold-reason" className="text-sm font-medium">
            {t('wo.hold_reason_label')}
          </label>
          <InputTextarea
            id="wo-hold-reason"
            value={holdDialogReason}
            onChange={(e) => setHoldDialogReason(e.target.value)}
            rows={4}
            className="w-full"
            disabled={holdSubmitting}
            maxLength={2000}
            autoResize
          />
        </div>
      </AppCrudDialog>
    </>
  )

  return <AppShell>{pageContent}</AppShell>
}

export default function WorkOrdersAppPage() {
  return <WorkOrdersPage mode="work-orders" />
}
