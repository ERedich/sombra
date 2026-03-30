import type { CSSProperties } from 'react'

export type AssetType =
  | 'location'
  | 'building'
  | 'group'
  | 'maintenance_object'

export type Asset = {
  id: string
  site_id: string
  asset_type: AssetType
  key: string
  name: string
  asset_classification_id: string | null
  asset_classification_key: string | null
  asset_classification_name: string | null
  parent_asset_id: string | null
  costcenter_id: string | null
  equipment_number: string | null
  serial_no: string | null
  build_year: number | null
  warranty_end: string | null
  priority: number | null
  has_thumbnail: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  site_key: string
  site_name: string
  site_colour: string
  costcenter_key: string | null
  costcenter_name: string | null
  parent_asset_key: string | null
  parent_asset_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  location: 'Location',
  building: 'Building',
  group: 'Group',
  maintenance_object: 'Maintenance Object',
}

/** PrimeIcons class suffix (prefix with `pi `) for each asset type — UI hints only. */
export const ASSET_TYPE_ICONS: Record<AssetType, string> = {
  location: 'pi-map-marker',
  building: 'pi-building',
  group: 'pi-th-large',
  maintenance_object: 'pi-wrench',
}

/**
 * Pastel row backgrounds for hierarchy views (DataTable, TreeTable, future tree UIs).
 * Single source of truth — keep in sync with {@link assetTypeRowBackgroundCssVarsStyle} (Tree Structure UI).
 */
export const ASSET_TYPE_TREE_ROW_BG: Record<AssetType, string> = {
  location: '#6BAED9',
  building: '#E4A574',
  group: '#7BC99C',
  maintenance_object: '#B8A3E0',
}

/** Stronger icon colours (same hue families as {@link ASSET_TYPE_TREE_ROW_BG}). */
export const ASSET_TYPE_ICON_COLOR: Record<AssetType, string> = {
  location: '#1E7AB8',
  building: '#C05621',
  group: '#2A9D5C',
  maintenance_object: '#7C4DD9',
}

/** Sets `--asset-type-bg-*` for `.app-tree-structure-treetable` row backgrounds. */
export function assetTypeRowBackgroundCssVarsStyle(): CSSProperties {
  return {
    '--asset-type-bg-location': ASSET_TYPE_TREE_ROW_BG.location,
    '--asset-type-bg-building': ASSET_TYPE_TREE_ROW_BG.building,
    '--asset-type-bg-group': ASSET_TYPE_TREE_ROW_BG.group,
    '--asset-type-bg-maintenance_object': ASSET_TYPE_TREE_ROW_BG.maintenance_object,
  } as CSSProperties
}

export type AssetTypeOption = {
  label: string
  value: AssetType
  /** PrimeIcons suffix (use with `pi ` prefix), matches {@link ASSET_TYPE_ICONS}. */
  icon: string
}

export const ASSET_TYPE_OPTIONS: AssetTypeOption[] = (
  Object.keys(ASSET_TYPE_LABELS) as AssetType[]
).map((v) => ({
  label: ASSET_TYPE_LABELS[v],
  value: v,
  icon: ASSET_TYPE_ICONS[v],
}))
