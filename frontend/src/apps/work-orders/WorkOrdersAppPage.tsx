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
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { TabView, TabPanel } from 'primereact/tabview'
import { ApiError, apiBase, apiJson } from '../../api'
import { getStoredUser, getToken } from '../../auth'
import { useRegisterCreateShortcut } from '../../layout/AppCreateShortcut'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../../layout/crudContextMenuItems'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
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
  work_instruction_count?: number
  work_instruction_done_count?: number
}

type WorkOrdersListResponse = { work_orders: WorkOrder[] }
type WorkOrderResponse = { work_order: WorkOrder }
type WorkTypesListResponse = { work_types: WorkType[] }
type CategoriesListResponse = { categories: Category[] }
type WorkgroupsListResponse = { workgroups: Workgroup[] }

const WO_STATUS_I18N_KEYS: Record<string, string> = {
  open: 'wo.status_open',
  assigned: 'wo.status_assigned',
  started: 'wo.status_started',
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

function statusSeverity(
  s: string,
): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | null {
  switch (s) {
    case 'open':
      return 'info'
    case 'assigned':
      return 'secondary'
    case 'started':
      return 'warning'
    case 'on_hold':
      return 'warning'
    case 'done':
      return 'success'
    case 'closed':
      return 'contrast'
    default:
      return null
  }
}

function statusBody(row: WorkOrder, t: TFunction) {
  const k = WO_STATUS_I18N_KEYS[row.status]
  const label = k ? t(k) : row.status
  return (
    <Tag value={label} severity={statusSeverity(row.status) ?? undefined} />
  )
}

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

export default function WorkOrdersAppPage() {
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formShortText, setFormShortText] = useState('')
  const [formAssetId, setFormAssetId] = useState<string | null>(null)
  const [formInstruction, setFormInstruction] = useState('')
  const [formPlanStart, setFormPlanStart] = useState<Date | null>(null)
  const [formDurationHours, setFormDurationHours] = useState<number | null>(0)
  const [formWorktime, setFormWorktime] = useState<number | null>(null)
  const [formWorkTypeId, setFormWorkTypeId] = useState<string | null>(null)
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null)
  const [formWorkgroupId, setFormWorkgroupId] = useState<string | null>(null)
  const [formStatus, setFormStatus] = useState('open')
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([])
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [selected, setSelected] = useState<WorkOrder | null>(null)
  const [search, setSearch] = useState('')
  const [flashRowIds, setFlashRowIds] = useState(() => new Set<string>())
  const [dialogTab, setDialogTab] = useState(0)
  const [formWorkInstructions, setFormWorkInstructions] = useState<
    FormWorkInstruction[]
  >([])
  const [instructionViewOpen, setInstructionViewOpen] = useState(false)
  const [instructionViewWoId, setInstructionViewWoId] = useState<string | null>(
    null,
  )

  const cardSubTitle = useMemo(() => {
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
  }, [workOrderIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (workOrderIdParam) {
      list = list.filter((w) => w.id === workOrderIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((w) => {
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
    })
  }, [rows, search, workOrderIdParam, t])

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

  const queueRowFlash = useCallback((id: string) => {
    setFlashRowIds((prev) => {
      const n = new Set(prev)
      n.add(id)
      return n
    })
    window.setTimeout(() => {
      setFlashRowIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }, 2200)
  }, [])

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
          const data = JSON.parse(ev.data as string) as {
            type?: string
            work_order?: WorkOrder
          }
          if (data.type !== 'work_order_created' || !data.work_order?.id) {
            return
          }
          const wo = data.work_order as WorkOrder
          setRows((prev) => {
            const map = new Map(prev.map((w) => [w.id, w]))
            map.set(wo.id, wo)
            return [...map.values()].sort((a, b) => b.wo_key - a.wo_key)
          })
          queueRowFlash(wo.id)
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
  }, [queueRowFlash])

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

  const planEndDisplay = planEndPreview
    ? formatDateTime(planEndPreview.toISOString())
    : emDash

  const linkedToWorkPlan = Boolean(editingWo?.work_plan_id)

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
    setSelected(null)
    setEditingId(null)
    setFormShortText('')
    setFormAssetId(null)
    setPickedAsset(null)
    setFormInstruction('')
    setFormPlanStart(null)
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

  async function openEdit(row: WorkOrder) {
    setEditingId(row.id)
    setFormShortText(row.short_text)
    setFormAssetId(row.asset_id)
    setPickedAsset(null)
    setFormInstruction(row.instruction_text)
    setFormPlanStart(row.plan_start ? new Date(row.plan_start) : null)
    setFormDurationHours(Number(row.duration ?? '0'))
    setFormWorktime(parseWorktimeNum(row.worktime))
    setFormWorkTypeId(row.work_type_id)
    setFormCategoryId(row.category_id ?? null)
    setFormWorkgroupId(row.workgroup_id)
    setFormStatus(row.status)
    setAssetPickerOpen(false)
    setDialogTab(0)
    try {
      const data = await apiJson<WorkOrderResponse>(
        `/api/work-orders/${encodeURIComponent(row.id)}`,
      )
      setFormWorkInstructions(
        workInstructionsFromApi(data.work_order.work_instructions ?? []),
      )
    } catch {
      setFormWorkInstructions(
        row.work_instructions?.length
          ? workInstructionsFromApi(row.work_instructions)
          : [],
      )
    }
    setDialogOpen(true)
  }

  async function saveWorkOrder() {
    const shortText = formShortText.trim()
    const instruction = formInstruction.trim()
    if (!shortText) {
      showError(t('wo.err_short_text'))
      return
    }
    if (!instruction) {
      showError(t('wo.err_instruction'))
      return
    }
    if (instruction.length > 2000) {
      showError(t('wo.err_instruction_len'))
      return
    }
    if (!formAssetId) {
      showError(t('wo.err_asset'))
      return
    }
    if (formWorktime == null || formWorktime < 0 || !Number.isFinite(formWorktime)) {
      showError(t('wo.err_worktime'))
      return
    }
    if (
      formDurationHours == null ||
      !Number.isFinite(formDurationHours) ||
      formDurationHours < 0
    ) {
      showError(t('wp.err_duration'))
      return
    }

    const resolvedWorkTypeId = linkedToWorkPlan
      ? pmWorkTypeIdForSite
      : formWorkTypeId
    if (!resolvedWorkTypeId) {
      showError(t('wo.err_work_type'))
      return
    }
    if (!formWorkgroupId) {
      showError(t('wo.err_workgroup'))
      return
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
    if (!editingId) {
      const wi = workInstructionsForCreateBody(formWorkInstructions)
      if (wi.length > 0) body.work_instructions = wi
    }

    setSaving(true)
    try {
      if (editingId) {
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
        showSuccess(t('wo.updated'))
        setDialogOpen(false)
      } else {
        await apiJson<WorkOrderResponse>('/api/work-orders', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setDialogOpen(false)
        await loadWorkOrders()
        showSuccess(t('wo.created'))
      }
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.save_fail'))
      }
    } finally {
      setSaving(false)
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
      setRows((prev) => prev.filter((w) => w.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('wo.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.delete_fail'))
      }
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'

  const auditResourceIdForMenu = workOrderIdParam || selected?.id || ''

  const crudContextMenuItems: MenuItem[] = [
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
              `/audit-log?resource_type=work_order&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
            ),
        },
      },
    ),
  ]

  const workOrdersCardHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-file-edit text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('work_orders.title')}</h1>
        <p className="app-card-hero-desc">{cardSubTitle}</p>
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

      <div className="p-4 w-full max-w-none flex flex-column gap-3">
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
              className="work-orders-table"
              value={filteredRows}
              loading={loading}
              dataKey="id"
              selection={selected}
              tableStyle={{ minWidth: '96rem', width: 'max-content' }}
              onSelectionChange={(e) => setSelected(e.value as WorkOrder | null)}
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
              rowClassName={(row) =>
                flashRowIds.has((row as WorkOrder).id) ? 'wo-row--flash' : ''
              }
            >
              <Column
                field="wo_key"
                header={t('wo.col_key')}
                sortable
                style={{ minWidth: '5rem' }}
              />
              <Column
                field="short_text"
                header={t('wo.col_short_text')}
                sortable
                style={{ minWidth: '16rem' }}
              />
              {isAdmin ? (
                <Column
                  field="site_key"
                  header={t('common.col_site')}
                  sortable
                  style={{ minWidth: '17rem' }}
                  body={(row: WorkOrder) => siteColumnBody(row, t)}
                />
              ) : null}
              <Column
                header={t('wo.col_asset')}
                sortable
                sortField="asset_key"
                style={{ minWidth: '18rem' }}
                body={(row: WorkOrder) =>
                  `${row.asset_key} ${emDash} ${row.asset_name}`
                }
              />
              <Column
                header={t('wo.col_cost_center')}
                style={{ minWidth: '12rem' }}
                body={(row: WorkOrder) => {
                  const ck = row.costcenter_key ?? ''
                  const cn = row.costcenter_name ?? ''
                  if (!ck && !cn) return emDash
                  return `${ck} ${emDash} ${cn}`.trim()
                }}
              />
              <Column
                header={t('wo.col_workgroup')}
                sortable
                sortField="workgroup_key"
                style={{ minWidth: '12rem' }}
                body={(row: WorkOrder) => {
                  const k = row.workgroup_key?.trim() ?? ''
                  const n = row.workgroup_name?.trim() ?? ''
                  if (!k && !n) return emDash
                  if (k && n) return `${k} ${emDash} ${n}`
                  return k || n
                }}
              />
              <Column
                field="work_plan_key"
                header={t('wo.field_work_plan')}
                sortable
                style={{ minWidth: '10rem' }}
                body={(row: WorkOrder) => row.work_plan_key ?? emDash}
              />
              <Column
                header={t('wo.col_work_type')}
                sortable
                sortField="work_type_key"
                style={{ minWidth: '14rem' }}
                body={(row: WorkOrder) =>
                  workTypeColumnBody(row, emDash, workTypes)
                }
              />
              <Column
                header={t('wo.col_category')}
                sortable
                sortField="category_key"
                style={{ minWidth: '12rem' }}
                body={(row: WorkOrder) => {
                  const k = row.category_key?.trim() ?? ''
                  const n = row.category_name?.trim() ?? ''
                  if (!k && !n) return emDash
                  if (k && n) return `${k} ${emDash} ${n}`
                  return k || n
                }}
              />
              <Column
                header={t('wo.col_assignments')}
                style={{ minWidth: '9rem' }}
                body={(row: WorkOrder) => (
                  <WorkAssignmentsIcons
                    row={row}
                    t={t}
                    onAssignmentClick={(kind) => {
                      if (kind === 'instructions') {
                        setInstructionViewWoId(row.id)
                        setInstructionViewOpen(true)
                      }
                    }}
                  />
                )}
              />
              <Column
                field="plan_start"
                header={t('wo.col_plan_start')}
                sortable
                style={{ minWidth: '13rem' }}
                body={(row: WorkOrder) =>
                  row.plan_start ? formatDateTime(row.plan_start) : emDash
                }
              />
              <Column
                field="plan_end"
                header={t('wo.col_plan_end')}
                sortable
                style={{ minWidth: '13rem' }}
                body={(row: WorkOrder) =>
                  row.plan_end ? formatDateTime(row.plan_end) : emDash
                }
              />
              <Column
                field="worktime"
                header={t('wo.col_worktime_h')}
                sortable
                style={{ minWidth: '10.5rem' }}
                body={(row: WorkOrder) => parseWorktimeNum(row.worktime)}
              />
              <Column
                field="status"
                header={t('wo.col_status')}
                sortable
                style={{ minWidth: '8.5rem' }}
                body={(row: WorkOrder) => statusBody(row, t)}
              />
              <Column
                field="created_at"
                header={t('common.col_created_at')}
                sortable
                style={{ minWidth: '13.5rem' }}
                body={(row: WorkOrder) => formatDateTime(row.created_at)}
              />
              <Column
                field="created_by_login_name"
                header={t('common.col_created_by')}
                sortable
                style={{ minWidth: '10rem' }}
                body={(row: WorkOrder) => row.created_by_login_name ?? emDash}
              />
              <Column
                field="updated_at"
                header={t('common.col_updated_at')}
                sortable
                style={{ minWidth: '13.5rem' }}
                body={(row: WorkOrder) => formatDateTime(row.updated_at)}
              />
              <Column
                field="updated_by_login_name"
                header={t('common.col_updated_by')}
                sortable
                style={{ minWidth: '10rem' }}
                body={(row: WorkOrder) => row.updated_by_login_name ?? emDash}
              />
            </DataTable>
            </div>
          </div>
        </Card>
      </div>

      <Dialog
        header={
          editingId ? t('wo.dialog_edit') : t('wo.dialog_new')
        }
        visible={dialogOpen}
        onHide={() => {
          setAssetPickerOpen(false)
          setDialogOpen(false)
        }}
        dismissableMask={!saving}
        className="work-order-dialog"
        style={{ width: 'min(92rem, 98vw)' }}
        breakpoints={{ '1280px': '98vw', '960px': '96vw', '640px': '100vw' }}
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
              onClick={() => void saveWorkOrder()}
              loading={saving}
            />
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
              {editingId && editingWo?.work_plan_id ? (
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
                <Tag
                  value={
                    WO_STATUS_I18N_KEYS[formStatus]
                      ? t(WO_STATUS_I18N_KEYS[formStatus])
                      : formStatus
                  }
                  severity={statusSeverity(formStatus) ?? undefined}
                />
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
                    onChange={(e) =>
                      setFormPlanStart(e.value as Date | null)
                    }
                    showTime
                    hourFormat="24"
                    showIcon
                    showButtonBar
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
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
                  <span className="text-sm font-medium">
                    {t('wo.field_plan_end')}
                  </span>
                  <InputText
                    value={planEndDisplay}
                    className="w-full"
                    disabled
                  />
                  <span className="text-xs text-color-secondary">
                    {t('wo.col_plan_start')} + {t('wo.field_duration_hours')}
                  </span>
                </div>
              </div>
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
    </AppShell>
  )
}
