import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import { Button } from 'primereact/button'
import { Checkbox } from 'primereact/checkbox'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { OrderList } from 'primereact/orderlist'
import { TabPanel, TabView } from 'primereact/tabview'
import { confirmDialog } from 'primereact/confirmdialog'
import type { ColumnRegistryEntry } from './types'
import type { TableLayoutPresetDto, TableSettingsV1 } from './types'

type ColumnOrderItem = { field: string; headerKey: string; visible: boolean }

type SortLevel = { field: string; order: 1 | -1 }

type TableWizardDialogProps<T> = {
  visible: boolean
  onHide: () => void
  t: TFunction
  columnDefs: ColumnRegistryEntry<T>[]
  defsByField: Record<string, ColumnRegistryEntry<T>>
  draft: TableSettingsV1
  setDraft: React.Dispatch<React.SetStateAction<TableSettingsV1>>
  onApply: () => void
  layoutKey: string
  setLayoutKey: (v: string) => void
  onSaveLayout: () => void
  onDeleteLayout: () => void
  onDeleteOwnPreset: (presetId: string) => void
  onSetDefault: (presetId: string | null) => void
  activePresetId: string | null
  isOwner: boolean
  saving: boolean
  defaultPresetId: string | null
  defaultLocked: boolean
  ownPresets: TableLayoutPresetDto[]
  assignedPresets: TableLayoutPresetDto[]
  overwriteTargetPresetId: string | null
  setOverwriteTargetPresetId: (v: string | null) => void
  onSaveOverwrite: (presetId: string) => void
  manageSharePresetId: string | null
  setManageSharePresetId: (v: string | null) => void
  manageShareUserIds: string[]
  setManageShareUserIds: (ids: string[]) => void
  onUpdateManageShares: () => void
  batchSharePresetIds: string[]
  setBatchSharePresetIds: (ids: string[]) => void
  batchShareUserId: string | null
  setBatchShareUserId: (id: string | null) => void
  sameSiteUserOptions: { label: string; value: string }[]
  onBatchShare: () => void
  ownPresetMultiOptions: { label: string; value: string }[]
}

