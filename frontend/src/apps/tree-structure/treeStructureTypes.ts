import type { Asset, AssetType } from '../asset-management/assetTypes'

export type SiteAssetGroup = {
  site_id: string
  site_key: string
  site_name: string
  site_colour: string
  assets: Asset[]
}

/** Parent node key whose direct children play the staggered expand animation. */
export type ExpandAnimState = { parentKey: string; childCount: number }

export type TreeRowData = {
  key: string
  name: string
  asset_type?: AssetType
  /** Null until wired to real document counts/links. */
  documents: string | null
  workOrders: string
  parentKey: string | null
}
