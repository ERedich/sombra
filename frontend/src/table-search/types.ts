import type {
  ColumnRegistryEntry,
  ColumnSearchInputType,
  ColumnSearchOption,
} from '../table-wizard'

export type TableSearchCriterionV1 = {
  from: string
  to: string
  selectedValues?: string[]
}

export type TableSearchSettingsV1 = {
  version: 1
  criteria: Record<string, TableSearchCriterionV1>
}

export type SearchPresetDto = {
  id: string
  app_path: string
  preset_key: string
  settings_json: unknown
  owner_user_id: string
  owner_login_name: string
}

export type SearchableColumnDef<T> = {
  field: string
  headerKey: string
  inputType: ColumnSearchInputType
  options?: ColumnSearchOption[]
  getSearchValue?: (row: T) => unknown
}

export function buildSearchableColumns<T>(
  columnDefs: ColumnRegistryEntry<T>[],
): SearchableColumnDef<T>[] {
  return columnDefs
    .filter((def) => def.search?.enabled !== false)
    .map((def) => {
      return {
        field: def.field,
        headerKey: def.headerKey,
        inputType: def.search?.inputType ?? 'text',
        options: def.search?.options,
        getSearchValue: def.search?.getSearchValue,
      }
    })
}
