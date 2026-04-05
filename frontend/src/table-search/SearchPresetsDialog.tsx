import type { TFunction } from 'i18next'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import type { SearchPresetDto } from './types'

export function SearchPresetsDialog({
  visible,
  onHide,
  t,
  presets,
  ownPresets,
  activePresetId,
  defaultPresetId,
  presetKey,
  setPresetKey,
  onPickPreset,
  onSave,
  onDeleteOwnPreset,
  onSetDefault,
  saving,
}: {
  visible: boolean
  onHide: () => void
  t: TFunction
  presets: SearchPresetDto[]
  ownPresets: SearchPresetDto[]
  activePresetId: string | null
  defaultPresetId: string | null
  presetKey: string
  setPresetKey: (value: string) => void
  onPickPreset: (presetId: string | null) => void
  onSave: () => void
  onDeleteOwnPreset: (presetId: string) => void
  onSetDefault: (presetId: string | null) => void
  saving: boolean
}) {
  const allOptions = presets.map((preset) => ({
    label: `${preset.preset_key}${preset.owner_login_name ? ` - ${preset.owner_login_name}` : ''}`,
    value: preset.id,
  }))
  const ownOptions = ownPresets.map((preset) => ({
    label: preset.preset_key,
    value: preset.id,
  }))

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      dismissableMask={!saving}
      header={t('search_panel.presets_title')}
      style={{ width: 'min(48rem, 96vw)' }}
      baseZIndex={1300}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button
            type="button"
            label={t('common.cancel')}
            severity="secondary"
            outlined
            onClick={onHide}
            disabled={saving}
          />
        </div>
      }
    >
      <div className="flex flex-column gap-3">
        <div className="flex flex-column gap-2">
          <label className="text-sm font-medium">{t('search_panel.load_preset')}</label>
          <Dropdown
            value={activePresetId}
            options={allOptions}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onPickPreset((e.value as string | null) ?? null)}
            placeholder={t('search_panel.select_preset')}
            showClear
            className="w-full"
          />
        </div>
        <div className="flex flex-column gap-2">
          <label className="text-sm font-medium">{t('search_panel.preset_name')}</label>
          <div className="flex gap-2">
            <InputText
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              placeholder={t('search_panel.preset_name_placeholder')}
              className="w-full"
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-save"
              onClick={onSave}
              loading={saving}
              disabled={!presetKey.trim()}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            label={t('search_panel.set_default')}
            icon="pi pi-star"
            outlined
            onClick={() => onSetDefault(activePresetId)}
            disabled={!activePresetId || saving}
          />
          <Button
            type="button"
            label={t('search_panel.clear_default')}
            icon="pi pi-times-circle"
            outlined
            onClick={() => onSetDefault(null)}
            disabled={!defaultPresetId || saving}
          />
          <Dropdown
            value={null}
            options={ownOptions}
            optionLabel="label"
            optionValue="value"
            placeholder={t('search_panel.delete_preset')}
            className="w-16rem"
            onChange={(e) => {
              const presetId = e.value as string | null
              if (!presetId) return
              onDeleteOwnPreset(presetId)
            }}
            disabled={ownOptions.length === 0 || saving}
          />
        </div>
      </div>
    </Dialog>
  )
}
