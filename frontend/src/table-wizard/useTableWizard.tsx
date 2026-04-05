import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import type { Toast } from 'primereact/toast'
import type {
  DataTableProps,
  DataTableRowToggleEvent,
} from 'primereact/datatable'
import { ObjectUtils } from 'primereact/utils'
import { Dropdown } from 'primereact/dropdown'
import { ApiError } from '../api'
import { getStoredUser } from '../auth'
import { TableWizardDialog } from './TableWizardDialog'
import {
  mergeExpandedRowGroups,
  preparedGroupedDataFingerprint,
  prepareRowsWithGroup,
  sameExpandedGroupKeys,
  seedExpandedRowGroups,
  sortRowsForDataTable,
} from './groupKey'
import {
  buildDefaultSettings,
  parseSettingsJson,
  reorderVisibleColumnOrder,
} from './settings'
import {
  deleteTableLayout,
  fetchTableLayoutShares,
  fetchTableLayouts,
  patchTableLayoutDefault,
  postTableLayoutShareBatch,
  putTableLayoutShares,
  upsertTableLayout,
} from './tableLayoutApi'
import { TABLE_BULK_ROW_THRESHOLD } from './bulkTableFeedback'
import type { ColumnRegistryEntry, TableLayoutPresetDto } from './types'
import type { TableSettingsV1 } from './types'
import { TW_GROUP_FIELD } from './types'

type UserRow = {
  id: string
  login_name: string
  name: string
  working_site_id: string | null
  additional_sites: { id: string; key: string; name: string }[]
}

function userSharesWorkingSite(
  u: UserRow,
  siteId: string | null | undefined,
): boolean {
  if (!siteId) return true
  if (u.working_site_id === siteId) return true
  const add = u.additional_sites ?? []
  return add.some((s) => s.id === siteId)
}

