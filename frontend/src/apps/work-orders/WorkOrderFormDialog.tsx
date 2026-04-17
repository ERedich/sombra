import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { MultiSelect } from 'primereact/multiselect'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import {
  mergeDisplayStatusColours,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'
import type { WoMwEvent, WorkOrderMwSession } from '../../layout/workOrderMwTypes'
import {
  VoiceAssistPanel,
  type AiSuggestWoValidated,
} from '../../components/ai/VoiceAssistPanel'
import { AssetPickerSidebarContent } from '../../components/sel-item/AssetPickerSidebarContent'
import { SelItemField } from '../../components/sel-item/SelItemField'
import { formatDateTime } from '../../utils/dateTime'
import {
  WorkInstructionsTab,
  workInstructionsForCreateBody,
  workInstructionsFromApi,
  type FormWorkInstruction,
} from '../../components/work-instructions/WorkInstructionsTab'
import { WorkInstructionViewModal } from '../../components/work-instructions/WorkInstructionViewModal'
import type { Asset } from '../asset-management/assetTypes'
import type { Category } from '../categories/CategoriesAppPage'
import type { WorkType } from '../work-types/WorkTypesAppPage'
import type { Workgroup } from '../workgroups/WorkgroupsAppPage'
import type { WorkOrder } from './workOrderTypes'
import {
  WO_FEEDBACK_DONE_REQUIRES_TIME_CODE,
  WO_STATUS_I18N_KEYS,
  feedbackTabIndexForRow,
  workOrderHasLinkedPlan,
} from './workOrderFormShared'
import type { MwLayoutJsonWorkOrder } from '@sombra/shared'
import { useMwFormLayout } from '../../mw-templates/useMwFormLayout'
import { mwFieldStyle, tabFieldOrderMap } from './workOrderMwLayout'

type WorkOrderResponse = { work_order: WorkOrder }
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

export function WorkOrderFormDialog({
  session,
  onClose,
  onEvent,
}: {
  session: WorkOrderMwSession
  onClose: () => void
  onEvent: (e: WoMwEvent) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const emDash = t('common.em_dash')
  const toast = useRef<Toast>(null)

  const [dialogTab, setDialogTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailWorkOrder, setDetailWorkOrder] = useState<WorkOrder | null>(null)
  const [editFetchPending, setEditFetchPending] = useState(false)

  const [formShortText, setFormShortText] = useState('')
  const [formAssetId, setFormAssetId] = useState<string | null>(null)
  const [formInstruction, setFormInstruction] = useState('')
  const [formPlanStart, setFormPlanStart] = useState<Date | null>(null)
  const [formPlanEnd, setFormPlanEnd] = useState<Date | null>(null)
  const [formPlannedDurationHours, setFormPlannedDurationHours] = useState<
    number | null
  >(0)
  const [formWorkTypeId, setFormWorkTypeId] = useState<string | null>(null)
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null)
  const [formWorkgroupId, setFormWorkgroupId] = useState<string | null>(null)
  const [formStatus, setFormStatus] = useState('open')
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [formWorkInstructions, setFormWorkInstructions] = useState<
    FormWorkInstruction[]
  >([])
  const [woAiAssets, setWoAiAssets] = useState<Asset[]>([])
  const [instructionViewOpen, setInstructionViewOpen] = useState(false)
  const [instructionViewWoId, setInstructionViewWoId] = useState<string | null>(
    null,
  )

  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([])
  const [employeesForFilter, setEmployeesForFilter] = useState<
    { id: string; key: string; name: string }[]
  >([])

  const [woTxList, setWoTxList] = useState<WoTransactionRow[]>([])
  const [woTxLoading, setWoTxLoading] = useState(false)
  const [fbSelfText, setFbSelfText] = useState('')
  const [fbSelfHours, setFbSelfHours] = useState<number | null>(0)
  const [fbExtraEmployeeIds, setFbExtraEmployeeIds] = useState<string[]>([])
  const [fbExtraText, setFbExtraText] = useState<Record<string, string>>({})
  const [fbExtraHours, setFbExtraHours] = useState<Record<string, number | null>>(
    {},
  )
  const [fbTargetStatus, setFbTargetStatus] = useState<'' | 'on_hold' | 'done'>('')
  const [fbHoldReason, setFbHoldReason] = useState('')
  const [fbSaving, setFbSaving] = useState(false)
  const [feedbackPoolAvailable, setFeedbackPoolAvailable] = useState<
    WorkOrderEmployeePoolItemDto[]
  >([])

  const workOrderInstructionsFetchForIdRef = useRef<string | null>(null)

  const authUserSnapshot = getStoredUser()
  const currentEmployeeId = authUserSnapshot?.employee_id ?? null

  const [woStartRequiresAssignment, setWoStartRequiresAssignment] =
    useState(true)
  const [woUserAutoAssignOnStart, setWoUserAutoAssignOnStart] = useState(true)
  const [woLockEndDateByDuration, setWoLockEndDateByDuration] = useState(false)
  const [woAllowPlanStartInHistory, setWoAllowPlanStartInHistory] =
    useState(false)
  const [woRequireTimeRegistrationForDone, setWoRequireTimeRegistrationForDone] =
    useState(true)
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

  const loadWorkTypes = useCallback(async () => {
    try {
      const data = await apiJson<WorkTypesListResponse>('/api/work-types')
      setWorkTypes(data.work_types ?? [])
    } catch {
      setWorkTypes([])
    }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const data = await apiJson<CategoriesListResponse>('/api/categories')
      setCategories(data.categories ?? [])
    } catch {
      setCategories([])
    }
  }, [])

  const loadWorkgroups = useCallback(async () => {
    try {
      const data = await apiJson<WorkgroupsListResponse>('/api/workgroups')
      setWorkgroups(data.workgroups ?? [])
    } catch {
      setWorkgroups([])
    }
  }, [])

  const loadEmployeesForFilter = useCallback(async () => {
    try {
      const data = await apiJson<EmployeesListResponse>('/api/employees')
      setEmployeesForFilter(data.employees ?? [])
    } catch {
      setEmployeesForFilter([])
    }
  }, [])

  useEffect(() => {
    if (!session) return
    void loadWorkTypes()
    void loadCategories()
    void loadWorkgroups()
    void loadEmployeesForFilter()
  }, [session, loadWorkTypes, loadCategories, loadWorkgroups, loadEmployeesForFilter])

  const resetFeedbackForm = useCallback(() => {
    setFbSelfText('')
    setFbSelfHours(0)
    setFbExtraEmployeeIds([])
    setFbExtraText({})
    setFbExtraHours({})
    setFbTargetStatus('')
    setFbHoldReason('')
  }, [])

  const resetFormState = useCallback(() => {
    workOrderInstructionsFetchForIdRef.current = null
    setEditingId(null)
    setDetailWorkOrder(null)
    setEditFetchPending(false)
    setFormShortText('')
    setFormAssetId(null)
    setPickedAsset(null)
    setFormInstruction('')
    setFormPlanStart(null)
    setFormPlanEnd(null)
    setFormPlannedDurationHours(0)
    setFormWorkTypeId(null)
    setFormCategoryId(null)
    setFormWorkgroupId(null)
    setFormStatus('open')
    setAssetPickerOpen(false)
    setDialogTab(0)
    setFormWorkInstructions([])
    setWoTxList([])
    resetFeedbackForm()
    setInstructionViewOpen(false)
    setInstructionViewWoId(null)
  }, [resetFeedbackForm])

  const closeWorkOrderFormDialog = useCallback(() => {
    resetFormState()
    onClose()
  }, [onClose, resetFormState])

  const applyRowToForm = useCallback((r: WorkOrder, tabIndex: number) => {
    setEditingId(r.id)
    setDetailWorkOrder(r)
    setFormShortText(r.short_text)
    setFormAssetId(r.asset_id)
    setPickedAsset(null)
    setFormInstruction(r.instruction_text)
    setFormPlanStart(r.plan_start ? new Date(r.plan_start) : null)
    setFormPlanEnd(r.plan_end ? new Date(r.plan_end) : null)
    setFormPlannedDurationHours(Number(r.planned_duration ?? '0'))
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
  }, [resetFeedbackForm])

  const openCreateInternal = useCallback(() => {
    workOrderInstructionsFetchForIdRef.current = null
    setEditingId(null)
    setDetailWorkOrder(null)
    setEditFetchPending(false)
    setFormShortText('')
    setFormAssetId(null)
    setPickedAsset(null)
    setFormInstruction('')
    setFormPlanStart(null)
    setFormPlanEnd(null)
    setFormPlannedDurationHours(0)
    const ws = getStoredUser()?.working_site_id
    const list = ws ? workTypes.filter((wt) => wt.site_id === ws) : []
    const def = list.find((w) => w.key === 'CM')?.id ?? list[0]?.id ?? null
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
  }, [workTypes, workgroups])

  useEffect(() => {
    if (!session) {
      resetFormState()
      return
    }
    if (session.kind === 'create') {
      resetFormState()
      return
    }

    const id = session.workOrderId
    workOrderInstructionsFetchForIdRef.current = id

    if (!session.seedRow) {
      setEditFetchPending(true)
      void (async () => {
        try {
          const data = await apiJson<WorkOrderResponse>(
            `/api/work-orders/${encodeURIComponent(id)}`,
          )
          if (workOrderInstructionsFetchForIdRef.current !== id) return
          const wo = data.work_order
          const tab = session.initialTab ?? 0
          applyRowToForm(wo, tab)
        } catch {
          if (workOrderInstructionsFetchForIdRef.current !== id) return
          showError(t('wo.load_fail'))
          closeWorkOrderFormDialog()
        } finally {
          if (workOrderInstructionsFetchForIdRef.current === id) {
            setEditFetchPending(false)
          }
        }
      })()
      return
    }

    const row = session.seedRow
    const rowFeedbackIdx = feedbackTabIndexForRow(row)
    const openingToFeedbackTab =
      session.initialTab !== undefined &&
      session.initialTab === rowFeedbackIdx

    if (openingToFeedbackTab) {
      setEditFetchPending(false)
      void (async () => {
        try {
          const data = await apiJson<WorkOrderResponse>(
            `/api/work-orders/${encodeURIComponent(id)}`,
          )
          if (workOrderInstructionsFetchForIdRef.current !== id) return
          const wo = data.work_order
          applyRowToForm(wo, feedbackTabIndexForRow(wo))
          onEvent({ type: 'merged_row', workOrder: wo })
        } catch {
          if (workOrderInstructionsFetchForIdRef.current !== id) return
          applyRowToForm(row, rowFeedbackIdx)
        }
      })()
      return
    }

    const tab = session.initialTab ?? 0
    applyRowToForm(row, tab)
    setEditFetchPending(false)
    void (async () => {
      try {
        const data = await apiJson<WorkOrderResponse>(
          `/api/work-orders/${encodeURIComponent(id)}`,
        )
        if (workOrderInstructionsFetchForIdRef.current !== id) return
        const wo = data.work_order
        setDetailWorkOrder(wo)
        setFormWorkInstructions(
          workInstructionsFromApi(wo.work_instructions ?? []),
        )
        onEvent({ type: 'merged_row', workOrder: wo })
      } catch {
        if (workOrderInstructionsFetchForIdRef.current !== id) return
        setFormWorkInstructions(
          row.work_instructions?.length
            ? workInstructionsFromApi(row.work_instructions)
            : [],
        )
      }
    })()
  }, [
    session,
    applyRowToForm,
    onEvent,
    showError,
    t,
    resetFormState,
    closeWorkOrderFormDialog,
  ])

  useEffect(() => {
    if (!session || session.kind !== 'create') return
    if (workTypes.length === 0 || workgroups.length === 0) return
    openCreateInternal()
  }, [session, workTypes, workgroups, openCreateInternal])

  const dialogOpen = session != null
  const editingWo = detailWorkOrder

  const targetSiteIdForPicker = useMemo(() => {
    if (editingId) {
      return detailWorkOrder?.site_id ?? null
    }
    return getStoredUser()?.working_site_id ?? null
  }, [editingId, detailWorkOrder?.site_id])

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
      if (v.planned_duration != null && Number.isFinite(v.planned_duration)) {
        setFormPlannedDurationHours(v.planned_duration)
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
    if (!formPlanStart || formPlannedDurationHours == null) return null
    return new Date(
      formPlanStart.getTime() + formPlannedDurationHours * 3600000,
    )
  }, [formPlanStart, formPlannedDurationHours])

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

  const editingRowForFeedback = detailWorkOrder
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
      setDetailWorkOrder(data.work_order)
      onEvent({
        type: 'merged_row',
        workOrder: data.work_order,
        beforeRow: row,
      })
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
    if (
      formPlannedDurationHours == null ||
      !Number.isFinite(formPlannedDurationHours) ||
      formPlannedDurationHours < 0
    ) {
      showError(t('wo.err_planned_duration'))
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
      work_type_id: resolvedWorkTypeId,
      plan_start: formPlanStart ? formPlanStart.toISOString() : null,
      planned_duration: formPlannedDurationHours,
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
        const before = detailWorkOrder
        const data = await apiJson<WorkOrderResponse>(
          `/api/work-orders/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setDetailWorkOrder(data.work_order)
        onEvent({
          type: 'merged_row',
          workOrder: data.work_order,
          beforeRow: before ?? undefined,
        })
        if (!options?.skipSuccessToast) {
          showSuccess(t('wo.updated'))
        }
        if (!options?.keepOpen) {
          closeWorkOrderFormDialog()
        }
        return { ok: true, workOrder: data.work_order }
      } else {
        const data = await apiJson<WorkOrderResponse>('/api/work-orders', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        onEvent({ type: 'created_row', workOrder: data.work_order })
        closeWorkOrderFormDialog()
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

  const { workOrderDialogTitle, workOrderDialogDockTitle } = useMemo(() => {
    const base = editingId ? t('wo.dialog_edit') : t('wo.dialog_new')
    const sk = WO_STATUS_I18N_KEYS[formStatus]
    const statusLabel = sk ? t(sk) : formStatus
    const statusColour =
      woStatusMergedColours[formStatus as WorkOrderStatusColourKey] ??
      woStatusMergedColours.open
    const title = (
      <div className="flex align-items-center gap-2 min-w-0">
        <span className="font-semibold truncate min-w-0">{base}</span>
        <span
          className="flex-shrink-0 text-color-secondary align-self-center"
          aria-hidden="true"
        >
          ·
        </span>
        <span
          className="font-semibold white-space-nowrap flex-shrink-0"
          style={{ color: statusColour }}
        >
          {statusLabel}
        </span>
      </div>
    )
    return {
      workOrderDialogTitle: title,
      workOrderDialogDockTitle: `${base} \u00b7 ${statusLabel}`,
    }
  }, [editingId, formStatus, t, woStatusMergedColours])

  const { layout: mwLayoutRaw } = useMwFormLayout('work_order', session != null)
  const mwLayoutWo = mwLayoutRaw as MwLayoutJsonWorkOrder
  const generalOrderMap = useMemo(
    () => tabFieldOrderMap(mwLayoutWo, 'general'),
    [mwLayoutWo],
  )
  const instructionsOrderMap = useMemo(
    () => tabFieldOrderMap(mwLayoutWo, 'instructions'),
    [mwLayoutWo],
  )
  const workPlanOrderMap = useMemo(
    () => tabFieldOrderMap(mwLayoutWo, 'work_plan'),
    [mwLayoutWo],
  )
  const planningOrderMap = useMemo(
    () => tabFieldOrderMap(mwLayoutWo, 'planning'),
    [mwLayoutWo],
  )
  const feedbackOrderMap = useMemo(
    () => tabFieldOrderMap(mwLayoutWo, 'feedback'),
    [mwLayoutWo],
  )

  if (!session) return null

  const showFormBody =
    session.kind === 'create'
      ? workTypes.length > 0 && workgroups.length > 0
      : session.kind === 'edit' &&
          !editFetchPending &&
          detailWorkOrder != null

  return (
    <>
      <Toast ref={toast} position="top-right" />
      <WorkInstructionViewModal
        visible={instructionViewOpen}
        onHide={() => {
          setInstructionViewOpen(false)
          setInstructionViewWoId(null)
        }}
        mode="wo"
        entityId={instructionViewWoId}
        t={t as TFunction}
        reportError={showError}
        onAfterInstructionsChange={() => {
          onEvent({ type: 'silent_list_refresh' })
        }}
      />
      <AppCrudDialog
        title={workOrderDialogTitle}
        dockTitle={workOrderDialogDockTitle}
        minimizedDockPlacement="top-right"
        restoreOnChangeToken={session}
        visible={dialogOpen}
        onMinimizedChange={(min) => {
          if (min) {
            setInstructionViewOpen(false)
            setInstructionViewWoId(null)
          }
        }}
        onHide={() => {
          if (saving || fbSaving) return
          closeWorkOrderFormDialog()
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
              onClick={() => closeWorkOrderFormDialog()}
              disabled={saving || fbSaving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveWorkOrder()}
              loading={saving}
              disabled={saving || fbSaving || !showFormBody}
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
                disabled={saving || fbSaving || !showFormBody}
              />
            ) : null}
          </div>
        }
      >
        {session.kind === 'edit' && editFetchPending ? (
          <div className="text-sm text-color-secondary py-4">
            {t('common.loading')}
          </div>
        ) : !showFormBody ? (
          <div className="text-sm text-color-secondary py-4">
            {t('common.loading')}
          </div>
        ) : (
        <TabView
          className="app-modal-tabview"
          activeIndex={dialogTab}
          onTabChange={(e) => setDialogTab(e.index)}
        >
          <TabPanel header={t('wo.tab_general')}>
            <div className="app-modal-tab-content grid pt-2 gap-3">
              {!editingId ? (
                <div
                  className="col-12"
                  style={mwFieldStyle('voice_assist', generalOrderMap)}
                >
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
                <div
                  className="col-12 sm:col-4 lg:col-2 flex flex-column gap-2"
                  style={mwFieldStyle('wo_key', generalOrderMap)}
                >
                  <span className="text-sm font-medium">{t('wo.col_key')}</span>
                  <InputText
                    value={String(detailWorkOrder?.wo_key ?? '')}
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
                style={mwFieldStyle('short_text', generalOrderMap)}
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
              <div
                className="col-12 md:col-6 flex flex-column gap-2 flex-1 min-w-0"
                style={mwFieldStyle('asset', generalOrderMap)}
              >
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
              <div
                className="col-12 md:col-6 flex flex-column gap-2 flex-1 min-w-0"
                style={mwFieldStyle('cost_center_hint', generalOrderMap)}
              >
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
              {editingId && editingWo && workOrderHasLinkedPlan(editingWo) ? (
                <div
                  className="col-12 md:col-6 xl:col-4 flex flex-column gap-2"
                  style={mwFieldStyle('work_plan_key_readonly', generalOrderMap)}
                >
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
              <div
                className="col-12 md:col-6 xl:col-4 flex flex-column gap-2"
                style={mwFieldStyle('work_type', generalOrderMap)}
              >
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
              <div
                className="col-12 md:col-6 xl:col-4 flex flex-column gap-2"
                style={mwFieldStyle('category', generalOrderMap)}
              >
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
              <div
                className="col-12 flex flex-column gap-2"
                style={mwFieldStyle('instruction', generalOrderMap)}
              >
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
            <div style={mwFieldStyle('work_instructions', instructionsOrderMap)}>
              <WorkInstructionsTab
                variant="wo"
                parentId={editingId}
                rows={formWorkInstructions}
                setRows={setFormWorkInstructions}
                disabled={saving}
                reportError={showError}
                t={t}
              />
            </div>
          </TabPanel>
          {linkedToWorkPlan ? (
            <TabPanel header={t('wo.tab_work_plan')}>
              <div className="app-modal-tab-content grid pt-2 gap-3">
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('work_plan_interval_count', workPlanOrderMap)}
                >
                  <span className="text-sm font-medium">
                    {t('wp.field_interval_count')}
                  </span>
                  <InputText
                    value={workPlanTabIntervalCount}
                    className="w-full"
                    disabled
                  />
                </div>
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('work_plan_interval_type', workPlanOrderMap)}
                >
                  <span className="text-sm font-medium">
                    {t('wp.field_interval_type')}
                  </span>
                  <InputText
                    value={workPlanTabIntervalType}
                    className="w-full"
                    disabled
                  />
                </div>
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('work_plan_next_due', workPlanOrderMap)}
                >
                  <span className="text-sm font-medium">
                    {t('wp.field_next_due')}
                  </span>
                  <InputText
                    value={workPlanTabNextDue}
                    className="w-full"
                    disabled
                  />
                </div>
                <div
                  className="col-12 flex flex-column gap-2"
                  style={mwFieldStyle('work_plan_open_button', workPlanOrderMap)}
                >
                  <Button
                    type="button"
                    label={t('wo.open_wp')}
                    icon="pi pi-external-link"
                    outlined
                    onClick={() => {
                      const id = editingWo?.work_plan_id
                      if (!id) return
                      closeWorkOrderFormDialog()
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
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('workgroup', planningOrderMap)}
                >
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
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('plan_start', planningOrderMap)}
                >
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
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('planned_duration', planningOrderMap)}
                >
                  <label
                    htmlFor="wo-planned-duration"
                    className="text-sm font-medium"
                  >
                    {t('wo.field_planned_duration_hours')}
                  </label>
                  <InputNumber
                    id="wo-planned-duration"
                    value={formPlannedDurationHours}
                    onValueChange={(e) =>
                      setFormPlannedDurationHours(e.value ?? null)
                    }
                    min={0}
                    minFractionDigits={0}
                    maxFractionDigits={2}
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                  />
                </div>
                <div
                  className="col-12 md:col-6 flex flex-column gap-2"
                  style={mwFieldStyle('plan_end', planningOrderMap)}
                >
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
                        {t('wo.field_planned_duration_hours')}
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
                        <div
                          className="col-12 md:col-6 flex flex-column gap-2"
                          style={mwFieldStyle('feedback_self', feedbackOrderMap)}
                        >
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
                      <div
                        className="col-12 md:col-6 flex flex-column gap-2"
                        style={mwFieldStyle('feedback_extra', feedbackOrderMap)}
                      >
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
                      <div
                        className="col-12 md:col-6 flex flex-column gap-2"
                        style={mwFieldStyle(
                          'feedback_target_status',
                          feedbackOrderMap,
                        )}
                      >
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
                        <div
                          className="col-12 flex flex-column gap-2"
                          style={mwFieldStyle(
                            'feedback_hold_reason',
                            feedbackOrderMap,
                          )}
                        >
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
                    <div
                      className="col-12"
                      style={mwFieldStyle('feedback_submit', feedbackOrderMap)}
                    >
                      <Button
                        type="button"
                        label={t('wo.feedback_submit')}
                        icon="pi pi-check"
                        onClick={() => void submitFeedbackForm()}
                        loading={fbSaving}
                      />
                    </div>
                    <div
                      className="col-12"
                      style={mwFieldStyle('transactions', feedbackOrderMap)}
                    >
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
                    </div>
              </div>
            </TabPanel>
          ) : null}
        </TabView>
        )}
      </AppCrudDialog>
    </>
  )
}
