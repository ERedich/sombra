import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { Paginator, type PaginatorPageChangeEvent } from 'primereact/paginator'
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import { formatDateTime } from '../../utils/dateTime'

export type AuditEntry = {
  id: string
  occurred_at: string
  actor_user_id: string | null
  actor_key: string
  actor_name: string
  operation: string
  resource_type: string
  resource_id: string | null
  /** Human-readable label for resource_id (site key, user login_name, etc.) */
  resource_id_label?: string | null
  before_state: unknown
  after_state: unknown
  field_changes: unknown
  http_method: string
  path: string
}

type AuditListResponse = {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
}

/** Deep link: Sites for `site`; otherwise audit log list filtered to this resource. */
function operationTagSeverity(
  op: string,
): 'success' | 'info' | 'danger' | 'secondary' {
  switch (op) {
    case 'create':
      return 'success'
    case 'update':
      return 'info'
    case 'delete':
      return 'danger'
    default:
      return 'secondary'
  }
}

function getJumpToFilePath(entry: AuditEntry): string | null {
  const id = entry.resource_id?.trim()
  if (!id) return null
  if (entry.resource_type === 'site') {
    return `/sites?siteId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'costcenter') {
    return `/costcenters?costcenterId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'asset_classification') {
    return `/asset-classifications?assetClassificationId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'user_group') {
    return `/user-groups?userGroupId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'user') {
    return `/users?userId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'asset') {
    return `/assets?assetId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'work_order') {
    return `/work-orders?workOrderId=${encodeURIComponent(id)}`
  }
  if (entry.resource_type === 'auth_working_site') {
    return `/users?userId=${encodeURIComponent(id)}`
  }
  const p = new URLSearchParams()
  p.set('resource_type', entry.resource_type)
  p.set('resource_id', id)
  return `/audit-log?${p.toString()}`
}

