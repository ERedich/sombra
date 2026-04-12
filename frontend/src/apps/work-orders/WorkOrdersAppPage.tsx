/**
 * CRUD for work orders — template-app layout + Sites-style API wiring.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { MenuItem } from 'primereact/menuitem'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ContextMenu } from 'primereact/contextmenu'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { MultiSelect } from 'primereact/multiselect'
import { PickList } from 'primereact/picklist'
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { TabView, TabPanel } from 'primereact/tabview'
import { ApiError, apiBase, apiJson } from '../../api'
import {
  mergeDisplayStatusColours,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'
import { getStoredUser, getToken } from '../../auth'
import { useRegisterCreateShortcut } from '../../layout/AppCreateShortcut'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../../layout/crudContextMenuItems'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import {
  VoiceAssistPanel,
  type AiSuggestWoValidated,
} from '../../components/ai/VoiceAssistPanel'
import { AssetPickerSidebarContent } from '../../components/sel-item/AssetPickerSidebarContent'
import { SelItemField } from '../../components/sel-item/SelItemField'
import { formatDateTime } from '../../utils/dateTime'
import { WorkAssignmentsIcons } from '../../components/work-instructions/WorkAssignmentsIcons'
import { WorkInstructionViewModal } from '../../components/work-instructions/WorkInstructionViewModal'
import {
  WorkInstructionsTab,
  workInstructionsForCreateBody,
  workInstructionsFromApi,
  type FormWorkInstruction,
} from '../../components/work-instructions/WorkInstructionsTab'
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

export type WorkOrder = {
  id: string
  site_id: string
  wo_key: number
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  plan_start: string | null
  plan_end: string | null
  worktime: string
  work_type_id: string
  work_type_key: string
  work_type_name: string
  work_type_colour: string
  category_id: string | null
  category_key: string | null
  category_name: string | null
  workgroup_id: string
  workgroup_key: string
  workgroup_name: string
  status: string
  work_plan_id?: string | null
  work_plan_key?: string | null
  work_plan_interval_count?: number | null
  work_plan_interval_time_type?: string | null
  work_plan_next_due_at?: string | null
  duration?: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  site_key: string
  site_name: string
  site_colour: string
  asset_key: string
  asset_name: string
  costcenter_key: string | null
  costcenter_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
  work_instructions?: {
    id: string
    sort_nr: number
    instruction_text: string
    done: boolean
  }[]
  /** List API: placeholders until material/employee assignment features ship. */
  has_material_assignment?: boolean
  has_employee_assignment?: boolean
  assigned_employee_ids?: string[]
  work_instruction_count?: number
  work_instruction_done_count?: number
  hold_reason?: string | null
}

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
type WoTransactionRow = {
  id: string
  work_order_id: string
  type: string
  employee_id: string
  created_by_user_id: string
  hours: string
  feedback_text: string
  created_at: string
  employee_key: string
  employee_name: string
  created_by_login_name: string | null
}
type WoTransactionsResponse = { transactions: WoTransactionRow[] }

type WorkOrderWsEventType =
  | 'work_order_created'
  | 'work_order_updated'
  | 'work_order_deleted'
