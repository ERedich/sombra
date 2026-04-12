import type { KeyboardEvent } from 'react'
import type { TFunction } from 'i18next'
import { Sidebar } from 'primereact/sidebar'
import { Button } from 'primereact/button'
import { Calendar, type CalendarProps } from 'primereact/calendar'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import type { SearchableColumnDef, TableSearchSettingsV1 } from './types'

/** Match Calendar’s datepicker icon to the adjacent clear control (outlined secondary; theme hover fill). */
const searchPanelCalendarPt = {
  dropdownButton: {
    root: { className: 'p-button-outlined p-button-secondary' },
  },
} as NonNullable<CalendarProps['pt']>

export function SearchPanel<T extends Record<string, unknown>>({
  visible,
  onHide,
  t,
  columns,
  draft,
  onDraftRangeFieldChange,
  onDraftMultiValuesChange,
  onApply,
  onClear,
  onReset,
  onOpenPresets,
  presetCount,
}: {
  visible: boolean
  onHide: () => void
  t: TFunction
  columns: SearchableColumnDef<T>[]
  draft: TableSearchSettingsV1
  onDraftRangeFieldChange: (field: string, bound: 'from' | 'to', value: string) => void
  onDraftMultiValuesChange: (field: string, values: string[]) => void
  onApply: () => void
  onClear: () => void
  onReset: () => void
  onOpenPresets: () => void
  presetCount: number
}) {
  const handleEnterApply = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onApply()
  }

  const parseDateValue = (raw: string): Date | null => {
    const value = raw.trim()
    if (!value) return null
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return null
    return new Date(ms)
  }

  const toStoredDateValue = (
    value: Date | null,
    inputType: SearchableColumnDef<T>['inputType'],
  ): string => {
    if (!value) return ''
    if (inputType === 'datetime') return value.toISOString()
    // Date-only fields persist as YYYY-MM-DD to keep intent clear.
    return value.toISOString().slice(0, 10)
  }

  const actionButtons = (
    <div className="flex flex-wrap gap-2 justify-content-end">
      <Button
        type="button"
        label={t('search_panel.presets')}
        icon="pi pi-bookmark"
        severity="success"
        outlined
        badge={String(Math.max(0, presetCount))}
        badgeClassName="p-badge-success"
        onClick={onOpenPresets}
      />
      <Button
        type="button"
        label={t('search_panel.reset')}
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        onClick={onReset}
      />
      <Button
        type="button"
        label={t('search_panel.clear')}
        icon="pi pi-times"
        severity="secondary"
        outlined
        onClick={onClear}
      />
      <Button
        type="button"
        label={t('search_panel.apply')}
        icon="pi pi-check"
        onClick={onApply}
      />
    </div>
  )

  return (
    <Sidebar
      visible={visible}
      position="right"
      onHide={onHide}
      dismissable
      blockScroll
      baseZIndex={1200}
      style={{ width: '50vw', maxWidth: '98vw', minWidth: '30rem' }}
      header={t('search_panel.title')}
      className="search-panel-sidebar"
    >
      <div className="flex flex-column gap-3 pb-3">
        {actionButtons}
        <p className="text-sm text-color-secondary m-0">
          {t('search_panel.help')}
        </p>
        {columns.map((column) => {
          const criterion = draft.criteria[column.field]
          const fromValue = criterion?.from ?? ''
          const toValue = criterion?.to ?? ''
          const isRangeField =
            column.inputType === 'number' ||
            column.inputType === 'date' ||
            column.inputType === 'datetime'
          return (
            <div
              key={column.field}
              className="surface-ground border-round p-3 flex flex-column gap-2"
            >
              <label className="text-sm font-medium">{t(column.headerKey)}</label>
              {column.inputType === 'multiselect' ? (
                <MultiSelect
                  value={criterion?.selectedValues ?? []}
                  options={column.options ?? []}
                  optionLabel="label"
                  optionValue="value"
                  onChange={(e) =>
                    onDraftMultiValuesChange(
                      column.field,
                      ((e.value as string[]) ?? []).filter((v) => !!v),
                    )
                  }
                  placeholder={t('search_panel.select_values')}
                  className="w-full"
                  display="chip"
                  filter
                />
              ) : (
                <div className="grid">
                  <div className={isRangeField ? 'col-12 md:col-6' : 'col-12'}>
                    <div className="p-inputgroup w-full">
                      {column.inputType === 'date' || column.inputType === 'datetime' ? (
                        <Calendar
                          value={parseDateValue(fromValue)}
                          onChange={(e) =>
                            onDraftRangeFieldChange(
                              column.field,
                              'from',
                              toStoredDateValue(
                                (e.value as Date | null) ?? null,
                                column.inputType,
                              ),
                            )
                          }
                          showIcon
                          showButtonBar
                          showTime={column.inputType === 'datetime'}
                          hourFormat="24"
                          placeholder={t('search_panel.from_placeholder')}
                          className="w-full"
                          inputClassName="w-full"
                          pt={searchPanelCalendarPt}
                        />
                      ) : (
                        <InputText
                          value={fromValue}
                          onChange={(e) =>
                            onDraftRangeFieldChange(column.field, 'from', e.target.value)
                          }
                          onKeyDown={handleEnterApply}
                          placeholder={
                            isRangeField
                              ? t('search_panel.from_placeholder')
                              : t('common.search_ellipsis')
                          }
                          className="w-full"
                        />
                      )}
                      <Button
                        type="button"
                        icon="pi pi-times"
                        outlined
                        severity="secondary"
                        onClick={() =>
                          onDraftRangeFieldChange(column.field, 'from', '')
                        }
                        disabled={!fromValue}
                        aria-label={t('search_panel.clear')}
                      />
                    </div>
                  </div>
                  {isRangeField ? (
                    <div className="col-12 md:col-6">
                      <div className="p-inputgroup w-full">
                        {column.inputType === 'date' || column.inputType === 'datetime' ? (
                          <Calendar
                            value={parseDateValue(toValue)}
                            onChange={(e) =>
                              onDraftRangeFieldChange(
                                column.field,
                                'to',
                                toStoredDateValue(
                                  (e.value as Date | null) ?? null,
                                  column.inputType,
                                ),
                              )
                            }
                            showIcon
                            showButtonBar
                            showTime={column.inputType === 'datetime'}
                            hourFormat="24"
                            placeholder={t('search_panel.to_placeholder')}
                            className="w-full"
                            inputClassName="w-full"
                            pt={searchPanelCalendarPt}
                          />
                        ) : (
                          <InputText
                            value={toValue}
                            onChange={(e) =>
                              onDraftRangeFieldChange(column.field, 'to', e.target.value)
                            }
                            onKeyDown={handleEnterApply}
                            placeholder={t('search_panel.to_placeholder')}
                            className="w-full"
                          />
                        )}
                        <Button
                          type="button"
                          icon="pi pi-times"
                          outlined
                          severity="secondary"
                          onClick={() =>
                            onDraftRangeFieldChange(column.field, 'to', '')
                          }
                          disabled={!toValue}
                          aria-label={t('search_panel.clear')}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
        {actionButtons}
      </div>
    </Sidebar>
  )
}
