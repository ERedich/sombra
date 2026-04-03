import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { DataTable } from 'primereact/datatable'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { apiJson } from '../../api'
import { AppShell } from '../../layout/AppShell'
import type { ColumnRegistryEntry } from '../../table-wizard'
import {
  BulkOperationOverlay,
  shouldShowBulkTableFeedback,
  useTableWizard,
  useTableWizardToastEffect,
} from '../../table-wizard'

type MatrixResponse = {
  msg_keys: string[]
  locale_codes: string[]
  by_locale: Record<string, Record<string, string>>
}

type Row = { msg_key: string } & Record<string, string>

/** Fixed row height for Prime virtual scroller (px). Keep in sync with cell + textarea styles. */
const VIRTUAL_ROW_HEIGHT_PX = 84

function cloneRows(rows: Row[]): Row[] {
  return rows.map((r) => ({ ...r }))
}

function matrixDiffers(
  rows: Row[],
  baseline: Row[],
  localeCodes: string[],
): boolean {
  if (rows.length !== baseline.length) return true
  const baseByKey = new Map(baseline.map((r) => [r.msg_key, r]))
  for (const row of rows) {
    const b = baseByKey.get(row.msg_key)
    if (!b) return true
    for (const lc of localeCodes) {
      if ((row[lc] ?? '') !== (b[lc] ?? '')) return true
    }
  }
  return false
}

const TranslationCell = memo(function TranslationCell({
  msgKey,
  locale,
  value,
  onChange,
}: {
  msgKey: string
  locale: string
  value: string
  onChange: (msgKey: string, locale: string, value: string) => void
}) {
  return (
    <InputTextarea
      value={value}
      onChange={(e) => onChange(msgKey, locale, e.target.value)}
      rows={2}
      className="w-full translation-matrix-textarea"
      style={{
        height: '3.75rem',
        overflow: 'auto',
        resize: 'none',
      }}
    />
  )
})