type WorkOrderWsMessage = {
  type?: WorkOrderWsEventType | string
  work_order?: WorkOrder
  work_order_id?: string
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

function parseWorktimeNum(w: string): number {
  const n = Number(w)
  return Number.isFinite(n) ? n : 0
}

/** Readable foreground on solid badge background (hex #rrggbb). */
function contrastTextOnHex(bgHex: string): string {
  const s = bgHex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#ffffff'
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

function buildWorkOrderWsUrl(): string | null {
  const token = getToken()
  if (!token) return null
  const base = (apiBase.trim() || window.location.origin).replace(/\/$/, '')
  const u = new URL(base)
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${u.host}/api/ws?token=${encodeURIComponent(token)}`
}

const WO_FEEDBACK_DONE_REQUIRES_TIME_CODE = 'WO_FEEDBACK_DONE_REQUIRES_TIME'

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

function formStatusTag(
  formStatus: string,
  t: TFunction,
  mergedColours: Record<WorkOrderStatusColourKey, string>,
) {
  const k = WO_STATUS_I18N_KEYS[formStatus]
  const label = k ? t(k) : formStatus
  const sk = formStatus as WorkOrderStatusColourKey
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

function poolDtoToItem(row: WorkOrderEmployeePoolItemDto): EmployeePickItem {
  return {
    id: row.employee_id,
    key: row.employee_key,
    name: row.employee_name,
  }
}

function workOrderHasLinkedPlan(row: Pick<WorkOrder, 'work_plan_id' | 'work_plan_key'>): boolean {
  const id = row.work_plan_id?.trim() ?? ''
  const key = row.work_plan_key?.trim() ?? ''
  return Boolean(id || key)
}

/**
 * Child index of the Feedback TabPanel in the WO edit dialog TabView.
 * Order is fixed: General (0), Instructions (1), Work plan or `null` at (2), Planning (3), Feedback (4).
 * When there is no work plan, React still renders `null` at index 2, so Feedback is always 4 — not 3.
 */
function feedbackTabIndexForRow(_row: WorkOrder): number {
  return 4
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
  const wt = parseWorktimeNum(w.worktime).toString()
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
    String(w.duration ?? '').includes(q) ||
    wt.includes(q) ||
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
  const [searchParams] = useSearchParams()
  const workOrderIdParam = searchParams.get('workOrderId')?.trim() ?? ''

  const emDash = t('common.em_dash')

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dummyCreating, setDummyCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formShortText, setFormShortText] = useState('')
  const [formAssetId, setFormAssetId] = useState<string | null>(null)
  const [formInstruction, setFormInstruction] = useState('')
  const [formPlanStart, setFormPlanStart] = useState<Date | null>(null)
  const [formPlanEnd, setFormPlanEnd] = useState<Date | null>(null)
  const [formDurationHours, setFormDurationHours] = useState<number | null>(0)
  const [formWorktime, setFormWorktime] = useState<number | null>(null)
  const [formWorkTypeId, setFormWorkTypeId] = useState<string | null>(null)
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null)
  const [formWorkgroupId, setFormWorkgroupId] = useState<string | null>(null)
  const [formStatus, setFormStatus] = useState('open')
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([])
  const [employeesForFilter, setEmployeesForFilter] = useState<
    { id: string; key: string; name: string }[]
  >([])
  const [subscribedWorkOrderIds, setSubscribedWorkOrderIds] = useState<Set<string>>(
    new Set(),
  )
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
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
  const [dialogTab, setDialogTab] = useState(0)
  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [holdDialogReason, setHoldDialogReason] = useState('')
  const [holdDialogRow, setHoldDialogRow] = useState<WorkOrder | null>(null)
  const [holdSubmitting, setHoldSubmitting] = useState(false)
  const [woTxList, setWoTxList] = useState<WoTransactionRow[]>([])
  const [woTxLoading, setWoTxLoading] = useState(false)
  const [fbSelfText, setFbSelfText] = useState('')
  const [fbSelfHours, setFbSelfHours] = useState<number | null>(0)
  const [fbExtraEmployeeIds, setFbExtraEmployeeIds] = useState<string[]>([])
  const [fbExtraText, setFbExtraText] = useState<Record<string, string>>({})
  const [fbExtraHours, setFbExtraHours] = useState<Record<string, number | null>>(
    {},
  )
  const [fbTargetStatus, setFbTargetStatus] = useState<
    '' | 'on_hold' | 'done'
  >('')
  const [fbHoldReason, setFbHoldReason] = useState('')
  const [fbSaving, setFbSaving] = useState(false)
  const [formWorkInstructions, setFormWorkInstructions] = useState<
    FormWorkInstruction[]
  >([])
  const [woAiAssets, setWoAiAssets] = useState<Asset[]>([])
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
  /** Prevents late GET /work-orders/:id from overwriting instructions after close or another open. */
  const workOrderInstructionsFetchForIdRef = useRef<string | null>(null)
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
  const [woUserAutoAssignOnStart, setWoUserAutoAssignOnStart] = useState(true)
  const [woAllowMultipleStarted, setWoAllowMultipleStarted] = useState(false)
  const [woLockEndDateByDuration, setWoLockEndDateByDuration] = useState(false)
  const [woAllowPlanStartInHistory, setWoAllowPlanStartInHistory] =
    useState(false)
  const [woRequireTimeRegistrationForDone, setWoRequireTimeRegistrationForDone] =
    useState(true)
  const [woStatusColourOverrides, setWoStatusColourOverrides] = useState<
    Partial<Record<WorkOrderStatusColourKey, string>>
  >({})
  const [feedbackPoolAvailable, setFeedbackPoolAvailable] = useState<
    WorkOrderEmployeePoolItemDto[]
  >([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<{
          wo: {
            start_requires_assignment: boolean
            user_auto_assign_on_start?: boolean
            allow_multiple_started_work_orders?: boolean
            lock_end_date_by_duration?: boolean
            allow_plan_start_in_history?: boolean
            require_time_registration_for_done?: boolean
            work_order_status_colours?: Partial<
              Record<WorkOrderStatusColourKey, string>
            >
          }
        }>('/api/app-parameters')
        if (!cancelled) {
          setWoStartRequiresAssignment(
            data.wo?.start_requires_assignment !== false,
          )
          setWoUserAutoAssignOnStart(
            data.wo?.user_auto_assign_on_start !== false,
          )
          setWoAllowMultipleStarted(
            data.wo?.allow_multiple_started_work_orders === true,
          )
          setWoLockEndDateByDuration(
            data.wo?.lock_end_date_by_duration === true,
          )
          setWoAllowPlanStartInHistory(
            data.wo?.allow_plan_start_in_history === true,
          )
          setWoRequireTimeRegistrationForDone(
            data.wo?.require_time_registration_for_done !== false,
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
          setWoUserAutoAssignOnStart(true)
          setWoAllowMultipleStarted(false)
          setWoLockEndDateByDuration(false)
          setWoAllowPlanStartInHistory(false)
          setWoRequireTimeRegistrationForDone(true)
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

  /** Matches backend PSH check: disallow calendar days before UTC today when PSH is off. */
  const planStartCalendarMinDate = useMemo((): Date | undefined => {
    if (woAllowPlanStartInHistory) return undefined
    const n = new Date()
    return new Date(
      Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0),
    )
  }, [woAllowPlanStartInHistory])

  const loadFeedbackEmployeePool = useCallback(async (woId: string) => {
    try {
      const data = await apiJson<WorkOrderEmployeePoolResponse>(
        `/api/work-orders/${encodeURIComponent(woId)}/employees/pool`,
      )
      setFeedbackPoolAvailable(data.available ?? [])
    } catch {
      setFeedbackPoolAvailable([])
    }
  }, [])

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
        headerKey: 'wo.col_key',
        sortable: true,
        search: { inputType: 'number', getSearchValue: (row) => row.wo_key },
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
      {
        field: 'short_text',
        headerKey: 'wo.col_short_text',
        sortable: true,
        search: { getSearchValue: (row) => row.short_text },
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
        field: 'asset_key',
        headerKey: 'wo.col_asset',
        sortable: true,
        sortField: 'asset_key',
        body: (row) => `${row.asset_key} ${emDash} ${row.asset_name}`,
        search: { getSearchValue: (row) => `${row.asset_key} ${row.asset_name}` },
      },
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
        field: 'worktime',
        headerKey: 'wo.col_worktime_h',
        sortable: true,
        body: (row) => parseWorktimeNum(row.worktime),
        search: {
          inputType: 'number',
          getSearchValue: (row) => parseWorktimeNum(row.worktime),
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
      cellClassName: (row: WorkOrder) =>
        recentlyChangedFieldsByWorkOrderId[row.id]?.has(def.field)
          ? 'monitoring-wo-flash-cell'
          : undefined,
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
          prev.map((w) => (w.id === row.id ? data.work_order : w)),
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
        setRows(list)
        return list
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

  const editingWo = useMemo(
    () =>
      editingId
        ? rows.find((w) => w.id === editingId) ?? selected
        : null,
    [editingId, rows, selected],
  )

  const targetSiteIdForPicker = useMemo(() => {
    if (editingId) {
      const wo = rows.find((w) => w.id === editingId)
      return wo?.site_id ?? null
    }
    return getStoredUser()?.working_site_id ?? null
  }, [editingId, rows])

  const workTypesForSite = useMemo(() => {
    if (!targetSiteIdForPicker) return []
    return workTypes.filter((wt) => wt.site_id === targetSiteIdForPicker)
  }, [workTypes, targetSiteIdForPicker])

  const workTypeDropdownOptions = useMemo(
    () =>
      workTypesForSite.map((wt) => ({
        label: `${wt.key} — ${wt.name}`,
        value: wt.id,
      })),
    [workTypesForSite],
  )

  const categoriesForSite = useMemo(() => {
    if (!targetSiteIdForPicker) return []
    return categories.filter((c) => c.site_id === targetSiteIdForPicker)
  }, [categories, targetSiteIdForPicker])

  const categoryDropdownOptions = useMemo(
    () => [
      { label: t('common.none'), value: null as string | null },
      ...categoriesForSite.map((c) => ({
        label: `${c.key} — ${c.name}`,
        value: c.id,
      })),
    ],
    [categoriesForSite, t],
  )

  const workgroupsForSite = useMemo(() => {
    if (!targetSiteIdForPicker) return []
    return workgroups.filter((wg) => wg.site_id === targetSiteIdForPicker)
  }, [workgroups, targetSiteIdForPicker])

  const workgroupDropdownOptions = useMemo(
    () =>
      workgroupsForSite.map((wg) => ({
        label: `${wg.key} — ${wg.name}`,
        value: wg.id,
      })),
    [workgroupsForSite],
  )

  const assetsForWoVoice = useMemo(() => {
    const sid = targetSiteIdForPicker
    if (!sid) return []
    return woAiAssets.filter((a) => a.site_id === sid)
  }, [woAiAssets, targetSiteIdForPicker])

  useEffect(() => {
    if (!dialogOpen || editingId) return
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<AssetsListResponse>('/api/assets')
        if (!cancelled) setWoAiAssets(data.assets ?? [])
      } catch {
        if (!cancelled) setWoAiAssets([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dialogOpen, editingId])

  const applyAiWoDraft = useCallback(
    (v: AiSuggestWoValidated) => {
      if (v.short_text?.trim()) setFormShortText(v.short_text.trim())
      if (v.instruction_text?.trim()) {
        setFormInstruction(v.instruction_text.trim())
      }
      if (v.asset_id) {
        setFormAssetId(v.asset_id)
        const a = assetsForWoVoice.find((x) => x.id === v.asset_id)
        setPickedAsset(a ?? null)
      }
      if (v.work_type_id) setFormWorkTypeId(v.work_type_id)
      if (v.workgroup_id) setFormWorkgroupId(v.workgroup_id)
      setFormCategoryId(v.category_id ?? null)
      if (v.worktime != null && Number.isFinite(v.worktime)) {
        setFormWorktime(v.worktime)
      }
      if (v.duration != null && Number.isFinite(v.duration)) {
        setFormDurationHours(v.duration)
      }
      if (v.plan_start) {
        const d = new Date(v.plan_start)
        if (!Number.isNaN(d.getTime())) setFormPlanStart(d)
      }
    },
    [assetsForWoVoice],
  )

  const pmWorkTypeIdForSite = useMemo(
    () => workTypesForSite.find((w) => w.key === 'PM')?.id ?? null,
    [workTypesForSite],
  )

  const assetDisplayLabel = useMemo(() => {
    if (pickedAsset) {
      return `${pickedAsset.key} ${emDash} ${pickedAsset.name}`
    }
    if (
      editingWo &&
      formAssetId &&
      formAssetId === editingWo.asset_id
    ) {
      return `${editingWo.asset_key} ${emDash} ${editingWo.asset_name}`
    }
    return ''
  }, [pickedAsset, editingWo, formAssetId, emDash])

  const costCenterHint = useMemo(() => {
    if (pickedAsset) {
      if (!pickedAsset.costcenter_id) return emDash
      const ck = pickedAsset.costcenter_key ?? ''
      const cn = pickedAsset.costcenter_name ?? ''
      if (!ck && !cn) return emDash
      return `${ck} ${emDash} ${cn}`.trim()
    }
    if (editingWo) {
      if (!editingWo.costcenter_id) return emDash
      const ck = editingWo.costcenter_key ?? ''
      const cn = editingWo.costcenter_name ?? ''
      if (!ck && !cn) return emDash
      return `${ck} ${emDash} ${cn}`.trim()
    }
    return emDash
  }, [pickedAsset, editingWo, emDash])

  const planEndPreview = useMemo(() => {
    if (!formPlanStart || formDurationHours == null) return null
    return new Date(
      formPlanStart.getTime() + formDurationHours * 3600000,
    )
  }, [formPlanStart, formDurationHours])

  const planEndDisplayLocked = planEndPreview
    ? formatDateTime(planEndPreview.toISOString())
    : emDash

  const linkedToWorkPlan = editingWo ? workOrderHasLinkedPlan(editingWo) : false

  const workPlanTabIntervalType = useMemo(() => {
    const raw = editingWo?.work_plan_interval_time_type
    if (!raw) return emDash
    if (['day', 'week', 'month', 'year'].includes(raw)) {
      return t(`wp.interval_${raw}` as 'wp.interval_day')
    }
    return raw
  }, [editingWo?.work_plan_interval_time_type, emDash, t])

  const workPlanTabNextDue = useMemo(() => {
    const v = editingWo?.work_plan_next_due_at
    if (!v) return emDash
    return formatDateTime(v)
  }, [editingWo?.work_plan_next_due_at, emDash])

  const workPlanTabIntervalCount = useMemo(() => {
    const n = editingWo?.work_plan_interval_count
    if (n == null || !Number.isFinite(Number(n))) return emDash
    return String(n)
  }, [editingWo?.work_plan_interval_count, emDash])

  function openCreate() {
    workOrderInstructionsFetchForIdRef.current = null
    setSelected(null)
    setEditingId(null)
    setFormShortText('')
    setFormAssetId(null)
    setPickedAsset(null)
    setFormInstruction('')
    setFormPlanStart(null)
    setFormPlanEnd(null)
    setFormDurationHours(0)
    setFormWorktime(null)
    const ws = getStoredUser()?.working_site_id
    const list = ws
      ? workTypes.filter((wt) => wt.site_id === ws)
      : []
    const def =
      list.find((w) => w.key === 'CM')?.id ?? list[0]?.id ?? null
    setFormWorkTypeId(def)
    setFormCategoryId(null)
    const wgl = ws ? workgroups.filter((wg) => wg.site_id === ws) : []
    setFormWorkgroupId(
      wgl.find((w) => w.key === '_DEFAULT')?.id ?? wgl[0]?.id ?? null,
    )
    setFormStatus('open')
    setAssetPickerOpen(false)
    setDialogTab(0)
    setFormWorkInstructions([])
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  function resetFeedbackForm() {
    setFbSelfText('')
    setFbSelfHours(0)
    setFbExtraEmployeeIds([])
    setFbExtraText({})
    setFbExtraHours({})
    setFbTargetStatus('')
    setFbHoldReason('')
  }

  async function openEdit(row: WorkOrder, initialTab?: number) {
    const id = row.id
    workOrderInstructionsFetchForIdRef.current = id

    const rowFeedbackIdx = feedbackTabIndexForRow(row)
    const openingToFeedbackTab =
      initialTab !== undefined && initialTab === rowFeedbackIdx

    const applyRowToForm = (r: WorkOrder, tabIndex: number) => {
      setEditingId(id)
      setFormShortText(r.short_text)
      setFormAssetId(r.asset_id)
      setPickedAsset(null)
      setFormInstruction(r.instruction_text)
      setFormPlanStart(r.plan_start ? new Date(r.plan_start) : null)
      setFormPlanEnd(r.plan_end ? new Date(r.plan_end) : null)
      setFormDurationHours(Number(r.duration ?? '0'))
      setFormWorktime(parseWorktimeNum(r.worktime))
      setFormWorkTypeId(r.work_type_id)
      setFormCategoryId(r.category_id ?? null)
      setFormWorkgroupId(r.workgroup_id)
      setFormStatus(r.status)
      setAssetPickerOpen(false)
      setDialogTab(tabIndex)
      if (tabIndex === feedbackTabIndexForRow(r)) {
        resetFeedbackForm()
      }
      setFormWorkInstructions(
        r.work_instructions?.length
          ? workInstructionsFromApi(r.work_instructions)
          : [],
      )
    }

    // Stop / Create Feedback: list rows often omit work_plan_*; opening the dialog first
    // with a 4-tab layout then merging detail (5 tabs) shifts indices so index 3 becomes Planning.
    // Fetch first, merge, then open with the correct Feedback index in one paint.
    if (openingToFeedbackTab) {
      try {
        const data = await apiJson<WorkOrderResponse>(
          `/api/work-orders/${encodeURIComponent(id)}`,
        )
        if (workOrderInstructionsFetchForIdRef.current !== id) return
        const wo = data.work_order
        setRows((prev) => prev.map((w) => (w.id === id ? wo : w)))
        setSelected((cur) => (cur?.id === id ? wo : cur))
        applyRowToForm(wo, feedbackTabIndexForRow(wo))
        setDialogOpen(true)
      } catch {
        if (workOrderInstructionsFetchForIdRef.current !== id) return
        applyRowToForm(row, rowFeedbackIdx)
        setDialogOpen(true)
      }
      return
    }

    const tab = initialTab ?? 0
    applyRowToForm(row, tab)
    setDialogOpen(true)
    try {
      const data = await apiJson<WorkOrderResponse>(
        `/api/work-orders/${encodeURIComponent(id)}`,
      )
      if (workOrderInstructionsFetchForIdRef.current !== id) return
      setRows((prev) =>
        prev.map((w) => (w.id === id ? data.work_order : w)),
      )
      setSelected((cur) => (cur?.id === id ? data.work_order : cur))
      setFormWorkInstructions(
        workInstructionsFromApi(data.work_order.work_instructions ?? []),
      )
    } catch {
      if (workOrderInstructionsFetchForIdRef.current !== id) return
      setFormWorkInstructions(
        row.work_instructions?.length
          ? workInstructionsFromApi(row.work_instructions)
          : [],
      )
    }
  }

  openFeedbackTabRef.current = (row) => {
    void openEdit(row, feedbackTabIndexForRow(row))
  }

  const loadWoTransactions = useCallback(
    async (woId: string) => {
      setWoTxLoading(true)
      try {
        const data = await apiJson<WoTransactionsResponse>(
          `/api/work-orders/${encodeURIComponent(woId)}/transactions`,
        )
        setWoTxList(data.transactions ?? [])
      } catch (e) {
        setWoTxList([])
        if (e instanceof ApiError) {
          showError(e.message)
        }
      } finally {
        setWoTxLoading(false)
      }
    },
    [showError],
  )

  const editingRowForFeedback = useMemo(
    () => (editingId ? rows.find((w) => w.id === editingId) ?? null : null),
    [editingId, rows],
  )
  /** Must match TabView: Work plan panel uses `linkedToWorkPlan` from `editingWo`, not list-only row. */
  const feedbackTabIdx =
    editingId != null && editingWo != null
      ? feedbackTabIndexForRow(editingWo)
      : -1

  useEffect(() => {
    if (
      !dialogOpen ||
      !editingId ||
      feedbackTabIdx < 0 ||
      dialogTab !== feedbackTabIdx
    ) {
      setFeedbackPoolAvailable([])
      return
    }
    if (woStartRequiresAssignment || !woUserAutoAssignOnStart) {
      setFeedbackPoolAvailable([])
      return
    }
    void loadFeedbackEmployeePool(editingId)
  }, [
    dialogOpen,
    editingId,
    dialogTab,
    feedbackTabIdx,
    woStartRequiresAssignment,
    woUserAutoAssignOnStart,
    loadFeedbackEmployeePool,
  ])

  const fbExtraEmployeeOptions = useMemo(() => {
    if (!editingRowForFeedback) return []
    const assignedSet = new Set(
      editingRowForFeedback.assigned_employee_ids ?? [],
    )
    const allowPool =
      !woStartRequiresAssignment && woUserAutoAssignOnStart
    const idSet = new Set<string>()
    for (const eid of assignedSet) {
      if (eid !== currentEmployeeId) idSet.add(eid)
    }
    if (allowPool) {
      for (const p of feedbackPoolAvailable) {
        if (p.employee_id !== currentEmployeeId) {
          idSet.add(p.employee_id)
        }
      }
    }
    const idToLabel = new Map<string, string>()
    for (const e of employeesForFilter) {
      if (idSet.has(e.id)) {
        idToLabel.set(e.id, `${e.key} ${emDash} ${e.name}`)
      }
    }
    if (allowPool) {
      for (const p of feedbackPoolAvailable) {
        if (
          idSet.has(p.employee_id) &&
          !idToLabel.has(p.employee_id)
        ) {
          idToLabel.set(
            p.employee_id,
            `${p.employee_key} ${emDash} ${p.employee_name}`,
          )
        }
      }
    }
    return [...idSet]
      .sort((a, b) =>
        (idToLabel.get(a) ?? a).localeCompare(idToLabel.get(b) ?? b),
      )
      .map((id) => ({
        value: id,
        label: idToLabel.get(id) ?? id,
      }))
  }, [
    editingRowForFeedback,
    employeesForFilter,
    currentEmployeeId,
    emDash,
    woStartRequiresAssignment,
    woUserAutoAssignOnStart,
    feedbackPoolAvailable,
  ])

  const feedbackShowSelfSection = useMemo(() => {
    const row = editingRowForFeedback
    const selfId = currentEmployeeId
    if (!row || !selfId) return false
    const selfAssigned = (row.assigned_employee_ids ?? []).includes(selfId)
    return selfAssigned || !woStartRequiresAssignment
  }, [editingRowForFeedback, currentEmployeeId, woStartRequiresAssignment])

  const feedbackSubmitHoursTotal = useMemo(() => {
    let s = 0
    if (feedbackShowSelfSection) {
      s += Number(fbSelfHours ?? 0)
    }
    for (const eid of fbExtraEmployeeIds) {
      s += Number(fbExtraHours[eid] ?? 0)
    }
    return s
  }, [
    feedbackShowSelfSection,
    fbSelfHours,
    fbExtraEmployeeIds,
    fbExtraHours,
  ])

  const registeredTxHoursOnWo = useMemo(
    () => woTxList.reduce((acc, r) => acc + Number(r.hours ?? 0), 0),
    [woTxList],
  )

  const feedbackDoneBlockedByTrr = useMemo(
    () =>
      woRequireTimeRegistrationForDone &&
      registeredTxHoursOnWo + feedbackSubmitHoursTotal <= 0,
    [
      woRequireTimeRegistrationForDone,
      registeredTxHoursOnWo,
      feedbackSubmitHoursTotal,
    ],
  )

  useEffect(() => {
    if (!dialogOpen || !editingId || feedbackTabIdx < 0) return
    if (dialogTab !== feedbackTabIdx) return
    void loadWoTransactions(editingId)
  }, [dialogOpen, dialogTab, editingId, feedbackTabIdx, loadWoTransactions])

  useEffect(() => {
    if (fbTargetStatus === 'done' && feedbackDoneBlockedByTrr) {
      setFbTargetStatus('')
    }
  }, [fbTargetStatus, feedbackDoneBlockedByTrr])

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
      setRows((prev) => prev.map((w) => (w.id === row.id ? data.work_order : w)))
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

  async function submitFeedbackForm(rowOverride?: WorkOrder | null) {
    if (!editingId) return
    const row = rowOverride ?? editingRowForFeedback
    if (!row) return
    const entries: {
      employee_id: string
      feedback_text: string
      hours: number
    }[] = []
    const selfId = currentEmployeeId
    const selfAssigned =
      !!selfId && (row.assigned_employee_ids ?? []).includes(selfId)
    const showSelfFeedback =
      !!selfId && (selfAssigned || !woStartRequiresAssignment)
    if (showSelfFeedback) {
      const text = fbSelfText.trim()
      const h = fbSelfHours ?? 0
      if (text.length > 0 || h > 0) {
        entries.push({
          employee_id: selfId,
          feedback_text: text,
          hours: h,
        })
      }
    }
    for (const eid of fbExtraEmployeeIds) {
      const text = (fbExtraText[eid] ?? '').trim()
      const h = Number(fbExtraHours[eid] ?? 0)
      if (text.length > 0 || h > 0) {
        entries.push({
          employee_id: eid,
          feedback_text: text,
          hours: h,
        })
      }
    }
    if (entries.length === 0) {
      showError(t('wo.feedback_entries_required'))
      return
    }
    if (fbTargetStatus === 'on_hold' && !fbHoldReason.trim()) {
      showError(t('wo.hold_reason_required'))
      return
    }
    if (fbTargetStatus === 'done' && feedbackDoneBlockedByTrr) {
      showError(t('wo.feedback_done_requires_time'))
      return
    }
    setFbSaving(true)
    try {
      const body: Record<string, unknown> = { entries }
      if (fbTargetStatus === 'on_hold') {
        body.target_status = 'on_hold'
        body.hold_reason = fbHoldReason.trim()
      } else if (fbTargetStatus === 'done') {
        body.target_status = 'done'
      }
      const data = await apiJson<WorkOrderResponse>(
        `/api/work-orders/${encodeURIComponent(editingId)}/actions/feedback`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      setRows((prev) =>
        prev.map((w) => (w.id === editingId ? data.work_order : w)),
      )
      setSelected((cur) =>
        cur?.id === editingId ? data.work_order : cur,
      )
      flashMonitoringWorkOrderRow(data.work_order.id)
      flashMonitoringChangedFields(row, data.work_order)
      showSuccess(t('wo.updated'))
      resetFeedbackForm()
      await loadWoTransactions(editingId)
    } catch (e) {
      if (e instanceof ApiError) {
        const code =
          typeof e.body === 'object' &&
          e.body !== null &&
          'code' in e.body
            ? (e.body as { code?: string }).code
            : undefined
        if (code === WO_FEEDBACK_DONE_REQUIRES_TIME_CODE) {
          showError(t('wo.feedback_done_requires_time'))
        } else {
          showError(e.message)
        }
      } else {
        showError(t('wo.save_fail'))
      }
    } finally {
      setFbSaving(false)
    }
  }

  type SaveWorkOrderOk =
    | { ok: true; workOrder?: WorkOrder }
    | { ok: false }

  async function saveWorkOrder(options?: {
    keepOpen?: boolean
    skipSuccessToast?: boolean
  }): Promise<SaveWorkOrderOk> {
    const shortText = formShortText.trim()
    const instruction = formInstruction.trim()
    if (!shortText) {
      showError(t('wo.err_short_text'))
      return { ok: false }
    }
    if (!instruction) {
      showError(t('wo.err_instruction'))
      return { ok: false }
    }
    if (instruction.length > 2000) {
      showError(t('wo.err_instruction_len'))
      return { ok: false }
    }
    if (!formAssetId) {
      showError(t('wo.err_asset'))
      return { ok: false }
    }
    if (formWorktime == null || formWorktime < 0 || !Number.isFinite(formWorktime)) {
      showError(t('wo.err_worktime'))
      return { ok: false }
    }
    if (
      formDurationHours == null ||
      !Number.isFinite(formDurationHours) ||
      formDurationHours < 0
    ) {
      showError(t('wp.err_duration'))
      return { ok: false }
    }

    const resolvedWorkTypeId = linkedToWorkPlan
      ? pmWorkTypeIdForSite
      : formWorkTypeId
    if (!resolvedWorkTypeId) {
      showError(t('wo.err_work_type'))
      return { ok: false }
    }
    if (!formWorkgroupId) {
      showError(t('wo.err_workgroup'))
      return { ok: false }
    }

    if (
      !woLockEndDateByDuration &&
      formPlanStart &&
      formPlanEnd &&
      formPlanEnd.getTime() < formPlanStart.getTime()
    ) {
      showError(t('wo.err_plan_end_before_start'))
      return { ok: false }
    }

    const body: Record<string, unknown> = {
      short_text: shortText.slice(0, 200),
      asset_id: formAssetId,
      instruction_text: instruction,
      worktime: formWorktime,
      work_type_id: resolvedWorkTypeId,
      plan_start: formPlanStart ? formPlanStart.toISOString() : null,
      duration: formDurationHours,
      category_id: formCategoryId,
      workgroup_id: formWorkgroupId,
    }
    if (!woLockEndDateByDuration) {
      if (editingId) {
        body.plan_end = formPlanEnd ? formPlanEnd.toISOString() : null
      } else if (formPlanEnd != null) {
        body.plan_end = formPlanEnd.toISOString()
      }
    }
    if (!editingId) {
      const wi = workInstructionsForCreateBody(formWorkInstructions)
      if (wi.length > 0) body.work_instructions = wi
    }

    setSaving(true)
    try {
      if (editingId) {
        const before = rows.find((w) => w.id === editingId) ?? null
        const data = await apiJson<WorkOrderResponse>(
          `/api/work-orders/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setRows((prev) =>
          prev.map((w) => (w.id === editingId ? data.work_order : w)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.work_order : cur,
        )
        flashMonitoringWorkOrderRow(data.work_order.id)
        flashMonitoringChangedFields(before, data.work_order)
        if (!options?.skipSuccessToast) {
          showSuccess(t('wo.updated'))
        }
        if (!options?.keepOpen) {
          setDialogOpen(false)
        }
        return { ok: true, workOrder: data.work_order }
      } else {
        const data = await apiJson<WorkOrderResponse>('/api/work-orders', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) => {
          const map = new Map(prev.map((w) => [w.id, w]))
          map.set(data.work_order.id, data.work_order)
          return sortedWorkOrders([...map.values()])
        })
        markMonitoringCreatedRow(data.work_order.id)
        setSelected(data.work_order)
        setDialogOpen(false)
        showSuccess(t('wo.created'))
        return { ok: true }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.save_fail'))
      }
      return { ok: false }
    } finally {
      setSaving(false)
    }
  }

  async function saveAndSubmitFeedback() {
    const saveResult = await saveWorkOrder({
      keepOpen: true,
      skipSuccessToast: true,
    })
    if (!saveResult.ok || !saveResult.workOrder) return
    await submitFeedbackForm(saveResult.workOrder)
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
        worktime: 1,
        work_type_id: workTypeId,
        workgroup_id: workgroupId,
        category_id: categoriesForSite[0]?.id ?? null,
        plan_start: now.toISOString(),
        duration: 1,
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
        prev.map((w) => (w.id === employeeAssignWoId ? data.work_order : w)),
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
    ...buildCrudContextMenuModel(
      {
        onCreate: openCreate,
        onEdit: () => {
          if (selected && !selectedIsDeleting) openEdit(selected)
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
      <Dialog
        header={t('wo.employee_assignment_title')}
        visible={employeeAssignOpen}
        onHide={closeEmployeeAssignmentDialog}
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
      </Dialog>

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
                    onClick={() => selected && openEdit(selected)}
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
                  openEdit(row)
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
                    openEdit(row)
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

      <Dialog
        header={
          editingId ? t('wo.dialog_edit') : t('wo.dialog_new')
        }
        visible={dialogOpen}
        onHide={() => {
          if (saving || fbSaving) return
          workOrderInstructionsFetchForIdRef.current = null
          setAssetPickerOpen(false)
          setDialogOpen(false)
        }}
        dismissableMask={!(saving || fbSaving)}
        className="work-order-dialog"
        style={{ width: 'min(92rem, 98vw)' }}
        breakpoints={{ '1280px': '98vw', '960px': '96vw', '640px': '100vw' }}
        footer={
          <div className="flex justify-content-end gap-2 flex-wrap">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              onClick={() => setDialogOpen(false)}
              disabled={saving || fbSaving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveWorkOrder()}
              loading={saving}
              disabled={saving || fbSaving}
            />
            {editingId &&
            feedbackTabIdx >= 0 &&
            dialogTab === feedbackTabIdx ? (
              <Button
                type="button"
                label={t('wo.feedback_save_and_submit')}
                icon="pi pi-check"
                onClick={() => void saveAndSubmitFeedback()}
                loading={saving || fbSaving}
                disabled={saving || fbSaving}
              />
            ) : null}
          </div>
        }
      >
        <TabView
          className="app-modal-tabview"
          activeIndex={dialogTab}
          onTabChange={(e) => setDialogTab(e.index)}
        >
          <TabPanel header={t('wo.tab_general')}>
            <div className="app-modal-tab-content grid pt-2 gap-3">
              {!editingId ? (
                <div className="col-12">
                  <VoiceAssistPanel
                    kind="work_order"
                    disabled={saving}
                    context={{
                      assets: assetsForWoVoice.map((a) => ({
                        id: a.id,
                        key: a.key,
                        name: a.name,
                      })),
                      work_types: workTypesForSite.map((wt) => ({
                        id: wt.id,
                        key: wt.key,
                        name: wt.name,
                      })),
                      workgroups: workgroupsForSite.map((wg) => ({
                        id: wg.id,
                        key: wg.key,
                        name: wg.name,
                      })),
                      categories: categoriesForSite.map((c) => ({
                        id: c.id,
                        key: c.key,
                        name: c.name,
                      })),
                    }}
                    onApplyValidated={applyAiWoDraft}
                    onError={showError}
                  />
                </div>
              ) : null}
              {editingId ? (
                <div className="col-12 sm:col-4 lg:col-2 flex flex-column gap-2">
                  <span className="text-sm font-medium">{t('wo.col_key')}</span>
                  <InputText
                    value={String(
                      rows.find((w) => w.id === editingId)?.wo_key ?? '',
                    )}
                    className="w-full"
                    disabled
                  />
                </div>
              ) : null}
              <div
                className={
                  editingId
                    ? 'col-12 sm:col-8 lg:col-10 flex flex-column gap-2'
                    : 'col-12 flex flex-column gap-2'
                }
              >
                <label htmlFor="wo-short" className="text-sm font-medium">
                  {t('wo.col_short_text')}
                </label>
                <InputText
                  id="wo-short"
                  value={formShortText}
                  onChange={(e) => setFormShortText(e.target.value)}
                  className="w-full"
                  disabled={saving}
                  maxLength={200}
                  autoComplete="off"
                />
              </div>
              <div className="col-12">
                <div className="flex flex-column md:flex-row md:align-items-start gap-3">
                  <div className="flex flex-column gap-2 flex-1 min-w-0 w-full md:w-auto">
                    <label htmlFor="wo-asset" className="text-sm font-medium">
                      {t('wo.col_asset')}
                    </label>
                    <SelItemField
                      id="wo-asset"
                      valueLabel={assetDisplayLabel}
                      placeholder={t('wo.placeholder_select_asset')}
                      disabled={saving}
                      sidebarVisible={assetPickerOpen}
                      onSidebarHide={() => setAssetPickerOpen(false)}
                      onOpenSidebar={() => setAssetPickerOpen(true)}
                      triggerAriaLabel={t('wo.trigger_choose_asset')}
                      showClear={!!formAssetId}
                      onClear={() => {
                        setFormAssetId(null)
                        setPickedAsset(null)
                      }}
                      sidebarHeader={t('wo.sidebar_select_asset')}
                    >
                      {assetPickerOpen ? (
                        <AssetPickerSidebarContent
                          onHide={() => setAssetPickerOpen(false)}
                          onSelect={(asset) => {
                            setFormAssetId(asset.id)
                            setPickedAsset(asset)
                            setAssetPickerOpen(false)
                          }}
                          onError={showError}
                        />
                      ) : null}
                    </SelItemField>
                  </div>
                  <div className="flex flex-column gap-2 flex-1 min-w-0 w-full md:w-auto">
                    <span className="text-sm font-medium">
                      {t('wo.col_cost_center')}
                    </span>
                    <InputText
                      value={costCenterHint}
                      className="w-full"
                      disabled
                    />
                    <span className="text-xs text-color-secondary">
                      {t('wo.cost_center_from_asset')}
                    </span>
                  </div>
                </div>
              </div>
              {editingId && editingWo && workOrderHasLinkedPlan(editingWo) ? (
                <div className="col-12 md:col-6 xl:col-4 flex flex-column gap-2">
                  <span className="text-sm font-medium">
                    {t('wo.field_work_plan')}
                  </span>
                  <InputText
                    value={editingWo.work_plan_key?.trim() ? editingWo.work_plan_key : emDash}
                    className="w-full"
                    disabled
                  />
                </div>
              ) : null}
              <div className="col-12 md:col-6 xl:col-4 flex flex-column gap-2">
                <label htmlFor="wo-type" className="text-sm font-medium">
                  {t('wo.field_wo_type')}
                </label>
                <Dropdown
                  id="wo-type"
                  value={
                    linkedToWorkPlan ? pmWorkTypeIdForSite : formWorkTypeId
                  }
                  onChange={(e) =>
                    setFormWorkTypeId((e.value as string) ?? null)
                  }
                  options={workTypeDropdownOptions}
                  optionLabel="label"
                  optionValue="value"
                  className="w-full"
                  disabled={
                    saving || linkedToWorkPlan || workTypeDropdownOptions.length === 0
                  }
                />
              </div>
              <div className="col-12 md:col-6 xl:col-4 flex flex-column gap-2">
                <label htmlFor="wo-category" className="text-sm font-medium">
                  {t('wo.field_category')}
                </label>
                <Dropdown
                  id="wo-category"
                  value={formCategoryId}
                  onChange={(e) =>
                    setFormCategoryId((e.value as string | null) ?? null)
                  }
                  options={categoryDropdownOptions}
                  optionLabel="label"
                  optionValue="value"
                  className="w-full"
                  disabled={saving}
                />
              </div>
              <div className="col-12 md:col-6 xl:col-4 flex flex-column gap-2">
                <label htmlFor="wo-worktime" className="text-sm font-medium">
                  {t('wo.label_worktime_hours')}
                </label>
                <InputNumber
                  id="wo-worktime"
                  value={formWorktime}
                  onValueChange={(e) => setFormWorktime(e.value ?? null)}
                  min={0}
                  minFractionDigits={0}
                  maxFractionDigits={2}
                  className="w-full"
                  inputClassName="w-full min-w-0"
                  disabled={saving}
                />
              </div>
              <div className="col-12 md:col-12 xl:col-4 flex flex-column gap-2">
                <span className="text-sm font-medium">{t('wo.col_status')}</span>
                {formStatusTag(formStatus, t, woStatusMergedColours)}
                <span className="text-xs text-color-secondary">
                  {t('wo.status_not_editable')}
                </span>
              </div>
              <div className="col-12 flex flex-column gap-2">
                <label htmlFor="wo-instruction" className="text-sm font-medium">
                  {t('common.col_instruction')}
                </label>
                <InputTextarea
                  id="wo-instruction"
                  value={formInstruction}
                  onChange={(e) => setFormInstruction(e.target.value)}
                  className="w-full"
                  rows={5}
                  disabled={saving}
                  maxLength={2000}
                  autoResize
                />
              </div>
            </div>
          </TabPanel>
          <TabPanel header={t('wo.tab_instructions')}>
            <WorkInstructionsTab
              variant="wo"
              parentId={editingId}
              rows={formWorkInstructions}
              setRows={setFormWorkInstructions}
              disabled={saving}
              reportError={showError}
              t={t}
            />
          </TabPanel>
          {linkedToWorkPlan ? (
            <TabPanel header={t('wo.tab_work_plan')}>
              <div className="app-modal-tab-content grid pt-2 gap-3">
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <span className="text-sm font-medium">
                    {t('wp.field_interval_count')}
                  </span>
                  <InputText
                    value={workPlanTabIntervalCount}
                    className="w-full"
                    disabled
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <span className="text-sm font-medium">
                    {t('wp.field_interval_type')}
                  </span>
                  <InputText
                    value={workPlanTabIntervalType}
                    className="w-full"
                    disabled
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <span className="text-sm font-medium">
                    {t('wp.field_next_due')}
                  </span>
                  <InputText
                    value={workPlanTabNextDue}
                    className="w-full"
                    disabled
                  />
                </div>
                <div className="col-12 flex flex-column gap-2">
                  <Button
                    type="button"
                    label={t('wo.open_wp')}
                    icon="pi pi-external-link"
                    outlined
                    onClick={() => {
                      const id = editingWo?.work_plan_id
                      if (!id) return
                      setDialogOpen(false)
                      navigate(
                        `/work-planning?workPlanId=${encodeURIComponent(id)}`,
                      )
                    }}
                  />
                </div>
              </div>
            </TabPanel>
          ) : null}
          <TabPanel header={t('wo.tab_planning')}>
            <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
              <div className="grid">
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label
                    htmlFor="wo-workgroup"
                    className="text-sm font-medium"
                  >
                    {t('wo.field_workgroup')}
                  </label>
                  <Dropdown
                    id="wo-workgroup"
                    value={formWorkgroupId}
                    options={workgroupDropdownOptions}
                    onChange={(e) => setFormWorkgroupId(e.value as string | null)}
                    className="w-full"
                    disabled={saving || workgroupDropdownOptions.length === 0}
                    placeholder={t('wo.field_workgroup')}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label
                    htmlFor="wo-plan-start"
                    className="text-sm font-medium"
                  >
                    {t('wo.col_plan_start')}
                  </label>
                  <Calendar
                    id="wo-plan-start"
                    value={formPlanStart}
                    onChange={(e) => {
                      const v = e.value as Date | null
                      setFormPlanStart(v)
                      if (!v) setFormPlanEnd(null)
                    }}
                    showTime
                    hourFormat="24"
                    showIcon
                    showButtonBar
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                    minDate={planStartCalendarMinDate}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label
                    htmlFor="wo-duration"
                    className="text-sm font-medium"
                  >
                    {t('wo.field_duration_hours')}
                  </label>
                  <InputNumber
                    id="wo-duration"
                    value={formDurationHours}
                    onValueChange={(e) =>
                      setFormDurationHours(e.value ?? null)
                    }
                    min={0}
                    minFractionDigits={0}
                    maxFractionDigits={2}
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label
                    htmlFor="wo-plan-end"
                    className="text-sm font-medium"
                  >
                    {t('wo.field_plan_end')}
                  </label>
                  {woLockEndDateByDuration ? (
                    <>
                      <InputText
                        id="wo-plan-end"
                        value={planEndDisplayLocked}
                        className="w-full"
                        disabled
                      />
                      <span className="text-xs text-color-secondary">
                        {t('wo.col_plan_start')} +{' '}
                        {t('wo.field_duration_hours')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Calendar
                        id="wo-plan-end"
                        value={formPlanEnd}
                        onChange={(e) =>
                          setFormPlanEnd(e.value as Date | null)
                        }
                        showTime
                        hourFormat="24"
                        showIcon
                        showButtonBar
                        className="w-full"
                        inputClassName="w-full min-w-0"
                        disabled={saving}
                        minDate={formPlanStart ?? undefined}
                      />
                      <span className="text-xs text-color-secondary">
                        {t('wo.plan_end_free_hint')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </TabPanel>
          {editingId ? (
            <TabPanel header={t('wo.tab_feedback')}>
              <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
                    <div className="grid">
                      {currentEmployeeId &&
                      ((editingRowForFeedback?.assigned_employee_ids ?? []).includes(
                        currentEmployeeId,
                      ) ||
                        !woStartRequiresAssignment) ? (
                        <div className="col-12 md:col-6 flex flex-column gap-2">
                          <span className="text-sm font-medium">
                            {t('wo.feedback_self_section')}
                          </span>
                          <label className="text-xs text-color-secondary">
                            {t('wo.feedback_text')}
                          </label>
                          <InputTextarea
                            value={fbSelfText}
                            onChange={(e) => setFbSelfText(e.target.value)}
                            rows={3}
                            className="w-full"
                            disabled={fbSaving}
                          />
                          <label className="text-xs text-color-secondary">
                            {t('wo.feedback_hours')}
                          </label>
                          <InputNumber
                            value={fbSelfHours}
                            onValueChange={(e) => setFbSelfHours(e.value ?? 0)}
                            min={0}
                            maxFractionDigits={2}
                            className="w-full"
                            inputClassName="w-full min-w-0"
                            disabled={fbSaving}
                          />
                        </div>
                      ) : null}
                      <div className="col-12 md:col-6 flex flex-column gap-2">
                        <label className="text-sm font-medium">
                          {t('wo.feedback_additional_employees')}
                        </label>
                        <MultiSelect
                          value={fbExtraEmployeeIds}
                          onChange={(e) => {
                            const ids = (e.value as string[]) ?? []
                            setFbExtraEmployeeIds(ids)
                            setFbExtraText((prev) => {
                              const next: Record<string, string> = {}
                              for (const id of ids) {
                                next[id] = prev[id] ?? ''
                              }
                              return next
                            })
                            setFbExtraHours((prev) => {
                              const next: Record<string, number | null> = {}
                              for (const id of ids) {
                                next[id] = prev[id] ?? 0
                              }
                              return next
                            })
                          }}
                          options={fbExtraEmployeeOptions}
                          optionLabel="label"
                          optionValue="value"
                          display="chip"
                          className="w-full"
                          disabled={
                            fbSaving || fbExtraEmployeeOptions.length === 0
                          }
                          placeholder={t('common.search_ellipsis')}
                        />
                        {fbExtraEmployeeIds.map((eid) => (
                          <div
                            key={eid}
                            className="flex flex-column gap-2 border-200 border-1 border-round p-2"
                          >
                            <span className="text-sm font-medium">
                              {fbExtraEmployeeOptions.find((o) => o.value === eid)
                                ?.label ?? eid}
                            </span>
                            <InputTextarea
                              value={fbExtraText[eid] ?? ''}
                              onChange={(e) =>
                                setFbExtraText((prev) => ({
                                  ...prev,
                                  [eid]: e.target.value,
                                }))
                              }
                              rows={2}
                              className="w-full"
                              disabled={fbSaving}
                              placeholder={t('wo.feedback_text')}
                            />
                            <InputNumber
                              value={fbExtraHours[eid] ?? 0}
                              onValueChange={(e) =>
                                setFbExtraHours((prev) => ({
                                  ...prev,
                                  [eid]: e.value ?? 0,
                                }))
                              }
                              min={0}
                              maxFractionDigits={2}
                              className="w-full"
                              inputClassName="w-full min-w-0"
                              disabled={fbSaving}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="col-12 md:col-6 flex flex-column gap-2">
                        <label className="text-sm font-medium">
                          {t('wo.feedback_target_status')}
                        </label>
                        <Dropdown
                          value={fbTargetStatus}
                          options={[
                            {
                              value: '',
                              label: t('wo.feedback_status_no_change'),
                            },
                            {
                              value: 'on_hold',
                              label: t(WO_STATUS_I18N_KEYS.on_hold),
                            },
                            {
                              value: 'done',
                              label: t(WO_STATUS_I18N_KEYS.done),
                              disabled: feedbackDoneBlockedByTrr,
                            },
                          ]}
                          onChange={(e) =>
                            setFbTargetStatus(
                              (e.value as '' | 'on_hold' | 'done') ?? '',
                            )
                          }
                          optionLabel="label"
                          optionValue="value"
                          className="w-full"
                          disabled={fbSaving}
                        />
                      </div>
                      {fbTargetStatus === 'on_hold' ? (
                        <div className="col-12 flex flex-column gap-2">
                          <label className="text-sm font-medium">
                            {t('wo.hold_reason_label')}
                          </label>
                          <InputTextarea
                            value={fbHoldReason}
                            onChange={(e) => setFbHoldReason(e.target.value)}
                            rows={3}
                            className="w-full"
                            disabled={fbSaving}
                          />
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      label={t('wo.feedback_submit')}
                      icon="pi pi-check"
                      onClick={() => void submitFeedbackForm()}
                      loading={fbSaving}
                    />
                <h3 className="text-sm font-medium mt-3 mb-0">
                  {t('transactions.title')}
                </h3>
                {woTxLoading ? (
                  <p className="text-sm text-color-secondary m-0">
                    {t('common.loading')}
                  </p>
                ) : (
                  <DataTable
                    value={woTxList}
                    dataKey="id"
                    size="small"
                    emptyMessage={emDash}
                  >
                    <Column
                      field="created_at"
                      header={t('transactions.col_created_at')}
                      body={(r: WoTransactionRow) =>
                        formatDateTime(r.created_at)
                      }
                    />
                    <Column
                      field="employee_key"
                      header={t('transactions.col_employee')}
                      body={(r: WoTransactionRow) =>
                        `${r.employee_key} ${emDash} ${r.employee_name}`
                      }
                    />
                    <Column
                      field="hours"
                      header={t('transactions.col_hours')}
                    />
                    <Column
                      field="feedback_text"
                      header={t('transactions.col_feedback')}
                      style={{ maxWidth: '24rem' }}
                    />
                    <Column
                      field="created_by_login_name"
                      header={t('common.col_created_by')}
                      body={(r: WoTransactionRow) =>
                        r.created_by_login_name ?? emDash
                      }
                    />
                  </DataTable>
                )}
              </div>
            </TabPanel>
          ) : null}
        </TabView>
      </Dialog>

      <Dialog
        header={t('wo.hold_dialog_title')}
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
      </Dialog>
    </AppShell>
  )
}

export default function WorkOrdersAppPage() {
  return <WorkOrdersPage mode="work-orders" />
}
