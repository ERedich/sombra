/**
 * Paginated asset list for SelItemField drawer — GET /api/assets?limit=&offset=&q=
 * (loads one page at a time; search is server-side).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputText } from 'primereact/inputtext'
import { ApiError, apiJson } from '../../api'
import { AssetTypeIconLabel } from '../../apps/asset-management/assetTypeUi'
import {
  ASSET_TYPE_LABELS,
  type Asset,
} from '../../apps/asset-management/assetTypes'
import { formatDate, formatDateTime } from '../../utils/dateTime'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

function siteColumnBody(row: Asset) {
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
        {row.site_key} — {row.site_name}
      </span>
    </div>
  )
}

export type AssetPickerSidebarContentProps = {
  onHide: () => void
  onSelect: (asset: Asset) => void
  onError?: (message: string) => void
}

export function AssetPickerSidebarContent({
  onHide,
  onSelect,
  onError,
}: AssetPickerSidebarContentProps) {
  const [rows, setRows] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [first, setFirst] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [totalRecords, setTotalRecords] = useState(0)
  const [selected, setSelected] = useState<Asset | null>(null)

  const showErr = useCallback(
    (msg: string) => {
      onError?.(msg)
    },
    [onError],
  )

  useEffect(() => {
    if (!searchInput.trim()) {
      setDebouncedSearch('')
      setFirst(0)
      return
    }
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
      setFirst(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const loadPage = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('limit', String(rowsPerPage))
      qs.set('offset', String(first))
      const q = debouncedSearch.trim()
      if (q) qs.set('q', q)
      const data = await apiJson<{ assets: Asset[]; total?: number }>(
        `/api/assets?${qs.toString()}`,
      )
      setRows(data.assets ?? [])
      setTotalRecords(
        typeof data.total === 'number' ? data.total : (data.assets ?? []).length,
      )
    } catch (e) {
      if (e instanceof ApiError) {
        showErr(e.message)
      } else {
        showErr('Failed to load assets.')
      }
      setRows([])
      setTotalRecords(0)
    } finally {
      setLoading(false)
    }
  }, [first, rowsPerPage, debouncedSearch, showErr])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  function confirmSelect() {
    if (!selected) return
    onSelect(selected)
    onHide()
  }

  const tableScrollHeight = 'calc(100vh - 18rem)'

  return (
    <div className="flex flex-column gap-3 h-full min-h-0">
      <div className="flex justify-content-between align-items-center gap-3 flex-wrap">
        <div
          className="p-inputgroup flex-1 app-crud-toolbar-search"
          style={{ width: 'min(20rem, 100%)' }}
        >
          <span className="p-inputgroup-addon">
            <i className="pi pi-search" aria-hidden />
          </span>
          <InputText
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            aria-label="Search assets"
            className="w-full"
          />
        </div>
      </div>
      <p className="text-sm text-color-secondary mt-0 mb-0">
        Select a row and choose Select, or double-click a row. Results are
        loaded page by page from the server.
      </p>
      <div className="min-h-0 flex-1 w-full">
        <DataTable
          lazy
          paginator
          rows={rowsPerPage}
          first={first}
          totalRecords={totalRecords}
          rowsPerPageOptions={[25, 50, 100]}
          onPage={(e) => {
            setFirst(e.first)
            setRowsPerPage(e.rows)
          }}
          value={rows}
          loading={loading}
          dataKey="id"
          selection={selected}
          onSelectionChange={(e) => setSelected(e.value as Asset | null)}
          selectionMode="single"
          metaKeySelection={false}
          onRowDoubleClick={(e) => {
            const row = e.data as Asset
            setSelected(row)
            onSelect(row)
            onHide()
          }}
          emptyMessage={
            debouncedSearch.trim()
              ? 'No records match your search.'
              : 'No assets available.'
          }
          stripedRows
          scrollable
          scrollHeight={tableScrollHeight}
          tableStyle={{ width: 'max-content', minWidth: '100%' }}
        >
          <Column
            field="site_key"
            header="Site"
            body={siteColumnBody}
            style={{ minWidth: '14rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="asset_type"
            header="Object type"
            body={(row: Asset) =>
              row.asset_type && ASSET_TYPE_LABELS[row.asset_type] ? (
                <AssetTypeIconLabel type={row.asset_type} />
              ) : (
                '—'
              )
            }
            style={{ minWidth: '12rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="key"
            header="Key"
            style={{ minWidth: '8rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="name"
            header="Name"
            style={{ minWidth: '14rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="asset_classification_key"
            header="Classification"
            body={(row: Asset) =>
              row.asset_classification_key
                ? `${row.asset_classification_key} — ${row.asset_classification_name ?? ''}`
                : '—'
            }
            style={{ minWidth: '14rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="parent_asset_key"
            header="Parent"
            body={(row: Asset) =>
              row.parent_asset_key
                ? `${row.parent_asset_key} — ${row.parent_asset_name ?? ''}`
                : '—'
            }
            style={{ minWidth: '16rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="costcenter_key"
            header="Cost center"
            body={(row: Asset) => row.costcenter_key ?? '—'}
            style={{ minWidth: '11rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="equipment_number"
            header="Equip. #"
            body={(row: Asset) => row.equipment_number ?? '—'}
            style={{ minWidth: '8rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="serial_no"
            header="Serial"
            body={(row: Asset) => row.serial_no ?? '—'}
            style={{ minWidth: '10rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="build_year"
            header="Build yr."
            body={(row: Asset) =>
              row.build_year != null ? String(row.build_year) : '—'
            }
            style={{ minWidth: '6rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="warranty_end"
            header="Warranty end"
            body={(row: Asset) =>
              row.warranty_end ? formatDate(row.warranty_end) : '—'
            }
            style={{ minWidth: '9rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="priority"
            header="Prio"
            body={(row: Asset) =>
              row.priority != null ? String(row.priority) : '—'
            }
            style={{ minWidth: '5rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="has_thumbnail"
            header="Photo"
            body={(row: Asset) => (row.has_thumbnail ? 'Yes' : '—')}
            style={{ minWidth: '6rem', whiteSpace: 'nowrap' }}
          />
          <Column
            field="created_at"
            header="Created at"
            body={(row: Asset) => formatDateTime(row.created_at)}
            style={{ minWidth: '13rem', whiteSpace: 'nowrap' }}
          />
        </DataTable>
      </div>
      <div className="flex justify-content-end gap-2 pt-2 border-top-1 surface-border flex-shrink-0">
        <Button
          type="button"
          label="Cancel"
          severity="secondary"
          outlined
          onClick={onHide}
        />
        <Button
          type="button"
          label="Select"
          icon="pi pi-check"
          disabled={!selected}
          onClick={confirmSelect}
        />
      </div>
    </div>
  )
}
