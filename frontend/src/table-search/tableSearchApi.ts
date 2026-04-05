import { apiJson } from '../api'
import type { SearchPresetDto } from './types'

export async function fetchSearchPresets(appPath: string) {
  return apiJson<{
    presets: SearchPresetDto[]
    default_preset_id: string | null
  }>(`/api/search-presets?app_path=${encodeURIComponent(appPath)}`)
}

export async function upsertSearchPreset(
  appPath: string,
  presetKey: string,
  settingsJson: unknown,
) {
  return apiJson<{ preset: SearchPresetDto }>('/api/search-presets', {
    method: 'PUT',
    body: JSON.stringify({
      app_path: appPath,
      preset_key: presetKey,
      settings_json: settingsJson,
    }),
  })
}

export async function deleteSearchPreset(presetId: string) {
  await apiJson<undefined>(`/api/search-presets/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
  })
}

export async function patchSearchPresetDefault(
  appPath: string,
  presetId: string | null,
) {
  return apiJson<{ default_preset_id: string | null }>(
    '/api/search-presets/default',
    {
      method: 'PATCH',
      body: JSON.stringify({
        app_path: appPath,
        preset_id: presetId,
      }),
    },
  )
}
