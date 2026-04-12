/**
 * CRUD for work plans — General (WO-like) + Planning (intervals, due dates).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
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
import { Toast } from 'primereact/toast'
import { TabView, TabPanel } from 'primereact/tabview'
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
import { AssetPickerSidebarContent } from '../../components/sel-item/AssetPickerSidebarContent'
import { SelItemField } from '../../components/sel-item/SelItemField'
import { formatDateTime } from '../../utils/dateTime'
import { workPlanDaysUntilGenerationOpens } from '../../utils/workPlanGenerationCountdown'
import { WorkAssignmentsIcons } from '../../components/work-instructions/WorkAssignmentsIcons'
import { WorkInstructionViewModal } from '../../components/work-instructions/WorkInstructionViewModal'
import {
  WorkInstructionsTab,
  workInstructionsForCreateBody,
  workInstructionsFromApi,
  type FormWorkInstruction,
} from '../../components/work-instructions/WorkInstructionsTab'
import type { Asset } from '../asset-management/assetTypes'
import type { Category } from '../categories/CategoriesAppPage'

export type IntervalTimeType = 'day' | 'week' | 'month' | 'year'

export type WorkPlan = {
  id: string
  site_id: string
  plan_key: string
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  worktime: string
  interval_count: number
  interval_time_type: string
  due_date: string
  next_due_at: string
  lead_time_days: number
  duration_hours: string
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
  category_id: string | null
  category_key: string | null
  category_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
  work_instructions?: {
    id: string
    sort_nr: number
    instruction_text: string
    done: boolean
  }[]
  has_material_assignment?: boolean
  has_employee_assignment?: boolean
  work_instruction_count?: number
  work_instruction_done_count?: number
}

type WorkPlansListResponse = { work_plans: WorkPlan[] }
type CategoriesListResponse = { categories: Category[] }
type WorkPlanResponse = { work_plan: WorkPlan }
type GenerateDueResponse = { generated: number; plans_advanced: number }

function parseWorktimeNum(w: string): number {
  const n = Number(w)
  return Number.isFinite(n) ? n : 0
}

/** Matches backend `WORK_PLAN_GEN_MS` (5 min); UI-only debug countdown. */
const WORK_PLAN_CRON_INTERVAL_MS = 5 * 60 * 1000

