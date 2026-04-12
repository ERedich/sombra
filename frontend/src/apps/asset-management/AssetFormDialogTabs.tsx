/**
 * Asset form: TabView with grouped sections (see assetFormConfig.ts).
 */
import { useEffect, useState } from 'react'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Divider } from 'primereact/divider'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { TabPanel, TabView } from 'primereact/tabview'
import type { AssetType } from './assetTypes'
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
export type AssetFormDialogTabsProps = AssetFormDialogBodyProps & {
  dialogOpen: boolean
}

export function AssetFormDialogTabs(props: AssetFormDialogTabsProps) {
  const {
    onSubmitForm,
    dialogOpen,
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
  } = props

  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    if (dialogOpen) setActiveTab(0)
  }, [dialogOpen])

  return (
    <div className="px-0 sm:px-1">
      <form
        id="asset-form"
        className="pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmitForm()
        }}
      >
        <TabView
          className="app-modal-tabview"
          activeIndex={activeTab}
          onTabChange={(e) => setActiveTab(e.index)}
        >
          <TabPanel header="Basic Information">
            <div className="app-modal-tab-content flex flex-column gap-4 pt-2">
              <div className="flex flex-column gap-4 md:flex-row md:gap-6">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-type" className="text-sm font-medium">
                    Object type
                  </label>
                  <Dropdown
                    id="asset-type"
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
                  <label htmlFor="asset-class" className="text-sm font-medium">
                    Asset classification
                  </label>
                  <Dropdown
                    id="asset-class"
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
                <label htmlFor="asset-key" className="text-sm font-medium">
                  Key
                </label>
                <InputText
                  id="asset-key"
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  className="w-full"
                  disabled={saving}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-column gap-2">
                <label htmlFor="asset-name" className="text-sm font-medium">
                  Name
                </label>
                <InputText
                  id="asset-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full"
                  disabled={saving}
                />
              </div>

              <div className="flex flex-column gap-4 md:flex-row md:gap-6">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-parent" className="text-sm font-medium">
                    Parent asset
                  </label>
                  <Dropdown
                    id="asset-parent"
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
                  <label htmlFor="asset-cc" className="text-sm font-medium">
                    Cost center
                  </label>
                  <Dropdown
                    id="asset-cc"
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

              <Divider className="m-0" />

              <div className="flex flex-column gap-4 xl:flex-row xl:gap-6 xl:align-items-start">
                <div className="flex flex-column gap-2 flex-1 min-w-0 xl:max-w-[28rem]">
                  <label
                    htmlFor="asset-thumbnail-file"
                    className="text-sm font-medium"
                  >
                    Thumbnail
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
                      id="asset-thumbnail-file"
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
          </TabPanel>

          <TabPanel header="Equipment">
            <div className="app-modal-tab-content flex flex-column gap-4 pt-2">
              <div className="flex flex-column gap-4 md:flex-row md:gap-6">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-eq" className="text-sm font-medium">
                    Equipment number
                  </label>
                  <InputText
                    id="asset-eq"
                    value={formEquipment}
                    onChange={(e) => setFormEquipment(e.target.value)}
                    className="w-full"
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-serial" className="text-sm font-medium">
                    Serial no.
                  </label>
                  <InputText
                    id="asset-serial"
                    value={formSerial}
                    onChange={(e) => setFormSerial(e.target.value)}
                    className="w-full"
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel header="Dates">
            <div className="app-modal-tab-content flex flex-column gap-4 pt-2">
              <div className="flex flex-column gap-4 sm:flex-row sm:gap-6 sm:align-items-start">
                <div className="flex flex-column gap-2 flex-1 min-w-0">
                  <label htmlFor="asset-year" className="text-sm font-medium">
                    Build year
                  </label>
                  <InputNumber
                    id="asset-year"
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
                  <label htmlFor="asset-warranty" className="text-sm font-medium">
                    Warranty end
                  </label>
                  <div className="w-full min-w-0">
                    <Calendar
                      id="asset-warranty"
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
                  <label htmlFor="asset-prio" className="text-sm font-medium">
                    Priority
                  </label>
                  <InputNumber
                    id="asset-prio"
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
          </TabPanel>
        </TabView>
      </form>
    </div>
  )
}
