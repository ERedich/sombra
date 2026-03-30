/**
 * Simplified asset form: core fields first; secondary fields in a collapsible panel.
 * Toggle via `ASSET_FORM_VARIANT` in assetFormConfig.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { Calendar } from 'primereact/calendar'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { Panel } from 'primereact/panel'
import { Button } from 'primereact/button'
import type { Asset, AssetType } from './assetTypes'
import { ASSET_TYPE_OPTIONS } from './assetTypes'
import {
  assetTypeDropdownItemTemplate,
  assetTypeDropdownValueTemplate,
} from './assetTypeUi'
import type { AssetFormDialogBodyProps } from './assetFormDialogProps'
import { AssetThumbnailDropArea } from './AssetThumbnailDropArea'
import {
  applyPendingThumbnailFile,
  THUMBNAIL_ACCEPT,
} from './assetThumbnailUpload'

export type AssetFormDialogQuickProps = AssetFormDialogBodyProps & {
  dialogOpen: boolean
  rows: Asset[]
}

function rowHasMoreDetails(row: Asset): boolean {
  return !!(
    (row.equipment_number && row.equipment_number.trim() !== '') ||
    (row.serial_no && row.serial_no.trim() !== '') ||
    row.build_year != null ||
    row.warranty_end ||
    row.priority != null ||
    row.has_thumbnail
  )
}

export function AssetFormDialogQuick(props: AssetFormDialogQuickProps) {
  const {
    onSubmitForm,
    dialogOpen,
    rows,
    editingId,
    saving,
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
  } = props

  const seedRow = useMemo(
    () => (editingId ? rows.find((a) => a.id === editingId) : null),
    [editingId, rows],
  )

  const [moreCollapsed, setMoreCollapsed] = useState(true)

  useEffect(() => {
    if (!dialogOpen) return
    if (!editingId || !seedRow) {
      setMoreCollapsed(true)
      return
    }
    setMoreCollapsed(!rowHasMoreDetails(seedRow))
  }, [dialogOpen, editingId, seedRow])

  return (
    <div
      className="overflow-y-auto overflow-x-hidden px-0 sm:px-2 md:px-4"
      style={{ maxHeight: 'min(85vh, 56rem)' }}
    >
      <form
        id="asset-form"
        className="flex flex-column gap-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmitForm()
        }}
      >
        <p className="text-sm text-color-secondary mt-0 mb-0 line-height-3">
          Fill in the basics below. Expand{' '}
          <strong className="text-color">More details</strong> for equipment
          numbers, warranty, priority, and photo.
        </p>

        <div className="flex flex-column gap-4">
          <div className="flex flex-column gap-4 lg:flex-row lg:gap-6">
            <div className="flex flex-column gap-2 flex-1 min-w-0">
              <label htmlFor="asset-q-type" className="text-sm font-medium">
                Object type
              </label>
              <Dropdown
                id="asset-q-type"
                value={formAssetType}
                options={ASSET_TYPE_OPTIONS}
                optionLabel="label"
                optionValue="value"
                itemTemplate={assetTypeDropdownItemTemplate}
                valueTemplate={assetTypeDropdownValueTemplate}
                onChange={(e) => setFormAssetType(e.value as AssetType)}
                className="w-full"
                disabled={saving}
              />
            </div>
            <div className="flex flex-column gap-2 flex-1 min-w-0">
              <label htmlFor="asset-q-class" className="text-sm font-medium">
                Asset classification
              </label>
              <Dropdown
                id="asset-q-class"
                value={formAssetClassificationId}
                options={assetClassificationOptions}
                optionLabel="label"
                optionValue="value"
                onChange={(e) =>
                  setFormAssetClassificationId(e.value as string | null)
                }
                className="w-full"
                disabled={saving || !formSiteId}
                filter
                showClear
                placeholder={formSiteId ? 'Select…' : '—'}
                panelClassName="max-w-[min(100vw-2rem,40rem)]"
              />
            </div>
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="asset-q-key" className="text-sm font-medium">
              Key
            </label>
            <InputText
              id="asset-q-key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="asset-q-name" className="text-sm font-medium">
              Name
            </label>
            <InputText
              id="asset-q-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-4 lg:flex-row lg:gap-6">
            <div className="flex flex-column gap-2 flex-1 min-w-0">
              <label htmlFor="asset-q-parent" className="text-sm font-medium">
                Parent asset
              </label>
              <Dropdown
                id="asset-q-parent"
                value={formParentId}
                options={parentOptions}
                optionLabel="label"
                optionValue="value"
                onChange={(e) => setFormParentId(e.value as string | null)}
                className="w-full"
                disabled={saving || !formSiteId}
                filter
                showClear
                placeholder="Same site only"
              />
            </div>
            <div className="flex flex-column gap-2 flex-1 min-w-0">
              <label htmlFor="asset-q-cc" className="text-sm font-medium">
                Cost center
              </label>
              <Dropdown
                id="asset-q-cc"
                value={formCostcenterId}
                options={costcenterOptions}
                optionLabel="label"
                optionValue="value"
                onChange={(e) =>
                  setFormCostcenterId(e.value as string | null)
                }
                className="w-full"
                disabled={saving || !formSiteId}
                filter
                showClear
              />
            </div>
          </div>
        </div>

        <Panel
          header="More details — equipment, dates, photo"
          toggleable
          collapsed={moreCollapsed}
          onToggle={(e) => setMoreCollapsed(e.value)}
          className="border-round-md surface-border"
          pt={{ content: { className: 'pt-3 pb-2' } }}
        >
          <div className="flex flex-column gap-4">
            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase mb-2">
                Equipment
              </div>
              <div className="flex flex-column gap-4 md:flex-row md:gap-6">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-q-eq" className="text-sm font-medium">
                    Equipment number
                  </label>
                  <InputText
                    id="asset-q-eq"
                    value={formEquipment}
                    onChange={(e) => setFormEquipment(e.target.value)}
                    className="w-full"
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-q-serial" className="text-sm font-medium">
                    Serial no.
                  </label>
                  <InputText
                    id="asset-q-serial"
                    value={formSerial}
                    onChange={(e) => setFormSerial(e.target.value)}
                    className="w-full"
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase mb-2">
                Dates &amp; priority
              </div>
              <div className="flex flex-column gap-4 sm:flex-row sm:gap-6 sm:align-items-start">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-q-year" className="text-sm font-medium">
                    Build year
                  </label>
                  <InputNumber
                    id="asset-q-year"
                    value={formBuildYear}
                    onValueChange={(e) => setFormBuildYear(e.value ?? null)}
                    className="w-full"
                    inputClassName="w-full"
                    disabled={saving}
                    useGrouping={false}
                    min={1800}
                    max={2100}
                    placeholder="1800–2100"
                  />
                </div>
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label
                    htmlFor="asset-q-warranty"
                    className="text-sm font-medium"
                  >
                    Warranty end
                  </label>
                  <div className="w-full min-w-0">
                    <Calendar
                      id="asset-q-warranty"
                      value={formWarrantyEnd}
                      onChange={(e) =>
                        setFormWarrantyEnd(e.value as Date | null)
                      }
                      showIcon
                      showButtonBar
                      className="w-full"
                      inputClassName="w-full min-w-0"
                      disabled={saving}
                    />
                  </div>
                </div>
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-q-prio" className="text-sm font-medium">
                    Priority
                  </label>
                  <InputNumber
                    id="asset-q-prio"
                    value={formPriority}
                    onValueChange={(e) => setFormPriority(e.value ?? null)}
                    className="w-full"
                    inputClassName="w-full min-w-0"
                    disabled={saving}
                    min={1}
                    max={5}
                    useGrouping={false}
                    showButtons
                    placeholder="1–5"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-color-secondary uppercase mb-2">
                Thumbnail
              </div>
              <div className="flex flex-column gap-4 xl:flex-row xl:gap-6 xl:align-items-start">
                <div className="flex flex-column gap-2 flex-1 min-w-0 xl:max-w-[26rem]">
                  <label
                    htmlFor="asset-q-thumb"
                    className="text-sm font-medium"
                  >
                    Image file
                  </label>
                  <AssetThumbnailDropArea
                    disabled={saving}
                    onImageFile={(f) =>
                      applyPendingThumbnailFile(
                        f,
                        setPendingThumbnailFile,
                        setThumbnailClear,
                        setThumbnailPreviewUrl
                      )
                    }
                  >
                    <p className="text-xs text-color-secondary mt-0 mb-2">
                      Drag and drop an image here, or choose a file. JPEG, PNG,
                      WebP, or GIF. Max 2 MB on save.
                    </p>
                    <input
                      id="asset-q-thumb"
                      type="file"
                      accept={THUMBNAIL_ACCEPT}
                      disabled={saving}
                      className="text-sm w-full"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        applyPendingThumbnailFile(
                          f ?? null,
                          setPendingThumbnailFile,
                          setThumbnailClear,
                          setThumbnailPreviewUrl
                        )
                        e.target.value = ''
                      }}
                    />
                  </AssetThumbnailDropArea>
                  {editingId &&
                  !pendingThumbnailFile &&
                  !thumbnailClear &&
                  (thumbnailPreviewUrl || selected?.has_thumbnail) ? (
                    <Button
                      type="button"
                      label="Remove thumbnail"
                      severity="secondary"
                      outlined
                      size="small"
                      className="align-self-start"
                      disabled={saving}
                      onClick={() => {
                        setThumbnailClear(true)
                        setPendingThumbnailFile(null)
                        setThumbnailPreviewUrl((prev) => {
                          if (prev) URL.revokeObjectURL(prev)
                          return null
                        })
                      }}
                    />
                  ) : null}
                </div>
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium">Preview</span>
                  <div
                    className="flex align-items-center justify-content-center border-round border-1 border-300 surface-ground p-2"
                    style={{ minHeight: '8rem' }}
                  >
                    {thumbnailPreviewUrl ? (
                      <img
                        src={thumbnailPreviewUrl}
                        alt=""
                        className="max-w-full border-round"
                        style={{ maxHeight: '14rem', objectFit: 'contain' }}
                      />
                    ) : (
                      <span className="text-sm text-color-secondary">
                        No image selected
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </form>
    </div>
  )
}
