import { apiJson } from '../api'
import type { TableLayoutPresetDto } from './types'

export async function fetchTableLayouts(appPath: string) {
  return apiJson<{
    presets: TableLayoutPresetDto[]
    default_preset_id: string | null
  }>(`/api/table-layouts?app_path=${encodeURIComponent(appPath)}`)
}

export async function upsertTableLayout(
  appPath: string,
  layoutKey: string,
  settingsJson: unknown,
) {
  return apiJson<{ preset: TableLayoutPresetDto }>('/api/table-layouts', {
    method: 'PUT',
    body: JSON.stringify({
      app_path: appPath,
      layout_key: layoutKey,
      settings_json: settingsJson,
    }),
  })
}

export async function deleteTableLayout(presetId: string) {
  await apiJson<undefined>(`/api/table-layouts/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
  })
}

export async function patchTableLayoutDefault(
  appPath: string,
  presetId: string | null,
) {
  return apiJson<{ default_preset_id: string | null }>(
    '/api/table-layouts/default',
    {
      method: 'PATCH',
      body: JSON.stringify({
        app_path: appPath,
        preset_id: presetId,
      }),
    },
  )
}

export async function putTableLayoutShares(presetId: string, userIds: string[]) {
  return apiJson<{ shares: { user_id: string; login_name: string }[] }>(
    `/api/table-layouts/${encodeURIComponent(presetId)}/shares`,
    {
      method: 'PUT',
      body: JSON.stringify({ user_ids: userIds }),
    },
  )
}

export async function fetchTableLayoutShares(presetId: string) {
  return apiJson<{ shares: { user_id: string; login_name: string }[] }>(
    `/api/table-layouts/${encodeURIComponent(presetId)}/shares`,
  )
}

export async function postTableLayoutShareBatch(
  appPath: string,
  presetIds: string[],
  userId: string,
) {
  return apiJson<{ ok: boolean; preset_count: number }>(
    '/api/table-layouts/share-batch',
    {
      method: 'POST',
      body: JSON.stringify({
        app_path: appPath,
        preset_ids: presetIds,
        user_id: userId,
      }),
    },
  )
}