export default function TranslationsAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [localeCodes, setLocaleCodes] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [baselineRows, setBaselineRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [bulkPersistOverlay, setBulkPersistOverlay] = useState(false)
  const [keyFilter, setKeyFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<MatrixResponse>('/api/translations/matrix')
      setLocaleCodes(data.locale_codes)
      const next: Row[] = data.msg_keys.map((k) => {
        const row: Row = { msg_key: k }
        for (const lc of data.locale_codes) {
          row[lc] = data.by_locale[lc]?.[k] ?? ''
        }
        return row
      })
      setRows(next)
      setBaselineRows(cloneRows(next))
    } catch {
      setError(t('translations.load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () =>
      baselineRows.length > 0 &&
      matrixDiffers(rows, baselineRows, localeCodes),
    [rows, baselineRows, localeCodes],
  )

  const onCellChange = useCallback(
    (msgKey: string, locale: string, value: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.msg_key === msgKey ? { ...r, [locale]: value } : r,
        ),
      )
    },
    [],
  )

  const filteredRows = useMemo(() => {
    const q = keyFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.msg_key.toLowerCase().includes(q))
  }, [rows, keyFilter])

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<Row>[] => {
    const defs: ColumnRegistryEntry<Row>[] = [
      { field: 'msg_key', headerKey: 'translations.col_key', sortable: true },
    ]
    for (const lc of localeCodes) {
      defs.push({
        field: lc,
        headerKey: lc.toUpperCase(),
        sortable: true,
        body: (row) => (
          <TranslationCell
            msgKey={row.msg_key}
            locale={lc}
            value={row[lc] ?? ''}
            onChange={onCellChange}
          />
        ),
      })
    }
    return defs
  }, [localeCodes, onCellChange])

  const tw = useTableWizard<Row>({
    appPath: '/translations',
    columnDefs: tableColumnDefs,
    largeTableRowCount: filteredRows.length,
    layoutToastRef: toast,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  const save = async () => {
    if (!dirty) return
    const updates: { locale: string; msg_key: string; value: string }[] = []
    for (const row of rows) {
      const prev = baselineRows.find((p) => p.msg_key === row.msg_key)
      if (!prev) continue
      for (const lc of localeCodes) {
        const a = row[lc] ?? ''
        const b = prev[lc] ?? ''
        if (a !== b) {
          updates.push({ locale: lc, msg_key: row.msg_key, value: a })
        }
      }
    }
    if (updates.length === 0) {
      setBaselineRows(cloneRows(rows))
      return
    }
    const bulk = shouldShowBulkTableFeedback(rows.length, updates.length)
    setBulkPersistOverlay(bulk)
    if (bulk) {
      toast.current?.show({
        severity: 'info',
        summary: t('common.bulk_table_rows_busy'),
        life: 8000,
      })
    }
    setSaving(true)
    try {
      await apiJson('/api/translations', {
        method: 'PATCH',
        body: JSON.stringify({ updates }),
      })
      setBaselineRows(cloneRows(rows))
      toast.current?.show({
        severity: 'success',
        summary: t('translations.saved'),
        life: 2500,
      })
    } catch {
      toast.current?.show({
        severity: 'error',
        summary: t('translations.save_error'),
        life: 4000,
      })
    } finally {
      setSaving(false)
      setBulkPersistOverlay(false)
    }
  }

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <BulkOperationOverlay visible={bulkPersistOverlay && saving} />
      {tw.wizardDialog}
      <div
        className="p-4 app-page-mw-xl flex flex-column gap-3 min-h-0"
        style={{ height: 'calc(100vh - 3rem)' }}
      >
        <Card
          className="shadow-1 border-round-xl overflow-hidden flex flex-column h-full min-h-0"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={
            <div className="app-card-hero flex flex-column gap-1 p-4 md:p-5 w-full">
              <div className="flex align-items-start justify-content-between gap-3 flex-wrap w-full">
                <div className="flex align-items-start gap-3 min-w-0 flex-1">
                  <div
                    className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
                    aria-hidden
                  >
                    <i className="pi pi-language text-2xl" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="app-card-hero-title mt-0 mb-0">
                      {t('translations.title')}
                    </h1>
                    <p className="app-card-hero-desc mb-0">
                      {t('translations.subtitle')}
                    </p>
                  </div>
                </div>
                <div className="flex align-items-center gap-2 flex-shrink-0 align-self-start">
                  <Button
                    type="button"
                    label={t('translations.save')}
                    icon="pi pi-save"
                    onClick={() => void save()}
                    loading={saving}
                    disabled={!dirty || loading}
                  />
                  {tw.heroTableWizard}
                </div>
              </div>
            </div>
          }
        >
          <div className="px-1 md:px-2 flex flex-column gap-3 flex-1 min-h-0">
            {error ? (
              <Message severity="error" text={error} className="w-full" />
            ) : null}
            {dirty ? (
              <Message
                severity="warn"
                text={t('translations.unsaved')}
                className="w-full"
              />
            ) : null}
            <div className="flex align-items-center gap-2 flex-wrap w-full">
              <IconField
                iconPosition="left"
                className="flex-1"
                style={{ maxWidth: '24rem' }}
              >
                <InputIcon className="pi pi-search" />
                <InputText
                  value={keyFilter}
                  onChange={(e) => setKeyFilter(e.target.value)}
                  placeholder={t('common.search_ellipsis')}
                  aria-label={t('translations.col_key')}
                  className="w-full"
                />
              </IconField>
            </div>
            <div className="min-w-0 min-h-0 flex-1 flex flex-column">
              {/* PrimeReact DataTable union types disagree with virtualScroller + tableLayoutProps spread */}
              <DataTable
                value={tw.prepareRows(filteredRows)}
                loading={loading || tw.tableBusy}
                dataKey="msg_key"
                scrollable
                scrollHeight="calc(100vh - 16rem)"
                size="small"
                stripedRows
                emptyMessage={t('translations.empty')}
                virtualScrollerOptions={{
                  itemSize: VIRTUAL_ROW_HEIGHT_PX,
                  numToleratedItems: 10,
                }}
                tableStyle={{ width: 'max-content', minWidth: '100%' }}
                {...(tw.tableLayoutProps as Record<string, unknown>)}
              >
                {tw.renderColumns()}
              </DataTable>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
