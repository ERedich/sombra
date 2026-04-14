/**
 * Edit-only asset dialog for use outside Asset management (e.g. Tree structure double-click).
 * Reuses the same form variants and save/thumbnail behavior as AssetManagementAppPage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import { Toast } from 'primereact/toast'
import { ApiError, apiBlob, apiFetch, apiJson } from '../../api'
import { AssetFormDialogDefault } from './AssetFormDialogDefault'
import { AssetFormDialogQuick } from './AssetFormDialogQuick'
import { AssetFormDialogTabs } from './AssetFormDialogTabs'
import type { AssetFormDialogBodyProps } from './assetFormDialogProps'
import { ASSET_FORM_DIALOG_WIDTH, ASSET_FORM_VARIANT } from './assetFormConfig'
import { formatDateOnly, parseDateOnly } from './assetFormUtils'
import type { Asset, AssetType } from './assetTypes'

type CostcenterRow = { id: string; site_id: string; key: string; name: string }
type CostcentersListResponse = { costcenters: CostcenterRow[] }
type AssetClassificationRow = {
  id: string
  site_id: string
  key: string
  name: string
}
type AssetClassificationsListResponse = {
  asset_classifications: AssetClassificationRow[]
}
type AssetResponse = { asset: Asset }

export type AssetEditDialogProps = {
  asset: Asset | null
  open: boolean
  onClose: () => void
  /** Same list as asset management (for parent dropdowns). */
  allAssets: Asset[]
  onSaved?: (asset: Asset) => void
}

export function AssetEditDialog({
  asset,
  open,
  onClose,
  allAssets,
  onSaved,
}: AssetEditDialogProps) {
  const toast = useRef<Toast>(null)
  const [costcenters, setCostcenters] = useState<CostcenterRow[]>([])
  const [classifications, setClassifications] = useState<
    AssetClassificationRow[]
  >([])
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

  const showError = useCallback((detail: string) => {
    toast.current?.show({
      severity: 'error',
      summary: 'Error',
      detail,
      life: 5000,
    })
  }, [])

  const showSuccess = useCallback((detail: string) => {
    toast.current?.show({
      severity: 'success',
      summary: 'Success',
      detail,
      life: 4000,
    })
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiJson<CostcentersListResponse>('/api/costcenters')
        setCostcenters(data.costcenters ?? [])
      } catch {
        setCostcenters([])
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiJson<AssetClassificationsListResponse>(
          '/api/asset-classifications',
        )
        setClassifications(data.asset_classifications ?? [])
      } catch {
        setClassifications([])
      }
    })()
  }, [])

  const closeDialog = useCallback(() => {
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setEditingId(null)
    setPendingThumbnailFile(null)
    setThumbnailClear(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open || !asset) return

    setEditingId(asset.id)
    setFormSiteId(asset.site_id)
    setFormKey(asset.key)
    setFormName(asset.name)
    setFormAssetClassificationId(asset.asset_classification_id)
    setFormAssetType(asset.asset_type)
    setFormParentId(asset.parent_asset_id)
    setFormCostcenterId(asset.costcenter_id)
    setFormEquipment(asset.equipment_number ?? '')
    setFormSerial(asset.serial_no ?? '')
    setFormBuildYear(asset.build_year)
    setFormWarrantyEnd(parseDateOnly(asset.warranty_end))
    setFormPriority(asset.priority)
    setPendingThumbnailFile(null)
    setThumbnailClear(false)
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    if (asset.has_thumbnail) {
      void (async () => {
        try {
          const blob = await apiBlob(`/api/assets/${asset.id}/thumbnail`)
          const url = URL.createObjectURL(blob)
          setThumbnailPreviewUrl(url)
        } catch {
          setThumbnailPreviewUrl(null)
        }
      })()
    }
  }, [open, asset])

  const parentOptions = useMemo(() => {
    const sid = formSiteId
    if (!sid) return []
    const opts: { label: string; value: string | null }[] = [
      { label: '— None —', value: null },
    ]
    for (const a of allAssets) {
      if (a.site_id !== sid) continue
      if (editingId && a.id === editingId) continue
      opts.push({ label: `${a.key} — ${a.name}`, value: a.id })
    }
    return opts
  }, [allAssets, formSiteId, editingId])

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
      showError('Key and name are required.')
      return
    }
    if (!editingId) {
      showError('Nothing to save.')
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
      let result = (
        await apiJson<AssetResponse>(`/api/assets/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      ).asset

      if (pendingThumbnailFile) {
        result = (await uploadThumbnail(result.id, pendingThumbnailFile)).asset
      } else if (thumbnailClear && !pendingThumbnailFile) {
        result = (
          await apiJson<AssetResponse>(`/api/assets/${result.id}/thumbnail`, {
            method: 'DELETE',
          })
        ).asset
      }

      onSaved?.(result)
      showSuccess('Asset updated.')
      closeDialog()
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError('Save failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  const assetFormDialogProps: AssetFormDialogBodyProps = {
    onSubmitForm: () => void saveAsset(),
    saving,
    editingId,
    selected: asset,
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

  const assetFormInner =
    ASSET_FORM_VARIANT === 'quick' ? (
      <AssetFormDialogQuick
        {...assetFormDialogProps}
        dialogOpen={open}
        rows={allAssets}
      />
    ) : ASSET_FORM_VARIANT === 'tabs' ? (
      <AssetFormDialogTabs
        {...assetFormDialogProps}
        dialogOpen={open}
      />
    ) : (
      <AssetFormDialogDefault {...assetFormDialogProps} />
    )

  const assetFormFooter = (
    <div className="flex justify-content-end gap-2">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        outlined
        onClick={closeDialog}
        disabled={saving}
      />
      <Button
        type="submit"
        form="asset-form"
        label="Save"
        icon="pi pi-check"
        loading={saving}
      />
    </div>
  )

  return (
    <>
      <Toast ref={toast} position="top-right" />
      <AppCrudDialog
        title="Edit asset"
        visible={open && asset != null}
        onHide={closeDialog}
        dismissableMask={!saving}
        style={{
          width: ASSET_FORM_DIALOG_WIDTH[ASSET_FORM_VARIANT],
        }}
        footer={asset ? assetFormFooter : null}
      >
        {asset ? assetFormInner : null}
      </AppCrudDialog>
    </>
  )
}