export function useTableWizard<T extends Record<string, unknown>>({
  appPath,
  columnDefs,
  rowGroupCollapsible = true,
  frozenScrollHeight = '70vh',
  largeTableRowCount,
  layoutToastRef,
}: {
  appPath: string
  columnDefs: ColumnRegistryEntry<T>[]
  /** When false, group rows are not collapsible (e.g. server-paged `value`). Default true. */
  rowGroupCollapsible?: boolean
  /** Used when frozenLeftCount is greater than 0 (Prime requires scrollable + height). */
  frozenScrollHeight?: string
  /** Current row count for deferred layout apply when &gt; {@link TABLE_BULK_ROW_THRESHOLD}. */
  largeTableRowCount?: number
  /** Optional toast for “applying layout” on large tables (same ref as page `Toast` is fine). */
  layoutToastRef?: RefObject<Toast | null>
}) {
  const { t } = useTranslation()
  const defsByField = useMemo(() => {
    const m: Record<string, ColumnRegistryEntry<T>> = {}
    for (const c of columnDefs) m[c.field] = c
    return m
  }, [columnDefs])

  const factoryDefaults = useMemo(
    () => buildDefaultSettings(columnDefs),
    [columnDefs],
  )

  const [applied, setApplied] = useState<TableSettingsV1>(factoryDefaults)
  const [draft, setDraft] = useState<TableSettingsV1>(factoryDefaults)
  const [presets, setPresets] = useState<TableLayoutPresetDto[]>([])
  const [defaultPresetId, setDefaultPresetId] = useState<string | null>(null)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState('')
  const [manageSharePresetId, setManageSharePresetId] = useState<string | null>(
    null,
  )
  const [manageShareUserIds, setManageShareUserIds] = useState<string[]>([])
  const [batchSharePresetIds, setBatchSharePresetIds] = useState<string[]>([])
  const [batchShareUserId, setBatchShareUserId] = useState<string | null>(null)
  const [overwriteTargetPresetId, setOverwriteTargetPresetId] = useState<
    string | null
  >(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [layoutApplying, setLayoutApplying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toastError, setToastError] = useState<string | null>(null)
  const lastPreparedRef = useRef<T[] | null>(null)
  /** Fingerprint of `lastPreparedRef` — updated only when `prepareRows` recomputes (avoids O(n) scans each render). */
  const lastPreparedFingerprintRef = useRef<string | null>(null)
  /** Last fingerprint we synced into `expandedRows` (not updated during render). */
  const lastSyncedExpandedFingerprintRef = useRef<string | null>(null)
  const prevGroupByRef = useRef<string | null | undefined>(undefined)
  /** Skip map+sort when only `expandedRows` (or unrelated state) changes; inputs are stable by reference. */
  const prepareRowsCacheRef = useRef<{
    rows: T[]
    applied: TableSettingsV1
    defsByField: Record<string, ColumnRegistryEntry<T>>
    result: T[]
  } | null>(null)
  const [expandedRows, setExpandedRows] = useState<T[]>([])

  const clearToastError = useCallback(() => setToastError(null), [])

  const currentUserId = getStoredUser()?.id ?? ''
  const workingSiteId = getStoredUser()?.working_site_id ?? null

  const loadLayouts = useCallback(async () => {
    try {
      const data = await fetchTableLayouts(appPath)
      setPresets(data.presets)
      setDefaultPresetId(data.default_preset_id)
      const defId = data.default_preset_id
      if (defId) {
        const p = data.presets.find((x) => x.id === defId)
        if (p) {
          setActivePresetId(p.id)
          setLayoutKey(p.layout_key)
          setApplied(
            parseSettingsJson(p.settings_json, factoryDefaults),
          )
        }
      } else {
        setActivePresetId(null)
        setLayoutKey('')
        setApplied(factoryDefaults)
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setToastError(t('table_wizard.load_error'))
      }
      setApplied(factoryDefaults)
    } finally {
      setLoading(false)
    }
  }, [appPath, factoryDefaults, t])

  useEffect(() => {
    void loadLayouts()
  }, [loadLayouts])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { apiJson } = await import('../api')
        const data = await apiJson<{ users: UserRow[] }>('/api/users')
        if (!cancelled) setUsers(data.users)
      } catch {
        if (!cancelled) setUsers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  )

  const isOwner =
    !activePreset || activePreset.owner_user_id === currentUserId

  const ownPresets = useMemo(
    () => presets.filter((p) => p.owner_user_id === currentUserId),
    [presets, currentUserId],
  )

  const assignedPresets = useMemo(
    () => presets.filter((p) => p.shared),
    [presets],
  )

  const defaultLocked = useMemo(() => {
    if (!defaultPresetId || !currentUserId) return false
    const preset = presets.find((p) => p.id === defaultPresetId)
    return preset ? preset.owner_user_id !== currentUserId : false
  }, [defaultPresetId, presets, currentUserId])

  const sameSiteUserOptions = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUserId)
      .filter((u) => userSharesWorkingSite(u, workingSiteId))
      .map((u) => ({
        label: `${u.login_name} (${u.name})`,
        value: u.id,
      }))
  }, [users, currentUserId, workingSiteId])

  const presetDropdownGroupedOptions = useMemo(() => {
    const toOpt = (p: TableLayoutPresetDto) => ({
      label: p.shared
        ? `${p.layout_key} — ${p.owner_login_name}`
        : p.layout_key,
      value: p.id,
    })
    const groups = [
      { label: t('table_wizard.preset_group_own'), items: ownPresets.map(toOpt) },
      {
        label: t('table_wizard.preset_group_assigned'),
        items: assignedPresets.map(toOpt),
      },
    ]
    return groups.filter((g) => g.items.length > 0)
  }, [ownPresets, assignedPresets, t])

  const openDialog = useCallback(() => {
    setDraft(applied)
    setToastError(null)
    setOverwriteTargetPresetId(null)
    setBatchSharePresetIds([])
    setBatchShareUserId(null)
    setDialogOpen(true)
  }, [applied])

  useEffect(() => {
    if (!dialogOpen) return
    const own = presets.filter((p) => p.owner_user_id === currentUserId)
    if (activePresetId && own.some((p) => p.id === activePresetId)) {
      setManageSharePresetId(activePresetId)
    } else if (own[0]) {
      setManageSharePresetId(own[0].id)
    } else {
      setManageSharePresetId(null)
    }
  }, [dialogOpen, activePresetId, presets, currentUserId])

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchTableLayouts(appPath)
        if (cancelled) return
        setPresets(data.presets)
        setDefaultPresetId(data.default_preset_id)
        if (activePresetId) {
          const p = data.presets.find((x) => x.id === activePresetId)
          if (p) {
            const next = parseSettingsJson(p.settings_json, factoryDefaults)
            setApplied(next)
            setDraft(next)
          }
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dialogOpen, appPath, activePresetId, factoryDefaults])

  useEffect(() => {
    if (!dialogOpen || !manageSharePresetId) return
    const p = presets.find((x) => x.id === manageSharePresetId)
    if (!p || p.owner_user_id !== currentUserId) return
    let cancelled = false
    void fetchTableLayoutShares(manageSharePresetId)
      .then(({ shares }) => {
        if (!cancelled) setManageShareUserIds(shares.map((s) => s.user_id))
      })
      .catch(() => {
        if (!cancelled) setManageShareUserIds([])
      })
    return () => {
      cancelled = true
    }
  }, [dialogOpen, manageSharePresetId, presets, currentUserId])

  const applyDraft = useCallback(() => {
    lastSyncedExpandedFingerprintRef.current = null
    const large = (largeTableRowCount ?? 0) > TABLE_BULK_ROW_THRESHOLD
    if (large) {
      setLayoutApplying(true)
      layoutToastRef?.current?.show({
        severity: 'info',
        summary: t('common.table_layout_applying'),
        life: 7000,
      })
      setDialogOpen(false)
      window.setTimeout(() => {
        setApplied(draft)
        window.setTimeout(() => setLayoutApplying(false), 0)
      }, 0)
    } else {
      setApplied(draft)
      setDialogOpen(false)
    }
  }, [draft, largeTableRowCount, layoutToastRef, t])

  const onSort = useCallback((e: { multiSortMeta?: { field: string; order: number | null | undefined }[] | null }) => {
    const meta = e.multiSortMeta
    if (!meta || !Array.isArray(meta)) return
    const next = meta
      .filter(
        (m) =>
          m &&
          typeof m.field === 'string' &&
          (m.order === 1 || m.order === -1),
      )
      .map((m) => ({
        field: m.field as string,
        order: m.order as 1 | -1,
      }))
    setApplied((prev) => ({ ...prev, multiSortMeta: next }))
  }, [])

  const onColReorder = useCallback(
    (e: { dragIndex: number; dropIndex: number }) => {
      setApplied((prev) => ({
        ...prev,
        columnOrder: reorderVisibleColumnOrder(
          prev.columnOrder,
          prev.columnVisibility,
          e.dragIndex,
          e.dropIndex,
        ),
      }))
    },
    [],
  )

  const onColumnResizeEnd = useCallback(
    (e: {
      element: HTMLElement
      column: { props?: { field?: string } }
    }) => {
      const field = e.column?.props?.field
      if (!field || typeof field !== 'string') return
      const w = Math.round(e.element.offsetWidth)
      if (w < 40) return
      setApplied((prev) => ({
        ...prev,
        columnWidths: { ...prev.columnWidths, [field]: w },
      }))
    },
    [],
  )

  const handlePresetPick = useCallback(
    (presetId: string | null) => {
      const large = (largeTableRowCount ?? 0) > TABLE_BULK_ROW_THRESHOLD
      const run = () => {
        if (!presetId) {
          setActivePresetId(null)
          setLayoutKey('')
          setApplied(factoryDefaults)
          return
        }
        const p = presets.find((x) => x.id === presetId)
        if (!p) return
        setActivePresetId(p.id)
        setLayoutKey(p.layout_key)
        setApplied(parseSettingsJson(p.settings_json, factoryDefaults))
      }
      if (large) {
        setLayoutApplying(true)
        layoutToastRef?.current?.show({
          severity: 'info',
          summary: t('common.table_layout_applying'),
          life: 7000,
        })
        window.setTimeout(() => {
          run()
          window.setTimeout(() => setLayoutApplying(false), 0)
        }, 0)
      } else {
        run()
      }
    },
    [presets, factoryDefaults, largeTableRowCount, layoutToastRef, t],
  )

  const saveLayout = useCallback(async () => {
    const key = layoutKey.trim()
    if (!key) return
    setSaving(true)
    try {
      const { preset } = await upsertTableLayout(appPath, key, draft)
      setApplied(draft)
      setPresets((prev) => {
        const others = prev.filter(
          (p) =>
            !(
              p.owner_user_id === preset.owner_user_id &&
              p.app_path === preset.app_path &&
              p.layout_key === preset.layout_key
            ),
        )
        return [...others, preset]
      })
      setActivePresetId(preset.id)
      setToastError(null)
    } catch (e) {
      if (e instanceof ApiError) {
        setToastError(t('table_wizard.save_error'))
      }
    } finally {
      setSaving(false)
    }
  }, [appPath, layoutKey, draft, t])

  const removeLayoutById = useCallback(
    async (presetId: string) => {
      const p = presets.find((x) => x.id === presetId)
      if (!p || p.owner_user_id !== currentUserId) return
      setSaving(true)
      try {
        await deleteTableLayout(presetId)
        const nextPresets = presets.filter((x) => x.id !== presetId)
        setPresets(nextPresets)
        setDefaultPresetId((d) => (d === presetId ? null : d))
        setBatchSharePresetIds((ids) => ids.filter((id) => id !== presetId))
        setOverwriteTargetPresetId((prev) => (prev === presetId ? null : prev))
        const nextOwn = nextPresets.filter(
          (x) => x.owner_user_id === currentUserId,
        )
        setManageSharePresetId((prev) => {
          if (prev !== presetId) return prev
          return nextOwn[0]?.id ?? null
        })
        if (activePresetId === presetId) {
          setActivePresetId(null)
          setLayoutKey('')
          setApplied(factoryDefaults)
        }
        setToastError(null)
      } catch (e) {
        if (e instanceof ApiError) {
          setToastError(t('table_wizard.save_error'))
        }
      } finally {
        setSaving(false)
      }
    },
    [presets, currentUserId, activePresetId, factoryDefaults, t],
  )

  const removeLayout = useCallback(async () => {
    if (!activePresetId || !isOwner) return
    await removeLayoutById(activePresetId)
  }, [activePresetId, isOwner, removeLayoutById])

  const setDefault = useCallback(
    async (presetId: string | null) => {
      try {
        const r = await patchTableLayoutDefault(appPath, presetId)
        setDefaultPresetId(r.default_preset_id)
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setToastError(t('table_wizard.default_error_locked'))
        }
      }
    },
    [appPath, t],
  )

  const saveLayoutToExistingPreset = useCallback(
    async (presetId: string) => {
      const p = presets.find((x) => x.id === presetId)
      if (!p || p.owner_user_id !== currentUserId) return
      setSaving(true)
      try {
        const { preset } = await upsertTableLayout(appPath, p.layout_key, draft)
        setApplied(draft)
        setPresets((prev) => {
          const others = prev.filter(
            (x) =>
              !(
                x.owner_user_id === preset.owner_user_id &&
                x.app_path === preset.app_path &&
                x.layout_key === preset.layout_key
              ),
          )
          return [...others, preset]
        })
        setActivePresetId(preset.id)
        setLayoutKey(preset.layout_key)
        setOverwriteTargetPresetId(null)
        setToastError(null)
      } catch (e) {
        if (e instanceof ApiError) {
          setToastError(t('table_wizard.save_error'))
        }
      } finally {
        setSaving(false)
      }
    },
    [appPath, draft, presets, currentUserId, t],
  )

  const updateManageShares = useCallback(async () => {
    if (!manageSharePresetId) return
    const p = presets.find((x) => x.id === manageSharePresetId)
    if (!p || p.owner_user_id !== currentUserId) return
    setSaving(true)
    try {
      await putTableLayoutShares(manageSharePresetId, manageShareUserIds)
    } finally {
      setSaving(false)
    }
  }, [manageSharePresetId, manageShareUserIds, presets, currentUserId])

  const batchShareSubmit = useCallback(async () => {
    if (batchSharePresetIds.length === 0 || !batchShareUserId) return
    setSaving(true)
    try {
      await postTableLayoutShareBatch(
        appPath,
        batchSharePresetIds,
        batchShareUserId,
      )
      setToastError(null)
      layoutToastRef?.current?.show({
        severity: 'success',
        summary: t('table_wizard.share_batch_success'),
        life: 4000,
      })
    } catch (e) {
      if (e instanceof ApiError) {
        setToastError(t('table_wizard.save_error'))
      }
    } finally {
      setSaving(false)
    }
  }, [
    appPath,
    batchSharePresetIds,
    batchShareUserId,
    layoutToastRef,
    t,
  ])

  const prepareRows = useCallback(
    (rows: T[]) => {
      const c = prepareRowsCacheRef.current
      if (
        c &&
        c.rows === rows &&
        c.applied === applied &&
        c.defsByField === defsByField
      ) {
        lastPreparedRef.current = c.result
        return c.result
      }
      const gran = applied.dateGroupGranularity ?? 'none'
      const withG = prepareRowsWithGroup(
        rows as Record<string, unknown>[],
        applied.groupByField,
        gran === 'none' ? 'none' : gran,
        defsByField as Record<string, ColumnRegistryEntry<Record<string, unknown>>>,
      )
      const prepared = sortRowsForDataTable(
        withG as T[],
        applied.groupByField,
        applied.multiSortMeta,
      ) as T[]
      lastPreparedRef.current = prepared
      prepareRowsCacheRef.current = { rows, applied, defsByField, result: prepared }
      lastPreparedFingerprintRef.current = preparedGroupedDataFingerprint(
        prepared as Record<string, unknown>[],
      )
      return prepared
    },
    [applied, defsByField, rowGroupCollapsible],
  )

  // After paint only: never schedule parent state updates from prepareRows (render) or layout.
  // Syncs expanded row groups when prepared data / group-by settings change; skips when fingerprint unchanged.
  useEffect(() => {
    if (!applied.groupByField || !rowGroupCollapsible) {
      // Avoid setExpandedRows([]) every paint: new [] !== prev [] by reference → infinite loop with deps-less effect.
      setExpandedRows((prev) => (prev.length === 0 ? prev : []))
      prevGroupByRef.current = applied.groupByField
      lastSyncedExpandedFingerprintRef.current = null
      return
    }
    const prepared = lastPreparedRef.current
    if (!prepared?.length) {
      return
    }
    const fp = lastPreparedFingerprintRef.current
    if (fp == null || fp === lastSyncedExpandedFingerprintRef.current) {
      return
    }
    lastSyncedExpandedFingerprintRef.current = fp
    const seed = seedExpandedRowGroups(
      prepared as Record<string, unknown>[],
    ) as T[]
    const gb = applied.groupByField
    setExpandedRows((prev) => {
      if (prevGroupByRef.current !== gb) {
        prevGroupByRef.current = gb
        return seed
      }
      const next = mergeExpandedRowGroups(
        prev as Record<string, unknown>[],
        seed as Record<string, unknown>[],
      ) as T[]
      if (sameExpandedGroupKeys(prev, next)) {
        return prev
      }
      return next
    })
  })

  const onRowGroupToggle = useCallback((e: DataTableRowToggleEvent) => {
    const data = e.data
    if (!Array.isArray(data)) return
    setExpandedRows(data as T[])
  }, [])

  /** Memoized so expand/collapse does not rebuild Column elements (major PrimeReact cost). */
  const columnElements = useMemo(() => {
    const fields = applied.columnOrder.filter(
      (f) => applied.columnVisibility[f] !== false,
    )
    const frozenN = Math.min(
      applied.frozenLeftCount ?? 0,
      fields.length,
    )
    return fields.map((field, i) => {
      const def = defsByField[field]
      const w = applied.columnWidths?.[field]
      const frozen = i < frozenN
      return (
        <Column
          key={field}
          field={field}
          sortField={def?.sortField ?? field}
          header={t(def?.headerKey ?? field)}
          sortable={def?.sortable !== false}
          style={w ? { width: w } : undefined}
          frozen={frozen}
          alignFrozen={frozen ? ('left' as const) : undefined}
          bodyClassName={
            def?.cellClassName
              ? (rowData) => def.cellClassName?.(rowData as T) ?? ''
              : undefined
          }
          body={
            def?.body
              ? (row) => def.body!(row as T)
              : (row) => {
                  const v = (row as Record<string, unknown>)[field]
                  return v == null ? '' : String(v)
                }
          }
        />
      )
    })
  }, [applied, defsByField, t])

  const renderColumns = useCallback(() => columnElements, [columnElements])

  const rowGroupHeaderTemplate = useCallback(
    (
      rowData: Record<string, unknown>,
      options: {
        customRendering?: boolean
        props: DataTableProps<Record<string, unknown>[]>
      },
    ) => {
      const visibleFields = applied.columnOrder.filter(
        (f) => applied.columnVisibility[f] !== false,
      )
      const frozenN = Math.min(
        applied.frozenLeftCount ?? 0,
        visibleFields.length,
      )
      const totalCols = visibleFields.length

      if (frozenN === 0) {
        options.customRendering = false
        return (
          <span className="font-semibold">
            {String(rowData[TW_GROUP_FIELD] ?? '')}
          </span>
        )
      }

      options.customRendering = true
      const label = String(rowData[TW_GROUP_FIELD] ?? '')
      const unfrozenColSpan = Math.max(1, totalCols - frozenN)

      const toggleExpand = () => {
        const onToggle = options.props.onRowToggle
        if (!rowGroupCollapsible || !onToggle) return
        const prev = Array.isArray(options.props.expandedRows)
          ? (options.props.expandedRows as Record<string, unknown>[])
          : []
        const idx = prev.findIndex((r) => ObjectUtils.deepEquals(r, rowData))
        const next =
          idx !== -1
            ? prev.filter((_, i) => i !== idx)
            : [...prev, rowData]
        onToggle({ data: next })
      }

      const expanded =
        rowGroupCollapsible &&
        Array.isArray(options.props.expandedRows) &&
        (options.props.expandedRows as unknown[]).some((r) =>
          ObjectUtils.deepEquals(r, rowData),
        )

      const toggler =
        rowGroupCollapsible && (
          <button
            type="button"
            className="p-row-toggler p-link"
            onClick={toggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <span
              className={`p-row-toggler-icon pi ${expanded ? 'pi-chevron-down' : 'pi-chevron-right'}`}
              aria-hidden
            />
          </button>
        )

      const title = (
        <span className="p-rowgroup-header-name font-semibold">{label}</span>
      )

      /* Title + toggler stay in the left (frozen) segment so they align with the first columns. */
      if (frozenN >= totalCols) {
        return (
          <td
            className="p-frozen-column"
            colSpan={totalCols}
            style={{ left: 0 }}
          >
            <span className="flex align-items-center gap-2 flex-wrap">
              {toggler}
              {title}
            </span>
          </td>
        )
      }

      return (
        <>
          <td
            className="p-frozen-column"
            colSpan={frozenN}
            style={{ left: 0 }}
          >
            <span className="flex align-items-center gap-2 flex-wrap">
              {toggler}
              {title}
            </span>
          </td>
          <td colSpan={unfrozenColSpan} />
        </>
      )
    },
    [
      applied.columnOrder,
      applied.columnVisibility,
      applied.frozenLeftCount,
      rowGroupCollapsible,
    ],
  )

  const tableLayoutProps = useMemo(() => {
    const visibleFields = applied.columnOrder.filter(
      (f) => applied.columnVisibility[f] !== false,
    )
    const frozenN = Math.min(
      applied.frozenLeftCount ?? 0,
      visibleFields.length,
    )
    const base = {
      sortMode: 'multiple' as const,
      multiSortMeta: applied.multiSortMeta.map((m) => ({
        field: m.field,
        order: m.order,
      })),
      onSort,
      reorderableColumns: true,
      onColReorder,
      resizableColumns: true,
      columnResizeMode: 'expand' as const,
      onColumnResizeEnd,
      rowGroupMode: applied.groupByField ? ('subheader' as const) : undefined,
      groupRowsBy: applied.groupByField ? TW_GROUP_FIELD : undefined,
      rowGroupHeaderTemplate: applied.groupByField
        ? rowGroupHeaderTemplate
        : undefined,
      ...(frozenN > 0
        ? {
            scrollable: true as const,
            scrollHeight: frozenScrollHeight,
          }
        : {}),
    }
    if (applied.groupByField && rowGroupCollapsible) {
      return {
        ...base,
        className: 'app-datatable-expandable-groups',
        expandableRowGroups: true,
        expandedRows,
        onRowToggle: onRowGroupToggle,
      }
    }
    return base
  }, [
    applied.groupByField,
    applied.multiSortMeta,
    applied.columnOrder,
    applied.columnVisibility,
    applied.frozenLeftCount,
    frozenScrollHeight,
    onSort,
    onColReorder,
    onColumnResizeEnd,
    rowGroupHeaderTemplate,
    rowGroupCollapsible,
    expandedRows,
    onRowGroupToggle,
  ])

  const tableBusy = loading || layoutApplying

  const ownPresetMultiOptions = useMemo(
    () => ownPresets.map((p) => ({ label: p.layout_key, value: p.id })),
    [ownPresets],
  )

  const heroTableWizard = (
    <div className="app-table-wizard-hero flex align-items-center gap-2 flex-shrink-0">
      {presets.length > 0 ? (
        <Dropdown
          value={activePresetId}
          options={presetDropdownGroupedOptions}
          optionGroupLabel="label"
          optionGroupChildren="items"
          optionLabel="label"
          optionValue="value"
          itemTemplate={(option) => {
            if (!option || typeof option !== 'object' || !('value' in option)) {
              return null
            }
            const o = option as { label: string; value: string }
            return (
              <span className="flex align-items-center gap-2 justify-content-between w-full min-w-0">
                <span className="min-w-0">{o.label}</span>
                {defaultPresetId === o.value ? (
                  <i
                    className="pi pi-check text-green-500 flex-shrink-0"
                    role="img"
                    aria-label={t('table_wizard.preset_default_aria')}
                  />
                ) : null}
              </span>
            )
          }}
          valueTemplate={(option) => {
            if (!option || typeof option !== 'object' || !('value' in option)) {
              return <span>{t('table_wizard.preset_placeholder')}</span>
            }
            const o = option as { label: string; value: string }
            return (
              <span className="flex align-items-center gap-2 min-w-0">
                <span className="min-w-0">{o.label}</span>
                {defaultPresetId === o.value ? (
                  <i
                    className="pi pi-check text-green-500 flex-shrink-0"
                    role="img"
                    aria-label={t('table_wizard.preset_default_aria')}
                  />
                ) : null}
              </span>
            )
          }}
          onChange={(e) => handlePresetPick(e.value as string | null)}
          placeholder={t('table_wizard.preset_placeholder')}
          showClear
          className="table-wizard-preset-dropdown"
          style={{ minWidth: '12rem' }}
          disabled={tableBusy}
        />
      ) : null}
      <Button
        type="button"
        icon="pi pi-table"
        rounded
        outlined
        severity="secondary"
        size="small"
        onClick={openDialog}
        aria-label={t('table_wizard.open_aria')}
        title={t('table_wizard.title')}
        disabled={tableBusy}
        className="app-table-wizard-trigger"
      />
    </div>
  )

  const wizardDialog = (
    <TableWizardDialog
      visible={dialogOpen}
      onHide={() => setDialogOpen(false)}
      t={t}
      columnDefs={columnDefs}
      defsByField={defsByField}
      draft={draft}
      setDraft={setDraft}
      onApply={applyDraft}
      layoutKey={layoutKey}
      setLayoutKey={setLayoutKey}
      onSaveLayout={() => void saveLayout()}
      onDeleteLayout={() => void removeLayout()}
      onDeleteOwnPreset={(id) => void removeLayoutById(id)}
      onSetDefault={(id) => void setDefault(id)}
      activePresetId={activePresetId}
      isOwner={isOwner}
      saving={saving}
      defaultPresetId={defaultPresetId}
      defaultLocked={defaultLocked}
      ownPresets={ownPresets}
      assignedPresets={assignedPresets}
      overwriteTargetPresetId={overwriteTargetPresetId}
      setOverwriteTargetPresetId={setOverwriteTargetPresetId}
      onSaveOverwrite={(presetId) => void saveLayoutToExistingPreset(presetId)}
      manageSharePresetId={manageSharePresetId}
      setManageSharePresetId={setManageSharePresetId}
      manageShareUserIds={manageShareUserIds}
      setManageShareUserIds={setManageShareUserIds}
      onUpdateManageShares={() => void updateManageShares()}
      batchSharePresetIds={batchSharePresetIds}
      setBatchSharePresetIds={setBatchSharePresetIds}
      batchShareUserId={batchShareUserId}
      setBatchShareUserId={setBatchShareUserId}
      sameSiteUserOptions={sameSiteUserOptions}
      onBatchShare={() => void batchShareSubmit()}
      ownPresetMultiOptions={ownPresetMultiOptions}
    />
  )

  return {
    heroTableWizard,
    wizardDialog,
    tableLayoutProps,
    prepareRows,
    renderColumns,
    loading,
    /** Initial layout load or deferred large-table layout apply — merge into list `DataTable` loading. */
    tableBusy,
    activePresetId,
    ownPresets,
    /** Apply when a shared preset may have changed (linked layouts). */
    reloadLayouts: loadLayouts,
    toastError,
    clearToastError,
  }
}