export default function AuditLogAppPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const toast = useRef<Toast>(null)
  const emDash = t('common.em_dash')

  const formatJson = useCallback(
    (value: unknown) => {
      if (value === null || value === undefined) return emDash
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    },
    [emDash],
  )
  const user = getStoredUser()
  const isAdmin = user?.role === 'admin'

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)

  const [draftResourceType, setDraftResourceType] = useState('')
  const [draftResourceId, setDraftResourceId] = useState('')
  const [draftActorUserId, setDraftActorUserId] = useState('')
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')

  const [appliedResourceType, setAppliedResourceType] = useState('')
  const [appliedResourceId, setAppliedResourceId] = useState('')
  const [appliedActorUserId, setAppliedActorUserId] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')

  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null)

  useEffect(() => {
    const rt = searchParams.get('resource_type') ?? ''
    const rid = searchParams.get('resource_id') ?? ''
    const aid = searchParams.get('actor_user_id') ?? ''
    const fr = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    if (!rt && !rid && !aid && !fr && !to) return
    setAppliedResourceType(rt)
    setDraftResourceType(rt)
    setAppliedResourceId(rid)
    setDraftResourceId(rid)
    setAppliedActorUserId(aid)
    setDraftActorUserId(aid)
    setAppliedFrom(fr)
    setDraftFrom(fr)
    setAppliedTo(to)
    setDraftTo(to)
    setOffset(0)
  }, [searchParams])

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', String(limit))
    p.set('offset', String(offset))
    const rt = appliedResourceType.trim()
    const rid = appliedResourceId.trim()
    const aid = appliedActorUserId.trim()
    const fr = appliedFrom.trim()
    const to = appliedTo.trim()
    if (rt) p.set('resource_type', rt)
    if (rid) p.set('resource_id', rid)
    if (aid) p.set('actor_user_id', aid)
    if (fr) p.set('from', fr)
    if (to) p.set('to', to)
    return p.toString()
  }, [
    limit,
    offset,
    appliedResourceType,
    appliedResourceId,
    appliedActorUserId,
    appliedFrom,
    appliedTo,
  ])

  const load = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const data = await apiJson<AuditListResponse>(
        `/api/audit-log?${queryString}`,
      )
      setEntries(data.entries)
      setTotal(data.total)
      setLimit(data.limit)
      setOffset(data.offset)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        toast.current?.show({
          severity: 'error',
          summary: t('audit_log.toast_forbidden_summary'),
          detail: t('audit_log.toast_forbidden_detail'),
          life: 6000,
        })
      } else {
        toast.current?.show({
          severity: 'error',
          summary: t('audit_log.toast_load_failed'),
          detail:
            e instanceof Error ? e.message : t('common.error_unknown'),
          life: 6000,
        })
      }
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, queryString, t])

  useEffect(() => {
    void load()
  }, [load])

  const onPageChange = (e: PaginatorPageChangeEvent) => {
    setLimit(e.rows)
    setOffset(e.first)
  }

  const applyFilters = () => {
    setAppliedResourceType(draftResourceType)
    setAppliedResourceId(draftResourceId)
    setAppliedActorUserId(draftActorUserId)
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
    setOffset(0)
  }

  const occurredBody = (row: AuditEntry) => {
    const d = new Date(row.occurred_at)
    return (
      <span className="text-sm white-space-nowrap" title={row.occurred_at}>
        {Number.isNaN(d.getTime())
          ? row.occurred_at
          : formatDateTime(row.occurred_at)}
      </span>
    )
  }

  const operationBody = (row: AuditEntry) => (
    <Tag
      value={row.operation.toUpperCase()}
      severity={operationTagSeverity(row.operation)}
      className="text-xs font-semibold"
    />
  )

  const auditLogDeniedHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-lock text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('audit_log.title')}</h1>
        <p className="app-card-hero-desc">
          {t('audit_log.restricted_subtitle')}
        </p>
      </div>
    </div>
  )

  const auditLogCardHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-history text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('audit_log.title')}</h1>
        <p className="app-card-hero-desc">{t('audit_log.subtitle_hero')}</p>
      </div>
    </div>
  )

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="p-4 max-w-screen-lg mx-auto flex flex-column gap-3">
          <Card
            className="shadow-1 border-round-xl overflow-hidden"
            pt={{ header: { className: 'p-0 border-none' } }}
            header={auditLogDeniedHeader}
          >
            <div className="px-1 md:px-2">
              <p className="text-color-secondary m-0">
                {t('audit_log.admin_only')}
              </p>
            </div>
          </Card>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <div className="p-4 max-w-screen-xl mx-auto flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={auditLogCardHeader}
        >
          <div className="px-1 md:px-2">
          <div className="flex flex-column gap-3 mb-3">
            <div className="flex flex-wrap gap-2 align-items-end">
              <div className="flex flex-column gap-1" style={{ minWidth: '8rem' }}>
                <label htmlFor="al-res-type" className="text-xs text-color-secondary">
                  {t('audit_log.filter_resource_type_label')}
                </label>
                <InputText
                  id="al-res-type"
                  value={draftResourceType}
                  onChange={(e) => setDraftResourceType(e.target.value)}
                  placeholder={t('audit_log.filter_resource_type_ph')}
                  className="w-full"
                />
              </div>
              <div className="flex flex-column gap-1" style={{ minWidth: '14rem' }}>
                <label htmlFor="al-res-id" className="text-xs text-color-secondary">
                  Resource id
                </label>
                <InputText
                  id="al-res-id"
                  value={draftResourceId}
                  onChange={(e) => setDraftResourceId(e.target.value)}
                  placeholder="UUID"
                  className="w-full"
                />
              </div>
              <div className="flex flex-column gap-1" style={{ minWidth: '14rem' }}>
                <label htmlFor="al-actor" className="text-xs text-color-secondary">
                  {t('audit_log.filter_actor_label')}
                </label>
                <InputText
                  id="al-actor"
                  value={draftActorUserId}
                  onChange={(e) => setDraftActorUserId(e.target.value)}
                  placeholder={t('audit_log.filter_actor_ph')}
                  className="w-full"
                />
              </div>
              <div className="flex flex-column gap-1" style={{ minWidth: '11rem' }}>
                <label htmlFor="al-from" className="text-xs text-color-secondary">
                  {t('audit_log.filter_from_label')}
                </label>
                <InputText
                  id="al-from"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  placeholder={t('audit_log.filter_from_ph')}
                  className="w-full"
                />
              </div>
              <div className="flex flex-column gap-1" style={{ minWidth: '11rem' }}>
                <label htmlFor="al-to" className="text-xs text-color-secondary">
                  {t('audit_log.filter_to_label')}
                </label>
                <InputText
                  id="al-to"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  placeholder={t('audit_log.filter_to_ph')}
                  className="w-full"
                />
              </div>
              <Button
                type="button"
                label={t('common.apply_filters')}
                icon="pi pi-filter"
                onClick={applyFilters}
              />
              <Button
                type="button"
                label={t('common.refresh')}
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                onClick={() => void load()}
                loading={loading}
              />
            </div>
            <p className="text-sm text-color-secondary m-0">
              {t('audit_log.help_line')}
            </p>
          </div>

          <DataTable
            value={entries}
            loading={loading}
            dataKey="id"
            selection={detailEntry}
            onSelectionChange={(e) => setDetailEntry(e.value as AuditEntry | null)}
            selectionMode="single"
            metaKeySelection={false}
            emptyMessage="No audit entries match your filters."
            stripedRows
          >
            <Column
              field="occurred_at"
              header={t('audit_log.col_when')}
              body={occurredBody}
              sortable
              style={{ minWidth: '10rem' }}
            />
            <Column
              field="operation"
              header={t('audit_log.col_operation')}
              body={operationBody}
              sortable
              style={{ width: '7.5rem' }}
            />
            <Column
              field="resource_type"
              header={t('audit_log.col_resource')}
              sortable
            />
            <Column
              field="resource_id"
              header={t('audit_log.col_resource_id')}
              body={(r: AuditEntry) => (
                <span className="font-mono text-sm">
                  {r.resource_id ?? emDash}
                  {r.resource_id && r.resource_id_label ? (
                    <span className="text-color-secondary">
                      {' '}
                      [{r.resource_id_label}]
                    </span>
                  ) : null}
                </span>
              )}
            />
            <Column field="actor_name" header={t('audit_log.col_actor')} sortable />
            <Column
              field="actor_key"
              header={t('audit_log.col_actor_key')}
              sortable
            />
            <Column
              field="http_method"
              header={t('audit_log.col_method')}
              style={{ width: '5rem' }}
            />
            <Column
              field="path"
              header={t('audit_log.col_path')}
              body={(r: AuditEntry) => (
                <span className="text-sm text-color-secondary">{r.path}</span>
              )}
            />
          </DataTable>

          <Paginator
            first={offset}
            rows={limit}
            totalRecords={total}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onPageChange={onPageChange}
            className="mt-3"
            template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
          />
          </div>
        </Card>
      </div>

      <Dialog
        header="Audit entry detail"
        visible={detailEntry !== null}
        onHide={() => setDetailEntry(null)}
        dismissableMask
        style={{ width: 'min(42rem, 96vw)' }}
        maximizable
        footer={
          detailEntry ? (
            <div className="flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="text-xs text-color-secondary">
                {getJumpToFilePath(detailEntry)
                  ? detailEntry.resource_type === 'site'
                    ? t('audit_log.jump_site_hint')
                    : t('audit_log.jump_audit_hint')
                  : t('audit_log.jump_unavailable')}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  label={t('common.jump_to_file')}
                  icon="pi pi-external-link"
                  disabled={!getJumpToFilePath(detailEntry)}
                  onClick={() => {
                    const path = getJumpToFilePath(detailEntry)
                    if (!path) return
                    setDetailEntry(null)
                    navigate(path)
                  }}
                />
                <Button
                  type="button"
                  label="Close"
                  severity="secondary"
                  outlined
                  onClick={() => setDetailEntry(null)}
                />
              </div>
            </div>
          ) : null
        }
      >
        {detailEntry ? (
          <div className="flex flex-column gap-3">
            <div className="text-sm">
              <div className="flex align-items-center gap-2 flex-wrap">
                <span className="text-color-secondary">
                  {t('audit_log.detail_operation')}
                </span>
                <Tag
                  value={detailEntry.operation.toUpperCase()}
                  severity={operationTagSeverity(detailEntry.operation)}
                  className="text-xs font-semibold"
                />
              </div>
              <div>
                <span className="text-color-secondary">
                  {t('audit_log.detail_resource')}
                </span>{' '}
                {detailEntry.resource_type}{' '}
                {detailEntry.resource_id ? (
                  <>
                    (
                    <span className="font-mono">{detailEntry.resource_id}</span>
                    {detailEntry.resource_id_label ? (
                      <span className="text-color-secondary">
                        {' '}
                        [{detailEntry.resource_id_label}]
                      </span>
                    ) : null}
                    )
                  </>
                ) : (
                  ''
                )}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">
                {t('audit_log.detail_before')}
              </div>
              <pre
                className="text-xs font-mono p-3 border-round border-1 border-300 surface-ground overflow-auto m-0"
                style={{ maxHeight: '15rem' }}
              >
                {formatJson(detailEntry.before_state)}
              </pre>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">
                {t('audit_log.detail_after')}
              </div>
              <pre
                className="text-xs font-mono p-3 border-round border-1 border-300 surface-ground overflow-auto m-0"
                style={{ maxHeight: '15rem' }}
              >
                {formatJson(detailEntry.after_state)}
              </pre>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">
                {t('audit_log.detail_field_changes')}
              </div>
              <pre
                className="text-xs font-mono p-3 border-round border-1 border-300 surface-ground overflow-auto m-0"
                style={{ maxHeight: '15rem' }}
              >
                {formatJson(detailEntry.field_changes)}
              </pre>
            </div>
          </div>
        ) : null}
      </Dialog>
    </AppShell>
  )
}
