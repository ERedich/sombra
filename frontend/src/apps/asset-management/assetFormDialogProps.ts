import type { Dispatch, SetStateAction } from 'react'
import type { Asset, AssetType } from './assetTypes'

export type AssetFormDialogBodyProps = {
  /** Wired to Save / Enter; must preventDefault in caller if needed. */
  onSubmitForm: () => void
  saving: boolean
  editingId: string | null
  selected: Asset | null
  formSiteId: string | null
  formAssetType: AssetType
  setFormAssetType: (v: AssetType) => void
  formKey: string
  setFormKey: (v: string) => void
  formName: string
  setFormName: (v: string) => void
  formAssetClassificationId: string | null
  setFormAssetClassificationId: (v: string | null) => void
  assetClassificationOptions: { label: string; value: string | null }[]
  formParentId: string | null
  setFormParentId: (v: string | null) => void
  parentOptions: { label: string; value: string | null }[]
  formCostcenterId: string | null
  setFormCostcenterId: (v: string | null) => void
  costcenterOptions: { label: string; value: string | null }[]
  formEquipment: string
  setFormEquipment: (v: string) => void
  formSerial: string
  setFormSerial: (v: string) => void
  formBuildYear: number | null
  setFormBuildYear: (v: number | null) => void
  formWarrantyEnd: Date | null
  setFormWarrantyEnd: (v: Date | null) => void
  formPriority: number | null
  setFormPriority: (v: number | null) => void
  pendingThumbnailFile: File | null
  setPendingThumbnailFile: (v: File | null) => void
  thumbnailClear: boolean
  setThumbnailClear: (v: boolean) => void
  thumbnailPreviewUrl: string | null
  setThumbnailPreviewUrl: Dispatch<SetStateAction<string | null>>
}
