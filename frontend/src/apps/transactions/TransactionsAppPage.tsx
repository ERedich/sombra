/**
 * Transactions (INT — internal time registration) — read-only list with table wizard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { DataTable } from 'primereact/datatable'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import type { ColumnRegistryEntry } from '../../table-wizard'
import { useTableWizard, useTableWizardToastEffect } from '../../table-wizard'
import { formatDateTime } from '../../utils/dateTime'

export type TransactionRow = {
  id: string
  work_order_id: string
  wo_key: number
  site_id: string
  site_key: string
  site_name: string
  type: string
  employee_id: string
  employee_key: string
  employee_name: string
  created_by_user_id: string
  created_by_login_name: string | null
  hours: string
  feedback_text: string
  created_at: string
}

type TransactionsListResponse = { transactions: TransactionRow[] }

function siteColumnBody(row: TransactionRow, dash: string) {
  const colour =
    typeof row.site_key === 'string' && row.site_key.trim() !== ''
      ? '#94a3b8'
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

export default function TransactionsAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const [rows, setRows] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const emDash = t('common.em_dash')

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

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<TransactionsListResponse>(
        '/api/transactions?type=INT',
      )
      setRows(data.transactions ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('wo.load_fail'))
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        String(r.wo_key).includes(q) ||
        r.feedback_text.toLowerCase().includes(q) ||
        r.employee_key.toLowerCase().includes(q) ||
        r.employee_name.toLowerCase().includes(q) ||
        r.site_key.toLowerCase().includes(q) ||
        r.site_name.toLowerCase().includes(q) ||
        (r.created_by_login_name?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, search])

  const tableColumnDefs = useMemo((): ColumnRegistryEntry<TransactionRow>[] => {
    const admin = getStoredUser()?.role === 'admin'
    const defs: ColumnRegistryEntry<TransactionRow>[] = [
      {
        field: 'wo_key',
        headerKey: 'transactions.col_wo_key',
        sortable: true,
        search: { inputType: 'number', getSearchValue: (row) => row.wo_key },
      },
      {
        field: 'type',
        headerKey: 'transactions.col_type',
        sortable: true,
        body: () => t('transactions.type_int'),
        search: { getSearchValue: () => 'INT' },
      },
      {
        field: 'employee_key',
        headerKey: 'transactions.col_employee',
        sortable: true,
        body: (row) => `${row.employee_key} ${emDash} ${row.employee_name}`,
        search: {
          getSearchValue: (row) =>
            `${row.employee_key} ${row.employee_name}`,
        },
      },
      {
        field: 'hours',
        headerKey: 'transactions.col_hours',
        sortable: true,
        search: { inputType: 'number', getSearchValue: (row) => Number(row.hours) },
      },
      {
        field: 'feedback_text',
        headerKey: 'transactions.col_feedback',
        sortable: true,
        search: { getSearchValue: (row) => row.feedback_text },
      },
      {
        field: 'created_at',
        headerKey: 'transactions.col_created_at',
        sortable: true,
        type: 'datetime',
        body: (row) => formatDateTime(row.created_at),
        search: {
          inputType: 'datetime',
          getSearchValue: (row) => row.created_at,
        },
      },
      {
        field: 'created_by_login_name',
        headerKey: 'common.col_created_by',
        sortable: true,
        body: (row) => row.created_by_login_name ?? emDash,
        search: {
          getSearchValue: (row) => row.created_by_login_name ?? '',
        },
      },
    ]
    if (admin) {
      defs.splice(1, 0, {
        field: 'site_key',
        headerKey: 'common.col_site',
        sortable: true,
        isSiteReference: true,
        body: (row) => siteColumnBody(row, emDash),
        search: {
          getSearchValue: (row) => `${row.site_key} ${row.site_name}`,
        },
      })
    }
    return defs
  }, [emDash, t])

  const tw = useTableWizard<TransactionRow>({
    appPath: '/transactions',
    columnDefs: tableColumnDefs,
  })

  useTableWizardToastEffect(toast, tw.toastError, tw.clearToastError, t)

  const twLp = tw.tableLayoutProps as { className?: string } & Record<
    string,
    unknown
  >
  const twTableClass = twLp.className
  const tableLayoutRest = { ...twLp, className: undefined }

  const cardSubTitle = useMemo(() => {
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('transactions.subtitle')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('work_orders.subtitle_no_sites')
    }
    return t('transactions.subtitle')
  }, [t])

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      {tw.wizardDialog}
      <Card
        className="shadow-1 border-round-xl overflow-hidden"
        pt={{ header: { className: 'p-0 border-none' } }}
        header={
          <div className="app-card-hero flex align-items-start justify-content-between gap-3 flex-wrap p-4 md:p-5">
            <div className="flex align-items-start gap-3 min-w-0 flex-1">
              <span
                className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
                aria-hidden
              >
                <i className="pi pi-list text-xl" />
              </span>
              <div className="min-w-0 pt-0">
                <h1 className="app-card-hero-title">{t('transactions.title')}</h1>
                <p className="app-card-hero-desc">{cardSubTitle}</p>
              </div>
            </div>
            <div className="flex align-items-center gap-2 flex-shrink-0 align-self-start">
              {tw.heroTableWizard}
            </div>
          </div>
        }
      >
        <div className="px-1 md:px-2 pb-3">
          <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-3 w-full">
            <Button
              type="button"
              label={t('common.refresh')}
              icon="pi pi-refresh"
              outlined
              size="small"
              onClick={() => void loadRows()}
              disabled={loading}
            />
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
          <div className="w-full overflow-x-auto">
            <DataTable
              {...tableLayoutRest}
              className={['transactions-table', twTableClass]
                .filter(Boolean)
                .join(' ')}
              value={tw.prepareRows(filteredRows)}
              loading={loading || tw.tableBusy}
              dataKey="id"
              stripedRows
              tableStyle={{ minWidth: '72rem', width: 'max-content' }}
            >
              {tw.renderColumns()}
            </DataTable>
          </div>
        </div>
      </Card>
    </AppShell>
  )
}
