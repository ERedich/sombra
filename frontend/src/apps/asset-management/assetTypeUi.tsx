import type { AssetType, AssetTypeOption } from './assetTypes'
import {
  ASSET_TYPE_ICON_COLOR,
  ASSET_TYPE_ICONS,
  ASSET_TYPE_LABELS,
} from './assetTypes'

/** Icon + label for tables, dropdowns, and summaries. */
export function AssetTypeIconLabel({ type }: { type: AssetType }) {
  return (
    <span className="flex align-items-center gap-2 white-space-nowrap">
      <i
        className={`pi ${ASSET_TYPE_ICONS[type]}`}
        style={{ color: ASSET_TYPE_ICON_COLOR[type] }}
        aria-hidden
      />
      <span>{ASSET_TYPE_LABELS[type]}</span>
    </span>
  )
}

export function assetTypeDropdownItemTemplate(option: AssetTypeOption) {
  return <AssetTypeIconLabel type={option.value} />
}

export function assetTypeDropdownValueTemplate(option: AssetTypeOption | null) {
  if (!option) return null
  return <AssetTypeIconLabel type={option.value} />
}
