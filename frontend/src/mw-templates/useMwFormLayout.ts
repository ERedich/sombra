import { useCallback, useEffect, useState } from 'react'
import {
  defaultMwLayoutJson,
  mergeMwLayoutJson,
  type MwFormShellKey,
  type MwLayoutJson,
} from '@sombra/shared'
import { ApiError, apiJson } from '../api'

type EffectiveResponse = {
  shell_key: string
  layout_json: MwLayoutJson | null
}

export function useMwFormLayout(
  shell: MwFormShellKey,
  enabled = true,
): {
  layout: MwLayoutJson
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [layout, setLayout] = useState<MwLayoutJson>(() =>
    defaultMwLayoutJson(shell),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await apiJson<EffectiveResponse>(
        `/api/mw-form-templates/effective?shell_key=${encodeURIComponent(shell)}`,
      )
      const merged =
        d.layout_json === null
          ? defaultMwLayoutJson(shell)
          : mergeMwLayoutJson(shell, d.layout_json)
      setLayout(merged)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load layout.')
      setLayout(defaultMwLayoutJson(shell))
    } finally {
      setLoading(false)
    }
  }, [shell])

  useEffect(() => {
    if (!enabled) {
      setLayout(defaultMwLayoutJson(shell))
      setLoading(false)
      setError(null)
      return
    }
    void load()
  }, [enabled, shell, load])

  return { layout, loading, error, reload: load }
}
