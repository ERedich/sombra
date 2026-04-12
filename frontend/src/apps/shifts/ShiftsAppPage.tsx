/**
 * Site-scoped shift definitions: key, name, start/end time, available weekdays (ISO 1–7).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { ButtonGroup } from 'primereact/buttongroup'
import { Calendar } from 'primereact/calendar'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'

export type Shift = {
  id: string
  site_id: string
  site_key: string
  site_name: string
  site_colour: string
  key: string
  name: string
  time_start: string
  time_end: string
  available_weekdays: number[]
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

type ShiftsListResponse = { shifts: Shift[] }
type ShiftResponse = { shift: Shift }

function timeStrToDate(s: string): Date {
  const parts = s.trim().split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  return new Date(1970, 0, 1, h, m, 0)
}

function dateToTimeApi(d: Date | null): string {
  if (!d) return '08:00'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatHm(s: string): string {
  const parts = s.trim().split(':')
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`
  return s
}

function siteColumnBody(row: Shift, dash: string) {
  const colour =
    typeof row.site_colour === 'string' && row.site_colour.trim() !== ''
      ? row.site_colour.trim()
      : '#94a3b8'
  return (
    <div className="flex align-items-center gap-2">
      <span
        className="border-round border-1 border-300 flex-shrink-0"
        style={{
          width: '1.25rem',
          height: '1.25rem',
          backgroundColor: colour,
        }}
      />
      <span className="text-sm">
        {row.site_key} {dash} {row.site_name}
      </span>
    </div>
  )
}

export default function ShiftsAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formTimeStart, setFormTimeStart] = useState<Date | null>(
    () => new Date(1970, 0, 1, 8, 0, 0),
  )
  const [formTimeEnd, setFormTimeEnd] = useState<Date | null>(
    () => new Date(1970, 0, 1, 16, 0, 0),
  )
  const [formWeekdays, setFormWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [selected, setSelected] = useState<Shift | null>(null)
  const [search, setSearch] = useState('')
  const emDash = t('common.em_dash')

  const weekdayOptions = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].map((v) => ({
        label: t(`shifts.weekday_${v}` as const),
        value: v,
      })),
    [t],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.site_key.toLowerCase().includes(q) ||
        r.site_name.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        formatHm(r.time_start).includes(q) ||
        formatHm(r.time_end).includes(q),
    )
  }, [rows, search])

  const showError = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'error',
        summary: t('common.toast_error'),
        detail,
        life: 5000,
      })
    },
    [t],
  )

  const showSuccess = useCallback(
    (detail: string) => {
      toast.current?.show({
        severity: 'success',
        summary: t('common.toast_success'),
        detail,
        life: 3000,
      })
    },
    [t],
  )

  const loadShifts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<ShiftsListResponse>('/api/shifts')
      setRows(data.shifts ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('shifts.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadShifts()
  }, [loadShifts])

  function openCreate() {
    setSelected(null)
    setEditingId(null)
    setFormKey('')
    setFormName('')
    setFormTimeStart(new Date(1970, 0, 1, 8, 0, 0))
    setFormTimeEnd(new Date(1970, 0, 1, 16, 0, 0))
    setFormWeekdays([1, 2, 3, 4, 5])
    setDialogOpen(true)
  }

  function openEdit(row: Shift) {
    setEditingId(row.id)
    setFormKey(row.key)
    setFormName(row.name)
    setFormTimeStart(timeStrToDate(row.time_start))
    setFormTimeEnd(timeStrToDate(row.time_end))
    setFormWeekdays(
      [...row.available_weekdays].sort((a, b) => a - b),
    )
    setDialogOpen(true)
  }

  async function saveShift() {
    const key = formKey.trim()
    const name = formName.trim()
    const time_start = dateToTimeApi(formTimeStart)
    const time_end = dateToTimeApi(formTimeEnd)
    if (!key || !name) {
      showError('Key and name are required.')
      return
    }
    if (formWeekdays.length === 0) {
      showError('Select at least one weekday.')
      return
    }
    setSaving(true)
    try {
      const body = {
        key,
        name,
        time_start,
        time_end,
        available_weekdays: [...formWeekdays].sort((a, b) => a - b),
      }
      if (editingId) {
        const data = await apiJson<ShiftResponse>(
          `/api/shifts/${editingId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        )
        setRows((prev) =>
          prev.map((r) => (r.id === editingId ? data.shift : r)),
        )
        setSelected((cur) =>
          cur?.id === editingId ? data.shift : cur,
        )
        showSuccess(t('shifts.saved'))
      } else {
        const data = await apiJson<ShiftResponse>('/api/shifts', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setRows((prev) =>
          [...prev, data.shift].sort((a, b) =>
            `${a.site_key} ${a.key}`.localeCompare(`${b.site_key} ${b.key}`),
          ),
        )
        showSuccess(t('shifts.saved'))
      }
      setDialogOpen(false)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('common.toast_error'))
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(row: Shift) {
    confirmDialog({
      header: t('common.delete'),
      message: t('shifts.delete_confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => void deleteShift(row.id),
    })
  }

  async function deleteShift(id: string) {
    try {
      await apiJson<undefined>(`/api/shifts/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((r) => r.id !== id))
      setSelected((cur) => (cur?.id === id ? null : cur))
      showSuccess(t('shifts.deleted'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('common.toast_error'))
      }
    }
  }

  const cardSubTitle = useMemo(() => {
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('work_types.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('work_types.subtitle_no_sites')
    }
    return t('shifts.subtitle')
  }, [t])

  const headerNode = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-clock text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('shifts.title')}</h1>
        <p className="app-card-hero-desc">{cardSubTitle}</p>
      </div>
    </div>
  )

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog dismissableMask />

      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={headerNode}
        >
          <div className="px-1 md:px-2">
            <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-3 w-full">
              <ButtonGroup>
                <Button
                  type="button"
                  label={t('shifts.create')}
                  icon="pi pi-plus"
                  onClick={openCreate}
                />
                <Button
                  type="button"
                  label={t('common.edit')}
                  icon="pi pi-pencil"
                  disabled={!selected}
                  onClick={() => selected && openEdit(selected)}
                />
                <Button
                  type="button"
                  label={t('common.delete')}
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={!selected}
                  onClick={() => selected && confirmDelete(selected)}
                />
              </ButtonGroup>
              <IconField
                iconPosition="left"
                className="app-crud-toolbar-search flex-shrink-0"
                style={{ width: 'min(20rem, 100%)' }}
              >
                <InputIcon className="pi pi-search" />
                <InputText
                  ref={toolbarSearchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search_ellipsis')}
                  className="w-full"
                />
              </IconField>
            </div>

            <DataTable
              value={filteredRows}
              loading={loading}
              dataKey="id"
              selectionMode="single"
              selection={selected}
              onSelectionChange={(e) =>
                setSelected((e.value as Shift | null) ?? null)
              }
              paginator
              rows={25}
              rowsPerPageOptions={[10, 25, 50]}
              emptyMessage={t('common.empty')}
              className="text-sm"
            >
              <Column
                header={t('common.col_site')}
                body={(row: Shift) => siteColumnBody(row, emDash)}
                sortable
                sortField="site_key"
              />
              <Column field="key" header={t('common.col_key')} sortable />
              <Column field="name" header={t('common.col_name')} sortable />
              <Column
                header={t('shifts.field_time_start')}
                body={(row: Shift) => formatHm(row.time_start)}
                sortable
                sortField="time_start"
              />
              <Column
                header={t('shifts.field_time_end')}
                body={(row: Shift) => formatHm(row.time_end)}
                sortable
                sortField="time_end"
              />
              <Column
                header={t('shifts.field_weekdays')}
                body={(row: Shift) =>
                  [...row.available_weekdays]
                    .sort((a, b) => a - b)
                    .map((d) => t(`shifts.weekday_${d}` as const))
                    .join(', ')
                }
              />
            </DataTable>
          </div>
        </Card>
      </div>

      <Dialog
        header={editingId ? t('shifts.edit') : t('shifts.create')}
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        style={{ width: 'min(32rem, 96vw)' }}
        dismissableMask
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveShift()}
              loading={saving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label htmlFor="shift_key" className="text-sm font-medium">
              {t('common.col_key')}
            </label>
            <InputText
              id="shift_key"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label htmlFor="shift_name" className="text-sm font-medium">
              {t('common.col_name')}
            </label>
            <InputText
              id="shift_name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="grid">
            <div className="col-12 md:col-6 flex flex-column gap-2">
              <label className="text-sm font-medium">
                {t('shifts.field_time_start')}
              </label>
              <Calendar
                value={formTimeStart}
                onChange={(e) => setFormTimeStart(e.value as Date | null)}
                timeOnly
                hourFormat="24"
                showIcon
                className="w-full"
                inputClassName="w-full"
                disabled={saving}
              />
            </div>
            <div className="col-12 md:col-6 flex flex-column gap-2">
              <label className="text-sm font-medium">
                {t('shifts.field_time_end')}
              </label>
              <Calendar
                value={formTimeEnd}
                onChange={(e) => setFormTimeEnd(e.value as Date | null)}
                timeOnly
                hourFormat="24"
                showIcon
                className="w-full"
                inputClassName="w-full"
                disabled={saving}
              />
            </div>
          </div>
          <p className="text-xs text-color-secondary m-0">
            {t('shifts.overnight_hint')}
          </p>
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">
              {t('shifts.field_weekdays')}
            </label>
            <MultiSelect
              value={formWeekdays}
              options={weekdayOptions}
              onChange={(e) => setFormWeekdays((e.value as number[]) ?? [])}
              display="chip"
              className="w-full"
              disabled={saving}
              optionLabel="label"
              optionValue="value"
            />
          </div>
        </div>
      </Dialog>
    </AppShell>
  )
}
