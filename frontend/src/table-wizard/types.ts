import type { ReactNode } from 'react'

export type TableSettingsV1 = {
  version: 1
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  columnWidths?: Record<string, number>
  /** First N visible columns (in order) are frozen left; 0 = none. */
  frozenLeftCount?: number
  multiSortMeta: { field: string; order: 1 | -1 }[]
  groupByField?: string | null
  dateGroupGranularity?: 'none' | 'year' | 'month' | 'iso_week'
}

export type ColumnSearchInputType =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'multiselect'
export type ColumnSearchMatchMode = 'contains' | 'equals'
export type ColumnSearchOption = { label: string; value: string }

export type ColumnSearchConfig<T> = {
  enabled?: boolean
  inputType?: ColumnSearchInputType
  matchModes?: ColumnSearchMatchMode[]
  defaultMatchMode?: ColumnSearchMatchMode
  options?: ColumnSearchOption[]
  /**
   * Optional accessor used by Searchpanel filtering when table rendering does not
   * map 1:1 to the raw row field.
   */
  getSearchValue?: (row: T) => unknown
}

export type ColumnRegistryEntry<T> = {
  field: string
  headerKey: string
  /** Field used for sorting (defaults to `field`) */
  sortField?: string
  sortable?: boolean
  /** Default true; site reference columns default false unless wizard enables */
  defaultVisible?: boolean
  isSiteReference?: boolean
  type?: 'text' | 'date' | 'datetime'
  body?: (row: T) => ReactNode
  /** Optional CSS class for `<td>` of this column/row. */
  cellClassName?: (row: T) => string | undefined
  search?: ColumnSearchConfig<T>
}

export const TW_GROUP_FIELD = '__twGroup' as const

export type TableLayoutPresetDto = {
  id: string
  app_path: string
  layout_key: string
  settings_json: unknown
  owner_user_id: string
  owner_login_name: string
  shared: boolean
}
