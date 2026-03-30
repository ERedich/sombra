import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { apiJson } from '../../api'
import { AppShell } from '../../layout/AppShell'

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
    } catch (e) {
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

  const localeColumnBodies = useMemo(() => {
    const m = new Map<string, (row: Row) => ReactNode>()
    for (const lc of localeCodes) {
      m.set(lc, (row: Row) => (
        <TranslationCell
          msgKey={row.msg_key}
          locale={lc}
          value={row[lc] ?? ''}
          onChange={onCellChange}
        />
      ))
    }
    return m
  }, [localeCodes, onCellChange])

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    try {
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
    }
  }

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <div
        className="p-4 max-w-screen-xl mx-auto flex flex-column gap-3 min-h-0"
        style={{ height: 'calc(100vh - 3rem)' }}
      >
        <Card
          className="shadow-1 border-round-xl overflow-hidden flex flex-column h-full min-h-0"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={
            <div className="app-card-hero flex flex-column gap-1 p-4 md:p-5 w-full">
              <div className="flex align-items-start gap-3 flex-wrap">
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
                <Button
                  type="button"
                  label={t('translations.save')}
                  icon="pi pi-save"
                  onClick={() => void save()}
                  loading={saving}
                  disabled={!dirty || loading}
                />
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
            <IconField
              iconPosition="left"
              className="w-full"
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
            <div className="min-w-0 min-h-0 flex-1 flex flex-column">
              <DataTable
                value={filteredRows}
                loading={loading}
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
              >
                <Column
                  field="msg_key"
                  header={t('translations.col_key')}
                  style={{ minWidth: '14rem' }}
                  frozen
                />
                {localeCodes.map((lc) => (
                  <Column
                    key={lc}
                    header={lc.toUpperCase()}
                    body={(row: Row) => {
                      const render = localeColumnBodies.get(lc)
                      return render ? render(row) : null
                    }}
                    style={{ minWidth: '18rem' }}
                  />
                ))}
              </DataTable>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
