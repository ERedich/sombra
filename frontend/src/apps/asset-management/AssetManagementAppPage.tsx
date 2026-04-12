/**
 * Site-scoped assets: type, hierarchy, cost center, metadata, optional thumbnail.
 *
 * Layout vocabulary:
 * - **Table view**: toolbar (Create / Edit / Delete), search, helper text, and the DataTable.
 * - **Details view**: create/edit form (variant from assetFormConfig) and Save / Cancel.
 *   Shown beside the table when `ASSET_PAGE_LAYOUT === 'split'`, or in a Dialog when `'modal'`.
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
import { Dialog } from 'primereact/dialog'
import { Splitter, SplitterPanel } from 'primereact/splitter'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { Toast } from 'primereact/toast'
import type { DataTablePageEvent } from 'primereact/datatable'
import {
  VoiceAssistPanel,
  type AiSuggestAssetValidated,
} from '../../components/ai/VoiceAssistPanel'
import { ApiError, apiBlob, apiFetch, apiJson } from '../../api'
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
import { formatDate, formatDateTime } from '../../utils/dateTime'
import { AssetFormDialogDefault } from './AssetFormDialogDefault'
import { AssetFormDialogQuick } from './AssetFormDialogQuick'
import { AssetFormDialogTabs } from './AssetFormDialogTabs'
import type { AssetFormDialogBodyProps } from './assetFormDialogProps'
import { ASSET_FORM_DIALOG_WIDTH, ASSET_FORM_VARIANT } from './assetFormConfig'
import { ASSET_PAGE_CONTAINER_CLASS, ASSET_PAGE_LAYOUT } from './assetPageLayout'
import { formatDateOnly, parseDateOnly } from './assetFormUtils'
import { AssetTypeIconLabel } from './assetTypeUi'
import {
  ASSET_TYPE_LABELS,
  type Asset,
  type AssetType,
} from './assetTypes'

export type { Asset, AssetType } from './assetTypes'

type CostcenterRow = {
  id: string
  site_id: string
  key: string
  name: string
}

type AssetClassificationRow = {
  id: string
  site_id: string
  key: string
  name: string
}

function siteColumnBody(row: Asset, dash: string) {
  const colour =
    typeof row.site_colour === 'string' && row.site_colour.trim() !== ''
      ? row.site_colour.trim()
      : '#94a3b8'
  return (
    <div className="flex align-items-center gap-2 white-space-nowrap">
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

type AssetsListResponse = { assets: Asset[] }
type AssetResponse = { asset: Asset }
type CostcentersListResponse = { costcenters: CostcenterRow[] }
type AssetClassificationsListResponse = {
  asset_classifications: AssetClassificationRow[]
}

export default function AssetManagementAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const assetIdParam = searchParams.get('assetId')?.trim() ?? ''

  const toast = useRef<Toast>(null)
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<Asset[]>([])
  const [costcenters, setCostcenters] = useState<CostcenterRow[]>([])
  const [classifications, setClassifications] = useState<
    AssetClassificationRow[]
  >([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formSiteId, setFormSiteId] = useState<string | null>(null)

  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formAssetClassificationId, setFormAssetClassificationId] = useState<
    string | null
  >(null)
  const [formAssetType, setFormAssetType] = useState<AssetType>('location')
  const [formParentId, setFormParentId] = useState<string | null>(null)
  const [formCostcenterId, setFormCostcenterId] = useState<string | null>(null)
  const [formEquipment, setFormEquipment] = useState('')
  const [formSerial, setFormSerial] = useState('')
  const [formBuildYear, setFormBuildYear] = useState<number | null>(null)
  const [formWarrantyEnd, setFormWarrantyEnd] = useState<Date | null>(null)
  const [formPriority, setFormPriority] = useState<number | null>(null)
  const [pendingThumbnailFile, setPendingThumbnailFile] = useState<File | null>(
    null,
  )
  const [thumbnailClear, setThumbnailClear] = useState(false)
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(
    null,
  )

  const [selected, setSelected] = useState<Asset | null>(null)
  const [search, setSearch] = useState('')
  const [tableFirst, setTableFirst] = useState(0)
  const [tableRows, setTableRows] = useState(25)
  const emDash = t('common.em_dash')

  const [splitWide, setSplitWide] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 992px)').matches
      : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 992px)')
    const sync = () => {
      setSplitWide(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Asset>[] => {
    return [
      {
        field: 'site_key',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        type: 'text',
        body: (row) => siteColumnBody(row, emDash),
      },
      {
        field: 'asset_type',
        headerKey: 'common.col_object_type',
        sortable: true,
        body: (row) =>
          row.asset_type && ASSET_TYPE_LABELS[row.asset_type] ? (
            <AssetTypeIconLabel type={row.asset_type} />
          ) : (
            emDash
          ),
      },
      { field: 'key', headerKey: 'common.col_key', sortable: true },
      { field: 'name', headerKey: 'common.col_name', sortable: true },
      {
        field: 'asset_classification_key',
        headerKey: 'common.col_classification',
        sortable: true,
        body: (row) =>
          row.asset_classification_key
            ? `${row.asset_classification_key} ${emDash} ${row.asset_classification_name ?? ''}`
            : emDash,
      },
      {
        field: 'parent_asset_key',
        headerKey: 'common.col_parent',
        sortable: true,
        body: (row) =>
          row.parent_asset_key
            ? `${row.parent_asset_key} ${emDash} ${row.parent_asset_name ?? ''}`
            : emDash,
      },
      {
        field: 'costcenter_key',
        headerKey: 'common.col_cost_center',
        sortable: true,
        body: (row) => row.costcenter_key ?? emDash,
      },
      {
        field: 'equipment_number',
        headerKey: 'common.col_equip_nr',
        sortable: true,
        body: (row) => row.equipment_number ?? emDash,
      },
      {
        field: 'serial_no',
        headerKey: 'common.col_serial',
        sortable: true,
        body: (row) => row.serial_no ?? emDash,
      },
      {
        field: 'build_year',
        headerKey: 'common.col_build_year',
        sortable: true,
        body: (row) =>
          row.build_year != null ? String(row.build_year) : emDash,
      },
      {
        field: 'warranty_end',
        headerKey: 'common.col_warranty_end',
        sortable: true,
        type: 'date',
        body: (row) =>
          row.warranty_end ? formatDate(row.warranty_end) : emDash,
      },
      {
        field: 'priority',
        headerKey: 'common.col_priority',
        sortable: true,
        body: (row) =>
          row.priority != null ? String(row.priority) : emDash,
      },
      {
        field: 'has_thumbnail',
        headerKey: 'common.col_photo',
        sortable: true,
        body: (row) =>
          row.has_thumbnail ? t('assets.col_photo_yes') : emDash,
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
  }, [emDash, t])

  /** Same value passed to DataTable scrollHeight and table wizard when columns are frozen. */
  const assetTableScrollHeight =
    ASSET_PAGE_LAYOUT === 'split' ? 'flex' : 'min(72vh, 48rem)'

  const cardSubTitle = useMemo(() => {
    if (assetIdParam) {
      return t('assets.subtitle_filtered')
    }
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('assets.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('assets.subtitle_no_sites')
    }
    return t('assets.subtitle_default')
  }, [assetIdParam, t])

  const filteredRows = useMemo(() => {
    let list = rows
    if (assetIdParam) {
      list = list.filter((a) => a.id === assetIdParam)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((a) => {
      const hay = [
        a.site_key,
        a.site_name,
        a.key,
        a.name,
        a.asset_classification_key ?? '',
        a.asset_classification_name ?? '',
        ASSET_TYPE_LABELS[a.asset_type],
        a.parent_asset_key ?? '',
        a.parent_asset_name ?? '',
        a.costcenter_key ?? '',
        a.equipment_number ?? '',
        a.serial_no ?? '',
        a.build_year != null ? String(a.build_year) : '',
        a.warranty_end ?? '',
        a.priority != null ? String(a.priority) : '',
        a.created_at,
        a.updated_at,
        formatDateTime(a.created_at),
        formatDateTime(a.updated_at),
        a.created_by_login_name ?? '',
        a.updated_by_login_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search, assetIdParam])

  const tw = useTableWizard<Asset>({
    appPath: '/assets',
    columnDefs: tableColumnDefs,
    frozenScrollHeight: assetTableScrollHeight,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  useEffect(() => {
    if (assetIdParam && rows.length > 0) {
      const a = rows.find((x) => x.id === assetIdParam)
      setSelected(a ?? null)
      return
    }
    setSelected((cur) => {
      if (!cur) return null
      return filteredRows.some((a) => a.id === cur.id) ? cur : null
    })
  }, [filteredRows, assetIdParam, rows])

  useEffect(() => {
    setTableFirst(0)
  }, [search, assetIdParam])

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

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<AssetsListResponse>('/api/assets')
      setRows(data.assets ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('assets.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  const loadCostcenters = useCallback(async () => {
    try {
      const data = await apiJson<CostcentersListResponse>('/api/costcenters')
      setCostcenters(data.costcenters ?? [])
    } catch {
      setCostcenters([])
    }
  }, [])

  const loadClassifications = useCallback(async () => {
    try {
      const data = await apiJson<AssetClassificationsListResponse>(
        '/api/asset-classifications',
      )
      setClassifications(data.asset_classifications ?? [])
    } catch {
      setClassifications([])
    }
  }, [])

  useEffect(() => {
    void loadAssets()
    void loadCostcenters()
    void loadClassifications()
  }, [loadAssets, loadCostcenters, loadClassifications])

  const closeDialog = useCallback(() => {
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setEditingId(null)
    setDialogOpen(false)
  }, [])

  function openCreate() {
    const user = getStoredUser()
    const ws = user?.working_site_id
    setSelected(null)
    setEditingId(null)
    setFormSiteId(ws && ws.length > 0 ? ws : null)
    setFormKey('')
    setFormName('')
    setFormAssetClassificationId(null)
    setFormAssetType('location')
    setFormParentId(null)
    setFormCostcenterId(null)
    setFormEquipment('')
    setFormSerial('')
    setFormBuildYear(null)
    setFormWarrantyEnd(null)
    setFormPriority(null)
    setPendingThumbnailFile(null)
    setThumbnailClear(false)
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setDialogOpen(true)
  }

  useRegisterCreateShortcut(openCreate)

  async function openEdit(row: Asset) {
    setEditingId(row.id)
    setFormSiteId(row.site_id)
    setFormKey(row.key)
    setFormName(row.name)
    setFormAssetClassificationId(row.asset_classification_id)
    setFormAssetType(row.asset_type)
    setFormParentId(row.parent_asset_id)
    setFormCostcenterId(row.costcenter_id)
    setFormEquipment(row.equipment_number ?? '')
    setFormSerial(row.serial_no ?? '')
    setFormBuildYear(row.build_year)
    setFormWarrantyEnd(parseDateOnly(row.warranty_end))
    setFormPriority(row.priority)
    setPendingThumbnailFile(null)
    setThumbnailClear(false)
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setDialogOpen(true)
    if (row.has_thumbnail) {
      try {
        const blob = await apiBlob(`/api/assets/${row.id}/thumbnail`)
        const url = URL.createObjectURL(blob)
        setThumbnailPreviewUrl(url)
      } catch {
        setThumbnailPreviewUrl(null)
      }
    }
  }

  const parentOptions = useMemo(() => {
    const sid = formSiteId
    if (!sid) return []
    const opts: { label: string; value: string | null }[] = [
      { label: '— None —', value: null },
    ]
    for (const a of rows) {
      if (a.site_id !== sid) continue
      if (editingId && a.id === editingId) continue
      opts.push({ label: `${a.key} — ${a.name}`, value: a.id })
    }
    return opts
  }, [rows, formSiteId, editingId])

  const costcenterOptions = useMemo(() => {
    const sid = formSiteId
    if (!sid) return []
    const opts: { label: string; value: string | null }[] = [
      { label: '— None —', value: null },
    ]
    for (const c of costcenters) {
      if (c.site_id !== sid) continue
      opts.push({ label: `${c.key} — ${c.name}`, value: c.id })
    }
    return opts
  }, [costcenters, formSiteId])

  const assetClassificationOptions = useMemo(() => {
    const sid = formSiteId
    if (!sid) return []
    const opts: { label: string; value: string | null }[] = [
      { label: '— None —', value: null },
    ]
    for (const ac of classifications) {
      if (ac.site_id !== sid) continue
      opts.push({ label: `${ac.key} — ${ac.name}`, value: ac.id })
    }
    return opts
  }, [classifications, formSiteId])

  const aiAssetVoiceContext = useMemo(() => {
    const sid = formSiteId
    if (!sid) {
      return {
        assets: [] as { id: string; key: string; name: string }[],
        costcenters: [] as { id: string; key: string; name: string }[],
        asset_classifications: [] as { id: string; key: string; name: string }[],
      }
    }
    return {
      assets: rows
        .filter((r) => r.site_id === sid)
        .map((a) => ({ id: a.id, key: a.key, name: a.name })),
      costcenters: costcenters
        .filter((c) => c.site_id === sid)
        .map((c) => ({ id: c.id, key: c.key, name: c.name })),
      asset_classifications: classifications
        .filter((ac) => ac.site_id === sid)
        .map((ac) => ({ id: ac.id, key: ac.key, name: ac.name })),
    }
  }, [rows, formSiteId, costcenters, classifications])

  const applyAiAssetDraft = useCallback((v: AiSuggestAssetValidated) => {
    if (v.key?.trim()) setFormKey(v.key.trim())
    if (v.name?.trim()) setFormName(v.name.trim())
    if (v.asset_type) setFormAssetType(v.asset_type)
    setFormParentId(v.parent_asset_id ?? null)
    setFormCostcenterId(v.costcenter_id ?? null)
    setFormAssetClassificationId(v.asset_classification_id ?? null)
    if (v.equipment_number?.trim()) {
      setFormEquipment(v.equipment_number.trim())
    } else if (v.equipment_number === '') {
      setFormEquipment('')
    }
    if (v.serial_no?.trim()) setFormSerial(v.serial_no.trim())
    else if (v.serial_no === '') setFormSerial('')
    if (v.build_year != null) setFormBuildYear(v.build_year)
    if (v.warranty_end) {
      const d = new Date(v.warranty_end)
      if (!Number.isNaN(d.getTime())) setFormWarrantyEnd(d)
    } else if (v.warranty_end === null) {
      setFormWarrantyEnd(null)
    }
    if (v.priority != null) setFormPriority(v.priority)
    else if (v.priority === null) setFormPriority(null)
  }, [])

  async function uploadThumbnail(assetId: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    const res = await apiFetch(`/api/assets/${assetId}/thumbnail`, {
      method: 'POST',
      body: fd,
    })
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errObj = data as { error?: string }
      const msg =
        typeof errObj?.error === 'string' ? errObj.error : res.statusText
      throw new ApiError(msg, res.status, data)
    }
    return data as AssetResponse
  }

  async function saveAsset() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!key || !name) {
      showError(t('assets.err_key_name'))
      return
    }
    if (!formSiteId && !editingId) {
      showError('No working site is set.')
      return
    }

    const body: Record<string, unknown> = {
      key,
      name,
      asset_classification_id: formAssetClassificationId,
      asset_type: formAssetType,
      parent_asset_id: formParentId,
      costcenter_id: formCostcenterId,
      equipment_number: formEquipment.trim() || null,
      serial_no: formSerial.trim() || null,
      build_year: formBuildYear,
      warranty_end: formWarrantyEnd ? formatDateOnly(formWarrantyEnd) : null,
      priority: formPriority,
    }

    setSaving(true)
    try {
      let assetId = editingId
      if (editingId) {
        const data = await apiJson<AssetResponse>(`/api/assets/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          prev.map((a) => (a.id === editingId ? data.asset : a)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.asset : cur,
        )
        assetId = data.asset.id
        showSuccess(t('assets.updated'))
      } else {
        const data = await apiJson<AssetResponse>('/api/assets', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          [...prev, data.asset].sort((a, b) => a.name.localeCompare(b.name)),
        )
        showSuccess(t('assets.created'))
        assetId = data.asset.id
      }

      if (assetId) {
        if (pendingThumbnailFile) {
          const up = await uploadThumbnail(assetId, pendingThumbnailFile)
          setRows((prev) =>
            prev.map((a) => (a.id === assetId ? up.asset : a)),
          )
          setSelected((cur) =>
            cur?.id === assetId ? up.asset : cur,
          )
        }
        if (editingId && thumbnailClear && !pendingThumbnailFile) {
          const up = await apiJson<AssetResponse>(
            `/api/assets/${assetId}/thumbnail`,
            { method: 'DELETE' },
          )
          setRows((prev) =>
            prev.map((a) => (a.id === assetId ? up.asset : a)),
          )
          setSelected((cur) =>
            cur?.id === assetId ? up.asset : cur,
          )
        }
      }

      closeDialog()
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('assets.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Asset) {
    confirmDialog({
      header: t('assets.delete_header'),
      message: t('assets.delete_msg', { name: row.name, key: row.key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteAsset(row.id),
    })
  }

  async function deleteAsset(id: string) {
    try {
      await apiJson<undefined>(`/api/assets/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((a) => a.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      if (editingId === id) {
        closeDialog()
      }
      showSuccess(t('assets.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('assets.delete_fail'))
      }
    }
  }

  const isAdmin = getStoredUser()?.role === 'admin'
  const auditResourceIdForMenu = assetIdParam || selected?.id || ''

  const crudContextMenuItems = buildCrudContextMenuModel(
    {
      onCreate: openCreate,
      onEdit: () => {
        if (selected) void openEdit(selected)
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
            `/audit-log?resource_type=asset&resource_id=${encodeURIComponent(auditResourceIdForMenu)}`,
          ),
      },
    },
  )

  const assetFormDialogProps: AssetFormDialogBodyProps = {
    onSubmitForm: () => void saveAsset(),
    saving,
    editingId,
    selected,
    formSiteId,
    formAssetType,
    setFormAssetType,
    formKey,
    setFormKey,
    formName,
    setFormName,
    formAssetClassificationId,
    setFormAssetClassificationId,
    assetClassificationOptions,
    formParentId,
    setFormParentId,
    parentOptions,
    formCostcenterId,
    setFormCostcenterId,
    costcenterOptions,
    formEquipment,
    setFormEquipment,
    formSerial,
    setFormSerial,
    formBuildYear,
    setFormBuildYear,
    formWarrantyEnd,
    setFormWarrantyEnd,
    formPriority,
    setFormPriority,
    pendingThumbnailFile,
    setPendingThumbnailFile,
    thumbnailClear,
    setThumbnailClear,
    thumbnailPreviewUrl,
    setThumbnailPreviewUrl,
  }

  const cardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-box text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('assets.title')}</h1>
          <p className="app-card-hero-desc">{cardSubTitle}</p>
        </div>
      </div>
      <div className="flex align-items-center gap-2 flex-shrink-0 align-self-start">
        {tw.heroTableWizard}
      </div>
    </div>
  )

  const assetFormFooter = (
    <div className="flex justify-content-end gap-2">
      <Button
        type="button"
        label={t('common.cancel')}
        severity="secondary"
        outlined
        onClick={closeDialog}
        disabled={saving}
      />
      <Button
        type="submit"
        form="asset-form"
        label={t('common.save')}
        icon="pi pi-check"
        loading={saving}
      />
    </div>
  )

  const assetFormInner =
    ASSET_FORM_VARIANT === 'quick' ? (
      <AssetFormDialogQuick
        {...assetFormDialogProps}
        dialogOpen={dialogOpen}
        rows={rows}
      />
    ) : ASSET_FORM_VARIANT === 'tabs' ? (
      <AssetFormDialogTabs
        {...assetFormDialogProps}
        dialogOpen={dialogOpen}
      />
    ) : (
      <AssetFormDialogDefault {...assetFormDialogProps} />
    )

  const detailsEmptyState = (
    <div className="flex flex-column align-items-center justify-content-center px-3 py-6 text-center text-color-secondary h-full min-h-12rem">
      <i className="pi pi-list text-4xl mb-3 opacity-60" aria-hidden />
      <p className="m-0 max-w-16rem">{t('assets.details_empty_hint')}</p>
    </div>
  )

  const tableToolbarAndGrid = (
    <div className="px-2 md:px-4 min-w-0 flex flex-column flex-1 min-h-0">
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
            onClick={() => selected && void openEdit(selected)}
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
              aria-label={t('assets.search_aria')}
              className="w-full"
            />
          </IconField>
        </div>
      </div>
      <p className="text-sm text-color-secondary mt-0 mb-3">
        {t('assets.help')}
      </p>
      <div className="min-w-0 min-h-0 flex-1 flex flex-column">
        <DataTable
          value={tw.prepareRows(filteredRows)}
          loading={loading || tw.tableBusy}
          dataKey="id"
          paginator
          rows={tableRows}
          first={tableFirst}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPage={(e: DataTablePageEvent) => {
            setTableFirst(e.first)
            setTableRows(e.rows)
          }}
          selection={selected}
          onSelectionChange={(e) => setSelected(e.value as Asset | null)}
          contextMenuSelection={selected ?? undefined}
          onContextMenuSelectionChange={(e) =>
            setSelected(e.value as Asset | null)
          }
          onContextMenu={(e) => {
            e.originalEvent.preventDefault()
            crudContextMenuRef.current?.show(e.originalEvent)
          }}
          selectionMode="single"
          metaKeySelection={false}
          onRowDoubleClick={(e) => {
            const row = e.data as Asset
            setSelected(row)
            void openEdit(row)
          }}
          emptyMessage={
            search.trim()
              ? t('assets.empty_search')
              : t('assets.empty')
          }
          stripedRows
          scrollable
          scrollHeight={assetTableScrollHeight}
          tableStyle={{ width: 'max-content', minWidth: '100%' }}
          {...tw.tableLayoutProps}
        >
          {tw.renderColumns()}
        </DataTable>
      </div>
    </div>
  )

  const detailsViewPanel = (
    <div className="flex flex-column h-full min-h-0 w-full p-3 md:p-5">
      <Card
        className="m-0 flex flex-column flex-1 min-h-0 h-full shadow-none border-1 surface-border overflow-hidden"
        pt={{
          body: { className: 'flex flex-column flex-1 min-h-0 p-0 overflow-hidden' },
          footer: { className: 'border-top-1 surface-border pt-3 pb-3 px-3' },
        }}
        header={
          <div className="flex align-items-center gap-2 py-1 px-1">
            <span className="text-lg font-semibold">
              {dialogOpen
                ? editingId
                  ? t('assets.details_title_edit')
                  : t('assets.details_title_new')
                : t('assets.details_title_empty')}
            </span>
          </div>
        }
        footer={dialogOpen ? assetFormFooter : undefined}
      >
        <div className="flex flex-column flex-1 min-h-0 overflow-auto">
          {dialogOpen ? (
            <>
              {!editingId ? (
                <div className="px-3 pt-3 md:px-5 md:pt-4">
                  <VoiceAssistPanel
                    kind="asset"
                    disabled={saving}
                    context={aiAssetVoiceContext}
                    onApplyValidated={applyAiAssetDraft}
                    onError={showError}
                  />
                </div>
              ) : null}
              {assetFormInner}
            </>
          ) : (
            detailsEmptyState
          )}
        </div>
      </Card>
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

      <div className={`${ASSET_PAGE_CONTAINER_CLASS} flex flex-column gap-3`}>
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={cardHeader}
        >
          {ASSET_PAGE_LAYOUT === 'split' ? (
            <Splitter
              layout={splitWide ? 'horizontal' : 'vertical'}
              style={{ minHeight: 'min(80vh, 56rem)' }}
              className="border-none surface-ground"
            >
              <SplitterPanel
                size={splitWide ? 52 : 52}
                minSize={25}
                className="min-w-0 min-h-0 flex flex-column"
              >
                {tableToolbarAndGrid}
              </SplitterPanel>
              <SplitterPanel
                size={splitWide ? 48 : 48}
                minSize={splitWide ? 28 : 24}
                className="min-w-0 min-h-0 flex flex-column"
              >
                {detailsViewPanel}
              </SplitterPanel>
            </Splitter>
          ) : (
            tableToolbarAndGrid
          )}
        </Card>
      </div>

      {ASSET_PAGE_LAYOUT === 'modal' ? (
        <Dialog
          header={editingId ? 'Edit asset' : 'New asset'}
          visible={dialogOpen}
          onHide={closeDialog}
          dismissableMask={!saving}
          style={{
            width: ASSET_FORM_DIALOG_WIDTH[ASSET_FORM_VARIANT],
          }}
          footer={assetFormFooter}
        >
          {assetFormInner}
        </Dialog>
      ) : null}
    </AppShell>
  )
}