function formatCronCountdownMmSs(remainingMs: number): string {
  const ms = Math.max(0, remainingMs)
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function siteColumnBody(row: WorkPlan, dash: string) {
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

export default function WorkPlanningAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workPlanIdParam = searchParams.get('workPlanId')
  const emDash = t('common.em_dash')

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<WorkPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formPlanKey, setFormPlanKey] = useState('')
  const [formShortText, setFormShortText] = useState('')
  const [formAssetId, setFormAssetId] = useState<string | null>(null)
  const [formInstruction, setFormInstruction] = useState('')
  const [formWorktime, setFormWorktime] = useState<number | null>(null)
  const [formDueDate, setFormDueDate] = useState<Date | null>(null)
  const [formIntervalCount, setFormIntervalCount] = useState<number | null>(1)
  const [formIntervalType, setFormIntervalType] =
    useState<IntervalTimeType>('month')
  const [formLeadDays, setFormLeadDays] = useState<number | null>(0)
  const [formDurationHours, setFormDurationHours] = useState<number | null>(0)
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null)
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [selected, setSelected] = useState<WorkPlan | null>(null)
  const [search, setSearch] = useState('')
  const [dialogTab, setDialogTab] = useState(0)
  const [formWorkInstructions, setFormWorkInstructions] = useState<
    FormWorkInstruction[]
  >([])
  const [instructionViewOpen, setInstructionViewOpen] = useState(false)
  const [instructionViewPlanId, setInstructionViewPlanId] = useState<
    string | null
  >(null)
  const deepLinkHandledRef = useRef(false)

  const cronCycleEndRef = useRef(Date.now() + WORK_PLAN_CRON_INTERVAL_MS)
  const [, setCronTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      while (now >= cronCycleEndRef.current) {
        cronCycleEndRef.current += WORK_PLAN_CRON_INTERVAL_MS
      }
      setCronTick((n) => n + 1)
    }, 250)
    return () => window.clearInterval(id)
  }, [])

  const cronRemainingMs = Math.max(0, cronCycleEndRef.current - Date.now())
  const cronCountdownText = formatCronCountdownMmSs(cronRemainingMs)

  const intervalOptions = useMemo(
    () => [
      { value: 'day' as const, label: t('wp.interval_day') },
      { value: 'week' as const, label: t('wp.interval_week') },
      { value: 'month' as const, label: t('wp.interval_month') },
      { value: 'year' as const, label: t('wp.interval_year') },
    ],
    [t],
  )

  const filteredRows = useMemo(() => {
    let list = rows
    if (workPlanIdParam) {
      list = list.filter((p) => p.id === workPlanIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((p) => {
      return (
        p.plan_key.toLowerCase().includes(q) ||
        p.short_text.toLowerCase().includes(q) ||
        p.asset_key.toLowerCase().includes(q) ||
        p.asset_name.toLowerCase().includes(q) ||
        p.interval_time_type.toLowerCase().includes(q) ||
        String(p.interval_count).includes(q) ||
        (p.category_key?.toLowerCase().includes(q) ?? false) ||
        (p.category_name?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, search, workPlanIdParam])

  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((p) => p.id === cur.id) ? cur : null
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

  const closeWorkPlanDialog = useCallback(() => {
    setAssetPickerOpen(false)
    setDialogTab(0)
    setDialogOpen(false)
  }, [])

  const loadWorkPlans = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<WorkPlansListResponse>('/api/work-plans')
      setRows(data.work_plans ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wp.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadWorkPlans()
  }, [loadWorkPlans])

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

  const targetSiteIdForPlan = useMemo(() => {
    if (editingId) {
      return rows.find((x) => x.id === editingId)?.site_id ?? null
    }
    return getStoredUser()?.working_site_id ?? null
  }, [editingId, rows])

  const categoriesForSite = useMemo(() => {
    if (!targetSiteIdForPlan) return []
    return categories.filter((c) => c.site_id === targetSiteIdForPlan)
  }, [categories, targetSiteIdForPlan])

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

  const editingPlan = useMemo(
    () =>
      editingId ? rows.find((p) => p.id === editingId) ?? selected : null,
    [editingId, rows, selected],
  )

  const assetDisplayLabel = useMemo(() => {
    if (pickedAsset) {
      return `${pickedAsset.key} ${emDash} ${pickedAsset.name}`
    }
    if (editingPlan && formAssetId === editingPlan.asset_id) {
      return `${editingPlan.asset_key} ${emDash} ${editingPlan.asset_name}`
    }
    return ''
  }, [pickedAsset, editingPlan, formAssetId, emDash])

  const costCenterHint = useMemo(() => {
    if (pickedAsset) {
      if (!pickedAsset.costcenter_id) return emDash
      const ck = pickedAsset.costcenter_key ?? ''
      const cn = pickedAsset.costcenter_name ?? ''
      if (!ck && !cn) return emDash
      return `${ck} ${emDash} ${cn}`.trim()
    }
    if (editingPlan) {
      if (!editingPlan.costcenter_id) return emDash
      const ck = editingPlan.costcenter_key ?? ''
      const cn = editingPlan.costcenter_name ?? ''
      if (!ck && !cn) return emDash
      return `${ck} ${emDash} ${cn}`.trim()
    }
    return emDash
  }, [pickedAsset, editingPlan, emDash])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormPlanKey('')
    setFormShortText('')
    setFormAssetId(null)
    setPickedAsset(null)
    setFormInstruction('')
    setFormWorktime(null)
    setFormDueDate(null)
    setFormIntervalCount(1)
    setFormIntervalType('month')
    setFormLeadDays(0)
    setFormDurationHours(0)
    setFormCategoryId(null)
    setAssetPickerOpen(false)
    setDialogTab(0)
    setFormWorkInstructions([])
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  const openEdit = useCallback(async (row: WorkPlan) => {
    setEditingId(row.id)
    setFormPlanKey(row.plan_key)
    setFormShortText(row.short_text)
    setFormAssetId(row.asset_id)
    setPickedAsset(null)
    setFormInstruction(row.instruction_text)
    setFormWorktime(parseWorktimeNum(row.worktime))
    setFormDueDate(row.due_date ? new Date(row.due_date) : null)
    setFormIntervalCount(row.interval_count)
    setFormIntervalType(
      (['day', 'week', 'month', 'year'].includes(row.interval_time_type)
        ? row.interval_time_type
        : 'month') as IntervalTimeType,
    )
    setFormLeadDays(row.lead_time_days)
    setFormDurationHours(Number(row.duration_hours))
    setFormCategoryId(row.category_id ?? null)
    setAssetPickerOpen(false)
    setDialogTab(0)
    try {
      const data = await apiJson<WorkPlanResponse>(
        `/api/work-plans/${encodeURIComponent(row.id)}`,
      )
      setFormWorkInstructions(
        workInstructionsFromApi(data.work_plan.work_instructions ?? []),
      )
    } catch {
      setFormWorkInstructions(
        row.work_instructions?.length
          ? workInstructionsFromApi(row.work_instructions)
          : [],
      )
    }
    setDialogOpen(true)
  }, [])

  useEffect(() => {
    if (!workPlanIdParam) {
      deepLinkHandledRef.current = false
      return
    }
    if (rows.length === 0) return
    const p = rows.find((x) => x.id === workPlanIdParam)
    if (!p) return
    if (deepLinkHandledRef.current) return
    deepLinkHandledRef.current = true
    setSelected(p)
    openEdit(p)
    navigate('/work-planning', { replace: true })
  }, [workPlanIdParam, rows, navigate, openEdit])

  const isAdmin = getStoredUser()?.role === 'admin'

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<WorkPlan>[] => {
    const cols: ColumnRegistryEntry<WorkPlan>[] = []
    if (isAdmin) {
      cols.push({
        field: 'site_key',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        type: 'text',
        body: (row) => siteColumnBody(row, emDash),
      })
    }
    cols.push(
      { field: 'plan_key', headerKey: 'wp.field_key', sortable: true },
      { field: 'short_text', headerKey: 'wp.field_short_text', sortable: true },
      {
        field: 'category_key',
        headerKey: 'wp.col_category',
        sortable: true,
        sortField: 'category_key',
        body: (row) => {
          const k = row.category_key?.trim() ?? ''
          const n = row.category_name?.trim() ?? ''
          if (!k && !n) return emDash
          if (k && n) return `${k} ${emDash} ${n}`
          return k || n
        },
      },
      {
        field: 'work_instruction_count',
        headerKey: 'wo.col_assignments',
        sortable: false,
        body: (row) => (
          <WorkAssignmentsIcons
            row={row}
            t={t}
            onAssignmentClick={(kind) => {
              if (kind === 'instructions') {
                setInstructionViewPlanId(row.id)
                setInstructionViewOpen(true)
              }
            }}
          />
        ),
      },
      {
        field: 'asset_key',
        headerKey: 'wp.field_asset',
        sortable: true,
        sortField: 'asset_key',
        body: (row) => `${row.asset_key} ${emDash} ${row.asset_name}`,
      },
      {
        field: 'next_due_at',
        headerKey: 'wp.field_next_due',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.next_due_at),
      },
      {
        field: 'wo_gen_countdown',
        headerKey: 'wp.col_wo_gen_countdown',
        sortable: false,
        body: (row) => {
          const n = workPlanDaysUntilGenerationOpens(
            row.next_due_at,
            row.lead_time_days,
          )
          return n === null ? emDash : String(n)
        },
        search: {
          getSearchValue: (row) => {
            const n = workPlanDaysUntilGenerationOpens(
              row.next_due_at,
              row.lead_time_days,
            )
            return n === null ? '' : String(n)
          },
        },
      },
      {
        field: 'interval_count',
        headerKey: 'wp.field_interval',
        sortable: true,
      },
      {
        field: 'interval_time_type',
        headerKey: 'wp.field_interval_type',
        sortable: true,
      },
      {
        field: 'duration_hours',
        headerKey: 'wp.field_duration_hours',
        sortable: true,
      },
    )
    return cols
  }, [emDash, isAdmin, t])

  const tw = useTableWizard<WorkPlan>({
    appPath: '/work-planning',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  async function saveWorkPlan() {
    const planKey = formPlanKey.trim()
    const shortText = formShortText.trim()
    const instruction = formInstruction.trim()
    if (!planKey) {
      showError(t('wp.err_key'))
      return
    }
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
    if (
      formWorktime == null ||
      formWorktime < 0 ||
      !Number.isFinite(formWorktime)
    ) {
      showError(t('wo.err_worktime'))
      return
    }
    if (!formDueDate) {
      showError(t('wp.err_due_required'))
      return
    }
    if (
      formIntervalCount == null ||
      !Number.isInteger(formIntervalCount) ||
      formIntervalCount < 1
    ) {
      showError(t('wp.err_interval'))
      return
    }
    if (
      formLeadDays == null ||
      !Number.isInteger(formLeadDays) ||
      formLeadDays < 0
    ) {
      showError(t('wp.err_lead'))
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

    const body: Record<string, unknown> = {
      plan_key: planKey.slice(0, 200),
      short_text: shortText.slice(0, 200),
      asset_id: formAssetId,
      instruction_text: instruction,
      worktime: formWorktime,
      interval_count: formIntervalCount,
      interval_time_type: formIntervalType,
      due_date: formDueDate.toISOString(),
      lead_time_days: formLeadDays,
      duration_hours: formDurationHours,
      category_id: formCategoryId,
    }
    if (!editingId) {
      const wi = workInstructionsForCreateBody(formWorkInstructions)
      if (wi.length > 0) body.work_instructions = wi
    }

    setSaving(true)
    try {
      if (editingId) {
        const data = await apiJson<WorkPlanResponse>(
          `/api/work-plans/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setRows((prev) =>
          prev.map((p) => (p.id === editingId ? data.work_plan : p)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.work_plan : cur,
        )
        showSuccess(t('wp.updated'))
      } else {
        const data = await apiJson<WorkPlanResponse>('/api/work-plans', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          [...prev, data.work_plan].sort((a, b) =>
            a.plan_key.localeCompare(b.plan_key),
          ),
        )
        showSuccess(t('wp.created'))
      }
      closeWorkPlanDialog()
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wp.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: WorkPlan) {
    confirmDialog({
      header: t('wp.delete_header'),
      message: t('wp.delete_msg', { key: row.plan_key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      dismissableMask: true,
      accept: () => void deleteWorkPlan(row.id),
    })
  }

  async function deleteWorkPlan(id: string) {
    try {
      await apiJson<undefined>(`/api/work-plans/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((p) => p.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('wp.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wp.delete_fail'))
      }
    }
  }

  async function runGenerateDue() {
    setGenerating(true)
    try {
      const data = await apiJson<GenerateDueResponse>(
        '/api/work-plans/generate-due',
        { method: 'POST', body: '{}' },
      )
      showSuccess(
        t('wp.generate_result', {
          generated: data.generated,
          plans: data.plans_advanced,
        }),
      )
      await loadWorkPlans()
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wp.generate_fail'))
      }
    } finally {
      setGenerating(false)
    }
  }

  const auditResourceIdForMenu = selected?.id ?? ''

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
            `/audit-log?resource_type=work_plan&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const nextDueReadOnly =
    editingId && editingPlan?.next_due_at
      ? formatDateTime(editingPlan.next_due_at)
      : emDash

  const cardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-calendar text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('wp.title')}</h1>
          <p className="app-card-hero-desc">{t('wp.subtitle')}</p>
        </div>
      </div>
      <div className="flex align-items-start gap-3 flex-shrink-0 align-self-start">
        {tw.heroTableWizard}
        <div
          className="flex flex-column align-items-end gap-1"
          title={t('wp.cron_debug_hint')}
        >
          <span className="text-xs text-color-secondary uppercase">
            {t('wp.cron_debug_label')}
          </span>
          <span
            className="font-mono text-xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {cronCountdownText}
          </span>
        </div>
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

      <WorkInstructionViewModal
        visible={instructionViewOpen}
        onHide={() => {
          setInstructionViewOpen(false)
          setInstructionViewPlanId(null)
        }}
        mode="wp"
        entityId={instructionViewPlanId}
        t={t}
        reportError={showError}
      />

      <div className="p-4 w-full app-page-mw-none flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={cardHeader}
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
                <Button
                  type="button"
                  label={t('wp.btn_generate')}
                  icon="pi pi-sync"
                  loading={generating}
                  disabled={generating}
                  onClick={() => void runGenerateDue()}
                  outlined
                />
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
                    aria-label={t('wp.search_aria')}
                    className="w-full"
                />
              </IconField>
              </div>
            </div>
            <div className="w-full overflow-x-auto">
              <DataTable
                value={tw.prepareRows(filteredRows)}
                loading={loading || tw.tableBusy}
                dataKey="id"
                selection={selected}
                tableStyle={{ minWidth: '80rem', width: 'max-content' }}
                onSelectionChange={(e) =>
                  setSelected(e.value as WorkPlan | null)
                }
                contextMenuSelection={selected ?? undefined}
                onContextMenuSelectionChange={(e) =>
                  setSelected(e.value as WorkPlan | null)
                }
                onContextMenu={(e) => {
                  e.originalEvent.preventDefault()
                  crudContextMenuRef.current?.show(e.originalEvent)
                }}
                selectionMode="single"
                metaKeySelection={false}
                onRowDoubleClick={(e) => {
                  const row = e.data as WorkPlan
                  setSelected(row)
                  openEdit(row)
                }}
                emptyMessage={
                  search.trim() ? t('wp.empty_search') : t('wp.empty')
                }
                stripedRows
                {...tw.tableLayoutProps}
              >
                {tw.renderColumns()}
              </DataTable>
            </div>
          </div>
        </Card>
      </div>

      <Dialog
        header={editingId ? t('wp.dialog_edit') : t('wp.dialog_new')}
        visible={dialogOpen}
        onHide={closeWorkPlanDialog}
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
              onClick={closeWorkPlanDialog}
              disabled={saving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveWorkPlan()}
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
          <TabPanel header={t('wp.tab_general')}>
            <div className="app-modal-tab-content grid pt-2 gap-3">
              <div className="col-12 sm:col-4 lg:col-2 flex flex-column gap-2">
                <label htmlFor="wp-key" className="text-sm font-medium">
                  {t('wp.field_key')}
                </label>
                <InputText
                  id="wp-key"
                  value={formPlanKey}
                  onChange={(e) => setFormPlanKey(e.target.value)}
                  className="w-full"
                  disabled={saving}
                  maxLength={200}
                  autoComplete="off"
                />
              </div>
              <div className="col-12 sm:col-8 lg:col-10 flex flex-column gap-2">
                <label htmlFor="wp-short" className="text-sm font-medium">
                  {t('wo.col_short_text')}
                </label>
                <InputText
                  id="wp-short"
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
                    <label htmlFor="wp-asset" className="text-sm font-medium">
                      {t('wo.col_asset')}
                    </label>
                    <SelItemField
                      id="wp-asset"
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
              <div className="col-12 md:col-6 xl:col-4 flex flex-column gap-2">
                <label htmlFor="wp-category" className="text-sm font-medium">
                  {t('wp.field_category')}
                </label>
                <Dropdown
                  id="wp-category"
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
                <label htmlFor="wp-worktime" className="text-sm font-medium">
                  {t('wo.label_worktime_hours')}
                </label>
                <InputNumber
                  id="wp-worktime"
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
              <div className="col-12 flex flex-column gap-2">
                <label htmlFor="wp-instruction" className="text-sm font-medium">
                  {t('common.col_instruction')}
                </label>
                <InputTextarea
                  id="wp-instruction"
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
          <TabPanel header={t('wp.tab_instructions')}>
            <WorkInstructionsTab
              variant="wp"
              parentId={editingId}
              rows={formWorkInstructions}
              setRows={setFormWorkInstructions}
              disabled={saving}
              reportError={showError}
              t={t}
            />
          </TabPanel>
          <TabPanel header={t('wp.tab_planning')}>
            <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
              <div className="grid">
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label htmlFor="wp-due" className="text-sm font-medium">
                    {t('wp.field_due_date')}
                  </label>
                  <Calendar
                    id="wp-due"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.value as Date | null)}
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
                  <span className="text-sm font-medium">
                    {t('wp.field_next_due')}
                  </span>
                  <InputText value={nextDueReadOnly} className="w-full" disabled />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label htmlFor="wp-ic" className="text-sm font-medium">
                    {t('wp.field_interval')}
                  </label>
                  <InputNumber
                    id="wp-ic"
                    value={formIntervalCount}
                    onValueChange={(e) => setFormIntervalCount(e.value ?? null)}
                    min={1}
                    step={1}
                    useGrouping={false}
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label htmlFor="wp-it" className="text-sm font-medium">
                    {t('wp.field_interval_type')}
                  </label>
                  <Dropdown
                    id="wp-it"
                    value={formIntervalType}
                    onChange={(e) =>
                      setFormIntervalType(e.value as IntervalTimeType)
                    }
                    options={intervalOptions}
                    optionLabel="label"
                    optionValue="value"
                    className="w-full"
                    disabled={saving}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label htmlFor="wp-lead" className="text-sm font-medium">
                    {t('wp.field_lead_time_days')}
                  </label>
                  <InputNumber
                    id="wp-lead"
                    value={formLeadDays}
                    onValueChange={(e) => setFormLeadDays(e.value ?? null)}
                    min={0}
                    step={1}
                    useGrouping={false}
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                  />
                </div>
                <div className="col-12 md:col-6 flex flex-column gap-2">
                  <label htmlFor="wp-dur" className="text-sm font-medium">
                    {t('wo.field_duration_hours')}
                  </label>
                  <InputNumber
                    id="wp-dur"
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
              </div>
              <p className="text-xs text-color-secondary m-0">
                {t('wp.help_interval')}
              </p>
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
    </AppShell>
  )
}