export function TableWizardDialog<T>({
  visible,
  onHide,
  t,
  columnDefs,
  defsByField,
  draft,
  setDraft,
  onApply,
  layoutKey,
  setLayoutKey,
  onSaveLayout,
  onDeleteLayout,
  onDeleteOwnPreset,
  onSetDefault,
  activePresetId,
  isOwner,
  saving,
  defaultPresetId,
  defaultLocked,
  ownPresets,
  assignedPresets,
  overwriteTargetPresetId,
  setOverwriteTargetPresetId,
  onSaveOverwrite,
  manageSharePresetId,
  setManageSharePresetId,
  manageShareUserIds,
  setManageShareUserIds,
  onUpdateManageShares,
  batchSharePresetIds,
  setBatchSharePresetIds,
  batchShareUserId,
  setBatchShareUserId,
  sameSiteUserOptions,
  onBatchShare,
  ownPresetMultiOptions,
}: TableWizardDialogProps<T>) {
  const columnList: ColumnOrderItem[] = useMemo(() => {
    return draft.columnOrder.map((field) => {
      const def = defsByField[field]
      return {
        field,
        headerKey: def?.headerKey ?? field,
        visible: draft.columnVisibility[field] !== false,
      }
    })
  }, [draft.columnOrder, draft.columnVisibility, defsByField])

  const sortLevels: SortLevel[] = useMemo(() => {
    return draft.multiSortMeta.map((m) => ({
      field: m.field,
      order: m.order,
    }))
  }, [draft.multiSortMeta])

  const sortableFields = useMemo(
    () => columnDefs.filter((c) => c.sortable !== false).map((c) => c.field),
    [columnDefs],
  )

  const groupFieldOptions = useMemo(
    () => [
      { label: t('table_wizard.group_by_none'), value: null },
      ...columnDefs.map((c) => ({
        label: t(c.headerKey),
        value: c.field,
      })),
    ],
    [columnDefs, t],
  )

  const granOptions = useMemo(
    () => [
      { label: t('table_wizard.granularity_none'), value: 'none' as const },
      { label: t('table_wizard.granularity_year'), value: 'year' as const },
      { label: t('table_wizard.granularity_month'), value: 'month' as const },
      {
        label: t('table_wizard.granularity_iso_week'),
        value: 'iso_week' as const,
      },
    ],
    [t],
  )

  const groupedCol = draft.groupByField
    ? defsByField[draft.groupByField]
    : undefined
  const showDateGran =
    !!groupedCol &&
    (groupedCol.type === 'date' || groupedCol.type === 'datetime')

  const visibleColumnCount = useMemo(
    () => columnList.filter((c) => c.visible).length,
    [columnList],
  )

  const managePresetOptions = useMemo(
    () =>
      ownPresets.map((p) => ({
        label: p.layout_key,
        value: p.id,
      })),
    [ownPresets],
  )

  const defaultCheckboxDisabled = !activePresetId || defaultLocked

  function confirmDeleteOwnPreset(p: TableLayoutPresetDto) {
    confirmDialog({
      header: t('table_wizard.delete_own_header'),
      message: t('table_wizard.delete_own_msg', { key: p.layout_key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void onDeleteOwnPreset(p.id),
    })
  }

  function confirmDeleteActiveLayout() {
    if (!activePresetId || !isOwner) return
    const key =
      ownPresets.find((p) => p.id === activePresetId)?.layout_key ?? layoutKey
    confirmDialog({
      header: t('table_wizard.delete_own_header'),
      message: t('table_wizard.delete_own_msg', { key }),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void onDeleteLayout(),
    })
  }

  return (
    <Dialog
      header={t('table_wizard.title')}
      visible={visible}
      onHide={onHide}
      dismissableMask={!saving}
      style={{ width: 'min(var(--app-page-mw-screen-pct), 96vw)' }}
      className="table-wizard-dialog"
      footer={
        <div className="flex justify-content-end gap-2 flex-wrap">
          <Button
            type="button"
            label={t('common.cancel')}
            severity="secondary"
            outlined
            onClick={onHide}
            disabled={saving}
          />
          <Button
            type="button"
            label={t('table_wizard.apply')}
            icon="pi pi-check"
            onClick={onApply}
            disabled={saving}
          />
        </div>
      }
    >
      <TabView className="app-modal-tabview">
        <TabPanel header={t('table_wizard.tab_columns')}>
          <div className="app-modal-tab-content flex flex-column gap-3">
            <p className="text-sm text-color-secondary m-0">
              {t('table_wizard.freeze_help')}
            </p>
            <div className="flex flex-wrap gap-2 align-items-center">
              <label
                htmlFor="tw-frozen-n"
                className="text-sm font-medium white-space-nowrap"
              >
                {t('table_wizard.freeze_first_n')}
              </label>
              <InputNumber
                id="tw-frozen-n"
                value={draft.frozenLeftCount ?? 0}
                min={0}
                max={Math.max(0, visibleColumnCount)}
                showButtons
                onValueChange={(e) => {
                  const v = e.value
                  setDraft((prev) => ({
                    ...prev,
                    frozenLeftCount:
                      typeof v === 'number' && v >= 0
                        ? Math.min(Math.floor(v), visibleColumnCount)
                        : 0,
                  }))
                }}
              />
            </div>
            <div className="flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="text-sm font-medium">
                {t('table_wizard.col_widths_section')}
              </span>
              <Button
                type="button"
                label={t('table_wizard.clear_col_widths')}
                icon="pi pi-times"
                text
                size="small"
                severity="secondary"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, columnWidths: {} }))
                }
              />
            </div>
            <OrderList
              dataKey="field"
              value={columnList}
              onChange={(e) => {
                const next = e.value as ColumnOrderItem[]
                setDraft((prev) => ({
                  ...prev,
                  columnOrder: next.map((x) => x.field),
                  columnVisibility: {
                    ...prev.columnVisibility,
                    ...Object.fromEntries(
                      next.map((x) => [x.field, x.visible]),
                    ),
                  },
                }))
              }}
              itemTemplate={(item: ColumnOrderItem) => (
                <div className="table-wizard-order-row">
                  <Checkbox
                    checked={item.visible}
                    onChange={(e) => {
                      const vis = e.checked === true
                      setDraft((prev) => {
                        const columnVisibility = {
                          ...prev.columnVisibility,
                          [item.field]: vis,
                        }
                        const visCount = prev.columnOrder.filter(
                          (f) => columnVisibility[f] !== false,
                        ).length
                        return {
                          ...prev,
                          columnVisibility,
                          frozenLeftCount: Math.min(
                            prev.frozenLeftCount ?? 0,
                            visCount,
                          ),
                        }
                      })
                    }}
                  />
                  <span className="table-wizard-order-label min-w-0">
                    {t(item.headerKey)}
                  </span>
                  <div className="table-wizard-order-width flex align-items-center gap-1 flex-shrink-0">
                    <span className="text-xs text-color-secondary white-space-nowrap">
                      {t('table_wizard.col_width_px')}
                    </span>
                    <InputNumber
                      inputId={`tw-col-w-${item.field}`}
                      value={draft.columnWidths?.[item.field] ?? null}
                      min={40}
                      max={2000}
                      placeholder={t('table_wizard.col_width_auto')}
                      showButtons
                      className="table-wizard-col-width-input"
                      onValueChange={(e) => {
                        const v = e.value
                        setDraft((prev) => {
                          const cw = { ...prev.columnWidths }
                          if (v == null || v === undefined) {
                            delete cw[item.field]
                          } else {
                            cw[item.field] = Math.max(
                              40,
                              Math.min(2000, Math.round(Number(v))),
                            )
                          }
                          return { ...prev, columnWidths: cw }
                        })
                      }}
                    />
                  </div>
                </div>
              )}
            />
          </div>
        </TabPanel>
        <TabPanel header={t('table_wizard.tab_sort')}>
          <div className="app-modal-tab-content flex flex-column gap-3">
            <p className="text-sm text-color-secondary m-0">
              {t('table_wizard.sort_levels')}
            </p>
            {sortLevels.map((level, idx) => (
              <div
                key={`${level.field}-${idx}`}
                className="flex flex-wrap gap-2 align-items-center"
              >
                <Dropdown
                  value={level.field}
                  options={sortableFields.map((f) => ({
                    label: t(defsByField[f]?.headerKey ?? f),
                    value: f,
                  }))}
                  onChange={(e) => {
                    const field = String(e.value)
                    setDraft((prev) => {
                      const next = [...prev.multiSortMeta]
                      next[idx] = { field, order: level.order }
                      return { ...prev, multiSortMeta: next }
                    })
                  }}
                  className="flex-1"
                  style={{ minWidth: '12rem' }}
                />
                <Dropdown
                  value={level.order}
                  options={[
                    { label: t('table_wizard.sort_asc'), value: 1 },
                    { label: t('table_wizard.sort_desc'), value: -1 },
                  ]}
                  onChange={(e) => {
                    const order = e.value as 1 | -1
                    setDraft((prev) => {
                      const next = [...prev.multiSortMeta]
                      next[idx] = { field: level.field, order }
                      return { ...prev, multiSortMeta: next }
                    })
                  }}
                />
                <Button
                  type="button"
                  icon="pi pi-times"
                  rounded
                  text
                  severity="secondary"
                  aria-label={t('common.delete')}
                  onClick={() => {
                    setDraft((prev) => ({
                      ...prev,
                      multiSortMeta: prev.multiSortMeta.filter(
                        (_, i) => i !== idx,
                      ),
                    }))
                  }}
                />
              </div>
            ))}
            <Button
              type="button"
              label={t('table_wizard.add_sort')}
              icon="pi pi-plus"
              outlined
              size="small"
              onClick={() => {
                const first = sortableFields[0]
                if (!first) return
                setDraft((prev) => ({
                  ...prev,
                  multiSortMeta: [
                    ...prev.multiSortMeta,
                    { field: first, order: 1 },
                  ],
                }))
              }}
              disabled={sortableFields.length === 0}
            />
          </div>
        </TabPanel>
        <TabPanel header={t('table_wizard.tab_group')}>
          <div className="app-modal-tab-content flex flex-column gap-3">
            <label className="text-sm font-medium" htmlFor="tw-group-by">
              {t('table_wizard.group_by')}
            </label>
            <Dropdown
              id="tw-group-by"
              value={draft.groupByField ?? null}
              options={groupFieldOptions}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  groupByField: e.value,
                  dateGroupGranularity:
                    e.value &&
                    defsByField[e.value]?.type !== 'date' &&
                    defsByField[e.value]?.type !== 'datetime'
                      ? 'none'
                      : prev.dateGroupGranularity,
                }))
              }
              className="w-full"
            />
            {showDateGran ? (
              <>
                <label className="text-sm font-medium" htmlFor="tw-gran">
                  {t('table_wizard.granularity')}
                </label>
                <Dropdown
                  id="tw-gran"
                  value={draft.dateGroupGranularity ?? 'none'}
                  options={granOptions}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      dateGroupGranularity: e.value,
                    }))
                  }
                  className="w-full"
                />
              </>
            ) : null}
          </div>
        </TabPanel>
        <TabPanel header={t('table_wizard.tab_presets')}>
          <div className="app-modal-tab-content flex flex-column gap-3">
            {!isOwner && activePresetId ? (
              <p className="text-sm text-color-secondary m-0">
                {t('table_wizard.owner_only_edit')}
              </p>
            ) : null}
            <div>
              <p className="text-sm font-medium m-0 mb-2">
                {t('table_wizard.presets_own_heading')}
              </p>
              {ownPresets.length === 0 ? (
                <p className="text-sm text-color-secondary m-0">
                  —
                </p>
              ) : (
                <ul className="m-0 pl-0 list-none flex flex-column gap-1 text-sm">
                  {ownPresets.map((p) => (
                    <li
                      key={p.id}
                      className="flex align-items-center justify-content-between gap-2 flex-wrap table-wizard-own-preset-row"
                    >
                      <span className="min-w-0 flex align-items-center gap-2 flex-wrap">
                        {p.layout_key}
                        {defaultPresetId === p.id ? (
                          <i
                            className="pi pi-check text-green-500 flex-shrink-0"
                            role="img"
                            aria-label={t('table_wizard.preset_default_aria')}
                          />
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        icon="pi pi-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        className="flex-shrink-0"
                        disabled={saving}
                        onClick={() => confirmDeleteOwnPreset(p)}
                        aria-label={t('table_wizard.delete_own_aria', {
                          key: p.layout_key,
                        })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-sm font-medium m-0 mb-2">
                {t('table_wizard.presets_assigned_heading')}
              </p>
              {assignedPresets.length === 0 ? (
                <p className="text-sm text-color-secondary m-0">
                  —
                </p>
              ) : (
                <ul className="m-0 pl-0 list-none flex flex-column gap-1 text-sm">
                  {assignedPresets.map((p) => (
                    <li
                      key={p.id}
                      className="flex align-items-center gap-2 flex-wrap"
                    >
                      <span className="min-w-0">
                        {p.layout_key}
                        <span className="text-color-secondary">
                          {' '}
                          (
                          {t('table_wizard.presets_assigned_by', {
                            owner: p.owner_login_name,
                          })}
                          )
                        </span>
                      </span>
                      {defaultPresetId === p.id ? (
                        <i
                          className="pi pi-check text-green-500 flex-shrink-0"
                          role="img"
                          aria-label={t('table_wizard.preset_default_aria')}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-column gap-2">
              <label htmlFor="tw-layout-key" className="text-sm font-medium">
                {t('table_wizard.layout_key')}
              </label>
              <InputText
                id="tw-layout-key"
                value={layoutKey}
                onChange={(e) => setLayoutKey(e.target.value)}
                placeholder={t('table_wizard.layout_key_placeholder')}
                className="w-full"
                disabled={!isOwner && !!activePresetId}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                label={t('table_wizard.save_layout')}
                icon="pi pi-save"
                onClick={onSaveLayout}
                loading={saving}
                disabled={!isOwner || !layoutKey.trim()}
              />
              <Button
                type="button"
                label={t('table_wizard.delete_layout')}
                icon="pi pi-trash"
                severity="danger"
                outlined
                onClick={confirmDeleteActiveLayout}
                disabled={!isOwner || !activePresetId || saving}
              />
            </div>
            {ownPresetMultiOptions.length > 0 ? (
              <div className="flex flex-column gap-2">
                <label
                  htmlFor="tw-overwrite-preset"
                  className="text-sm font-medium"
                >
                  {t('table_wizard.save_to_existing')}
                </label>
                <p className="text-sm text-color-secondary m-0">
                  {t('table_wizard.save_to_existing_help')}
                </p>
                <div className="flex flex-wrap gap-2 align-items-center">
                  <Dropdown
                    id="tw-overwrite-preset"
                    value={overwriteTargetPresetId}
                    options={ownPresetMultiOptions}
                    onChange={(e) =>
                      setOverwriteTargetPresetId(e.value as string | null)
                    }
                    placeholder={t('table_wizard.save_to_existing_placeholder')}
                    className="flex-1"
                    style={{ minWidth: '12rem' }}
                    showClear
                  />
                  <Button
                    type="button"
                    label={t('table_wizard.save_to_existing_apply')}
                    icon="pi pi-upload"
                    outlined
                    onClick={() => {
                      if (overwriteTargetPresetId) {
                        onSaveOverwrite(overwriteTargetPresetId)
                      }
                    }}
                    disabled={!overwriteTargetPresetId || saving}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex flex-column gap-2">
              <div className="flex align-items-center gap-2">
                <Checkbox
                  inputId="tw-default"
                  checked={
                    !!activePresetId && defaultPresetId === activePresetId
                  }
                  onChange={(e) => {
                    if (defaultLocked) return
                    if (!activePresetId) return
                    void onSetDefault(e.checked ? activePresetId : null)
                  }}
                  disabled={defaultCheckboxDisabled}
                />
                <label htmlFor="tw-default" className="text-sm cursor-pointer">
                  {t('table_wizard.set_default')}
                </label>
              </div>
              {defaultLocked ? (
                <p className="text-sm text-color-secondary m-0">
                  {t('table_wizard.default_locked_help')}
                </p>
              ) : null}
            </div>
          </div>
        </TabPanel>
        <TabPanel header={t('table_wizard.tab_sharing')}>
          <div className="app-modal-tab-content flex flex-column gap-3">
            <p className="text-sm text-color-secondary m-0">
              {t('table_wizard.sharing_batch_help')}
            </p>
            <div>
              <p className="text-sm font-medium m-0 mb-2">
                {t('table_wizard.sharing_batch_heading')}
              </p>
              <label
                className="text-sm font-medium"
                htmlFor="tw-batch-presets"
              >
                {t('table_wizard.sharing_batch_presets')}
              </label>
              <MultiSelect
                id="tw-batch-presets"
                value={batchSharePresetIds}
                options={ownPresetMultiOptions}
                onChange={(e) =>
                  setBatchSharePresetIds((e.value as string[]) ?? [])
                }
                display="chip"
                className="w-full mt-1"
                filter
                disabled={ownPresetMultiOptions.length === 0}
              />
            </div>
            <div className="flex flex-column gap-2">
              <label className="text-sm font-medium" htmlFor="tw-batch-user">
                {t('table_wizard.sharing_batch_user')}
              </label>
              <Dropdown
                id="tw-batch-user"
                value={batchShareUserId}
                options={sameSiteUserOptions}
                onChange={(e) =>
                  setBatchShareUserId((e.value as string | null) ?? null)
                }
                placeholder={t('table_wizard.sharing_batch_user')}
                className="w-full"
                showClear
                filter
              />
            </div>
            <Button
              type="button"
              label={t('table_wizard.sharing_batch_submit')}
              icon="pi pi-user-plus"
              onClick={onBatchShare}
              loading={saving}
              disabled={
                batchSharePresetIds.length === 0 ||
                !batchShareUserId ||
                ownPresetMultiOptions.length === 0
              }
            />
            {managePresetOptions.length > 0 ? (
              <>
                <div className="border-top-1 surface-border my-3 w-full" />
                <p className="text-sm font-medium m-0">
                  {t('table_wizard.sharing_manage_heading')}
                </p>
                <label
                  className="text-sm font-medium"
                  htmlFor="tw-manage-preset"
                >
                  {t('table_wizard.sharing_manage_preset')}
                </label>
                <Dropdown
                  id="tw-manage-preset"
                  value={manageSharePresetId}
                  options={managePresetOptions}
                  onChange={(e) =>
                    setManageSharePresetId((e.value as string | null) ?? null)
                  }
                  className="w-full"
                />
                <label className="text-sm font-medium" htmlFor="tw-manage-share">
                  {t('table_wizard.share_with')}
                </label>
                <MultiSelect
                  id="tw-manage-share"
                  value={manageShareUserIds}
                  options={sameSiteUserOptions}
                  onChange={(e) =>
                    setManageShareUserIds((e.value as string[]) ?? [])
                  }
                  display="chip"
                  className="w-full"
                  filter
                  placeholder={t('table_wizard.share_with')}
                  disabled={!manageSharePresetId}
                />
                <Button
                  type="button"
                  label={t('table_wizard.update_shares')}
                  icon="pi pi-users"
                  outlined
                  onClick={onUpdateManageShares}
                  loading={saving}
                  disabled={!manageSharePresetId}
                />
              </>
            ) : null}
          </div>
        </TabPanel>
      </TabView>
    </Dialog>
  )
}
