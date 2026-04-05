import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api'
import { getStoredUser } from '../auth'
import type { SearchableColumnDef, SearchPresetDto, TableSearchSettingsV1 } from './types'
import { buildDefaultSearchSettings, parseSearchSettingsJson } from './settings'
import {
  deleteSearchPreset,
  fetchSearchPresets,
  patchSearchPresetDefault,
  upsertSearchPreset,
} from './tableSearchApi'

export function useTableSearch<T extends Record<string, unknown>>({
  appPath,
  searchableColumns,
  enabled = true,
}: {
  appPath: string
  searchableColumns: SearchableColumnDef<T>[]
  enabled?: boolean
}) {
  const defaultSettings = useMemo(() => buildDefaultSearchSettings(), [])
  const [applied, setApplied] = useState<TableSearchSettingsV1>(defaultSettings)
  const [draft, setDraft] = useState<TableSearchSettingsV1>(defaultSettings)
  const [presets, setPresets] = useState<SearchPresetDto[]>([])
  const [defaultPresetId, setDefaultPresetId] = useState<string | null>(null)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [presetKey, setPresetKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toastError, setToastError] = useState<string | null>(null)

  const clearToastError = useCallback(() => setToastError(null), [])

  const columnSet = useMemo(
    () => new Set(searchableColumns.map((column) => column.field)),
    [searchableColumns],
  )

  const loadPresets = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const data = await fetchSearchPresets(appPath)
      setPresets(data.presets)
      setDefaultPresetId(data.default_preset_id)
      const presetId = data.default_preset_id
      if (!presetId) {
        setActivePresetId(null)
        setPresetKey('')
        setApplied(defaultSettings)
        return
      }
      const preset = data.presets.find((item) => item.id === presetId)
      if (!preset) {
        setActivePresetId(null)
        setPresetKey('')
        setApplied(defaultSettings)
        return
      }
      const parsed = parseSearchSettingsJson(preset.settings_json)
      setActivePresetId(preset.id)
      setPresetKey(preset.preset_key)
      setApplied(parsed)
    } catch (err) {
      if (err instanceof ApiError) setToastError('search_panel.load_error')
      setApplied(defaultSettings)
    } finally {
      setLoading(false)
    }
  }, [appPath, defaultSettings, enabled])

  useEffect(() => {
    void loadPresets()
  }, [loadPresets])

  useEffect(() => {
    setDraft(applied)
  }, [applied])

  const activeCriteriaCount = useMemo(
    () =>
      Object.values(applied.criteria).filter(
        (item) =>
          item.from.trim() !== '' ||
          item.to.trim() !== '' ||
          (item.selectedValues?.length ?? 0) > 0,
      ).length,
    [applied],
  )

  const setDraftRangeField = useCallback(
    (field: string, bound: 'from' | 'to', value: string) => {
      if (!columnSet.has(field)) return
      setDraft((prev) => {
        const nextCriteria = { ...prev.criteria }
        const current = nextCriteria[field] ?? { from: '', to: '', selectedValues: [] }
        const next = { ...current, [bound]: value }
        if (
          next.from.trim() === '' &&
          next.to.trim() === '' &&
          (next.selectedValues?.length ?? 0) === 0
        ) {
          delete nextCriteria[field]
        } else {
          nextCriteria[field] = next
        }
        return { ...prev, criteria: nextCriteria }
      })
    },
    [columnSet],
  )

  const setDraftMultiValues = useCallback(
    (field: string, values: string[]) => {
      if (!columnSet.has(field)) return
      setDraft((prev) => {
        const nextCriteria = { ...prev.criteria }
        const current = nextCriteria[field] ?? { from: '', to: '', selectedValues: [] }
        const next = { ...current, selectedValues: values }
        if (
          next.from.trim() === '' &&
          next.to.trim() === '' &&
          (next.selectedValues?.length ?? 0) === 0
        ) {
          delete nextCriteria[field]
        } else {
          nextCriteria[field] = next
        }
        return { ...prev, criteria: nextCriteria }
      })
    },
    [columnSet],
  )

  const clearDraftField = useCallback(
    (field: string) => {
      if (!columnSet.has(field)) return
      setDraft((prev) => {
        const nextCriteria = { ...prev.criteria }
        delete nextCriteria[field]
        return { ...prev, criteria: nextCriteria }
      })
    },
    [columnSet],
  )

  const clearDraft = useCallback(() => {
    setDraft(buildDefaultSearchSettings())
  }, [])

  const resetDraftToApplied = useCallback(() => {
    setDraft(applied)
  }, [applied])

  const applyDraft = useCallback(() => {
    setApplied(draft)
  }, [draft])

  const pickPreset = useCallback(
    (presetId: string | null) => {
      if (!presetId) {
        setActivePresetId(null)
        setPresetKey('')
        setApplied(defaultSettings)
        return
      }
      const preset = presets.find((item) => item.id === presetId)
      if (!preset) return
      const parsed = parseSearchSettingsJson(preset.settings_json)
      setActivePresetId(preset.id)
      setPresetKey(preset.preset_key)
      setApplied(parsed)
    },
    [defaultSettings, presets],
  )

  const currentUserId = getStoredUser()?.id ?? ''
  const ownPresets = useMemo(
    () => presets.filter((preset) => preset.owner_user_id === currentUserId),
    [presets, currentUserId],
  )
  const isOwnerOfActive = useMemo(() => {
    if (!activePresetId) return true
    const active = presets.find((preset) => preset.id === activePresetId)
    return !active || active.owner_user_id === currentUserId
  }, [activePresetId, presets, currentUserId])

  const savePreset = useCallback(async () => {
    const key = presetKey.trim()
    if (!enabled || !key) return
    setSaving(true)
    try {
      const { preset } = await upsertSearchPreset(appPath, key, draft)
      setPresets((prev) => {
        const rest = prev.filter(
          (item) =>
            !(
              item.owner_user_id === preset.owner_user_id &&
              item.app_path === preset.app_path &&
              item.preset_key === preset.preset_key
            ),
        )
        return [...rest, preset]
      })
      setActivePresetId(preset.id)
      setApplied(draft)
      setToastError(null)
    } catch (err) {
      if (err instanceof ApiError) setToastError('search_panel.save_error')
    } finally {
      setSaving(false)
    }
  }, [appPath, draft, enabled, presetKey])

  const deletePresetById = useCallback(
    async (presetId: string) => {
      if (!enabled) return
      const preset = presets.find((item) => item.id === presetId)
      if (!preset || preset.owner_user_id !== currentUserId) return
      setSaving(true)
      try {
        await deleteSearchPreset(presetId)
        const next = presets.filter((item) => item.id !== presetId)
        setPresets(next)
        if (defaultPresetId === presetId) setDefaultPresetId(null)
        if (activePresetId === presetId) {
          setActivePresetId(null)
          setPresetKey('')
          setApplied(defaultSettings)
        }
        setToastError(null)
      } catch (err) {
        if (err instanceof ApiError) setToastError('search_panel.save_error')
      } finally {
        setSaving(false)
      }
    },
    [
      activePresetId,
      currentUserId,
      defaultPresetId,
      defaultSettings,
      enabled,
      presets,
    ],
  )

  const setDefault = useCallback(
    async (presetId: string | null) => {
      if (!enabled) return
      try {
        const result = await patchSearchPresetDefault(appPath, presetId)
        setDefaultPresetId(result.default_preset_id)
      } catch (err) {
        if (err instanceof ApiError) setToastError('search_panel.save_error')
      }
    },
    [appPath, enabled],
  )

  return {
    applied,
    draft,
    setDraft,
    setDraftRangeField,
    setDraftMultiValues,
    clearDraftField,
    clearDraft,
    resetDraftToApplied,
    applyDraft,
    activeCriteriaCount,
    presets,
    ownPresets,
    activePresetId,
    defaultPresetId,
    presetKey,
    setPresetKey,
    pickPreset,
    savePreset,
    deletePresetById,
    setDefault,
    isOwnerOfActive,
    loading,
    saving,
    reloadPresets: loadPresets,
    toastError,
    clearToastError,
  }
}
