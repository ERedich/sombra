import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Checkbox } from 'primereact/checkbox'
import { Chips } from 'primereact/chips'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { Dialog } from 'primereact/dialog'
import { DataTable } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { MultiSelect } from 'primereact/multiselect'
import { Panel } from 'primereact/panel'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import type { AppUser } from '../../pages/UsersPage'
import { AppShell } from '../../layout/AppShell'

type Site = { id: string; key: string; name: string }

type NotificationEventKind =
  | 'work_order_field_changed'
  | 'work_order_employee_assigned'
  | 'work_order_employee_deassigned'
  | 'work_instruction_created'
  | 'work_instruction_updated'
  | 'work_instruction_deleted'

type EmailRuleRow = {
  id: string
  site_id: string
  name: string
  enabled: boolean
  event_kind: string
  condition_json: Record<string, unknown>
  recipient_emails: string[]
  recipient_user_ids: string[]
  cooldown_seconds: number
  email_subject?: string | null
  email_body?: string | null
  created_at: string
  updated_at: string
}

const EVENT_KINDS: { value: NotificationEventKind; labelKey: string }[] = [
  { value: 'work_order_field_changed', labelKey: 'ner.trigger_wo_field_changed' },
  { value: 'work_order_employee_assigned', labelKey: 'ner.trigger_wo_employee_assigned' },
  { value: 'work_order_employee_deassigned', labelKey: 'ner.trigger_wo_employee_deassigned' },
  { value: 'work_instruction_created', labelKey: 'ner.trigger_wi_created' },
  { value: 'work_instruction_updated', labelKey: 'ner.trigger_wi_updated' },
  { value: 'work_instruction_deleted', labelKey: 'ner.trigger_wi_deleted' },
]

const WO_PAYLOAD_FIELDS = [
  { value: '', labelKey: 'ner.condition_any_field' },
  { value: 'status', labelKey: 'ner.f_status' },
  { value: 'short_text', labelKey: 'ner.f_short_text' },
  { value: 'instruction_text', labelKey: 'ner.f_instruction_text' },
  { value: 'plan_start', labelKey: 'ner.f_plan_start' },
  { value: 'plan_end', labelKey: 'ner.f_plan_end' },
  { value: 'work_type_id', labelKey: 'ner.f_work_type_id' },
  { value: 'category_id', labelKey: 'ner.f_category_id' },
  { value: 'workgroup_id', labelKey: 'ner.f_workgroup_id' },
  { value: 'planned_duration', labelKey: 'ner.f_planned_duration' },
  { value: 'asset_id', labelKey: 'ner.f_asset_id' },
  { value: 'costcenter_id', labelKey: 'ner.f_costcenter_id' },
]

const WI_PAYLOAD_FIELDS = [
  { value: '', labelKey: 'ner.condition_any_field' },
  { value: 'done', labelKey: 'ner.f_done' },
  { value: 'sort_nr', labelKey: 'ner.f_sort_nr' },
  { value: 'instruction_text', labelKey: 'ner.f_instruction_text' },
]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function displayConditionValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function parseConditionValue(raw: string): unknown {
  const t = raw.trim()
  if (!t) return undefined
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t) as unknown
    } catch {
      return t
    }
  }
  return t
}

function buildConditionJson(params: {
  condField: string
  condBefore: string
  condAfter: string
  condEmployeeId: string
  condWiId: string
}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (params.condField.trim()) out.field = params.condField.trim()
  if (params.condBefore.trim()) out.before = parseConditionValue(params.condBefore)
  if (params.condAfter.trim()) out.after = parseConditionValue(params.condAfter)
  const emp = params.condEmployeeId.trim()
  if (emp && UUID_RE.test(emp)) out.employee_id = emp
  const wi = params.condWiId.trim()
  if (wi && UUID_RE.test(wi)) out.work_instruction_id = wi
  return out
}

export default function NotificationEmailRulesAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const user = getStoredUser()

  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoaded, setSitesLoaded] = useState(false)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [rules, setRules] = useState<EmailRuleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [formKind, setFormKind] = useState<NotificationEventKind>('work_order_field_changed')
  const [formCooldownMin, setFormCooldownMin] = useState(60)
  const [formEmails, setFormEmails] = useState<string[]>([])
  const [formUserIds, setFormUserIds] = useState<string[]>([])
  const [formCondField, setFormCondField] = useState('')
  const [formCondBefore, setFormCondBefore] = useState('')
  const [formCondAfter, setFormCondAfter] = useState('')
  const [formCondEmployeeId, setFormCondEmployeeId] = useState('')
  const [formCondWiId, setFormCondWiId] = useState('')
  const [formMailSubject, setFormMailSubject] = useState('')
  const [formMailBody, setFormMailBody] = useState('')

  const [users, setUsers] = useState<AppUser[]>([])

  const kindOptions = useMemo(
    () =>
      EVENT_KINDS.map((k) => ({
        value: k.value,
        label: t(k.labelKey),
      })),
    [t],
  )

  const fieldOptionsWo = useMemo(
    () => WO_PAYLOAD_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) })),
    [t],
  )

  const fieldOptionsWi = useMemo(
    () =>
      WI_PAYLOAD_FIELDS.map((f) => ({
        value: f.value,
        label: t(f.labelKey),
      })),
    [t],
  )

  const userOptions = useMemo(
    () =>
      users
        .filter((u) => u.email && u.email.trim())
        .map((u) => ({
          value: u.id,
          label: `${u.login_name} — ${u.email}`,
        })),
    [users],
  )

  const loadRules = useCallback(async () => {
    if (!siteId) {
      setRules([])
      return
    }
    setLoading(true)
    try {
      const d = await apiJson<{ rules: EmailRuleRow[] }>(
        `/api/notification-email-rules?site_id=${encodeURIComponent(siteId)}`,
      )
      setRules(d.rules ?? [])
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: t('common.error'),
        detail: e instanceof ApiError ? e.message : String(e),
      })
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [siteId, t])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await apiJson<{ sites: Site[] }>('/api/sites')
        if (!cancelled) setSites(d.sites ?? [])
      } catch {
        if (!cancelled) setSites([])
      } finally {
        if (!cancelled) setSitesLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await apiJson<{ users: AppUser[] }>('/api/users')
        if (!cancelled) setUsers(d.users ?? [])
      } catch {
        if (!cancelled) setUsers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sitesLoaded || sites.length === 0 || siteId !== null) return
    const wid = user?.working_site_id
    const pick = wid && sites.some((x) => x.id === wid) ? wid : sites[0]!.id
    setSiteId(pick)
  }, [sitesLoaded, sites, siteId, user?.working_site_id])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  function resetForm() {
    setEditingId(null)
    setFormName('')
    setFormEnabled(true)
    setFormKind('work_order_field_changed')
    setFormCooldownMin(60)
    setFormEmails([])
    setFormUserIds([])
    setFormCondField('')
    setFormCondBefore('')
    setFormCondAfter('')
    setFormCondEmployeeId('')
    setFormCondWiId('')
    setFormMailSubject('')
    setFormMailBody('')
  }

  function openNew() {
    if (!siteId) return
    resetForm()
    setDialogOpen(true)
  }

  function applyConditionFromRule(c: Record<string, unknown>) {
    setFormCondField(typeof c.field === 'string' ? c.field : '')
    setFormCondBefore('before' in c ? displayConditionValue(c.before) : '')
    setFormCondAfter('after' in c ? displayConditionValue(c.after) : '')
    setFormCondEmployeeId(typeof c.employee_id === 'string' ? c.employee_id : '')
    setFormCondWiId(typeof c.work_instruction_id === 'string' ? c.work_instruction_id : '')
  }

  function openEdit(row: EmailRuleRow) {
    setEditingId(row.id)
    setFormName(row.name ?? '')
    setFormEnabled(row.enabled !== false)
    setFormKind((row.event_kind as NotificationEventKind) ?? 'work_order_field_changed')
    setFormCooldownMin(Math.max(0, Math.round(row.cooldown_seconds / 60)))
    setFormEmails([...(row.recipient_emails ?? [])])
    setFormUserIds([...(row.recipient_user_ids ?? [])])
    applyConditionFromRule(row.condition_json ?? {})
    setFormMailSubject(
      typeof row.email_subject === 'string' && row.email_subject.trim()
        ? row.email_subject
        : '',
    )
    setFormMailBody(
      typeof row.email_body === 'string' && row.email_body.trim() ? row.email_body : '',
    )
    setDialogOpen(true)
  }

  async function saveRule() {
    if (!siteId) return
    const condition_json = buildConditionJson({
      condField: formCondField,
      condBefore: formCondBefore,
      condAfter: formCondAfter,
      condEmployeeId: formCondEmployeeId,
      condWiId: formCondWiId,
    })
    const cooldown_seconds = Math.min(
      86400 * 365,
      Math.max(0, Math.round(formCooldownMin * 60)),
    )
    try {
      if (editingId) {
        await apiJson<{ rule: EmailRuleRow }>(`/api/notification-email-rules/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formName,
            enabled: formEnabled,
            event_kind: formKind,
            condition_json,
            recipient_emails: formEmails,
            recipient_user_ids: formUserIds,
            cooldown_seconds,
            email_subject: formMailSubject.trim() || null,
            email_body: formMailBody.trim() || null,
          }),
        })
      } else {
        await apiJson<{ rule: EmailRuleRow }>('/api/notification-email-rules', {
          method: 'POST',
          body: JSON.stringify({
            site_id: siteId,
            name: formName,
            enabled: formEnabled,
            event_kind: formKind,
            condition_json,
            recipient_emails: formEmails,
            recipient_user_ids: formUserIds,
            cooldown_seconds,
            email_subject: formMailSubject.trim() || null,
            email_body: formMailBody.trim() || null,
          }),
        })
      }
      toast.current?.show({
        severity: 'success',
        summary: t('ner.saved'),
        life: 2500,
      })
      setDialogOpen(false)
      resetForm()
      await loadRules()
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: t('common.error'),
        detail: e instanceof ApiError ? e.message : String(e),
      })
    }
  }

  function confirmDelete(row: EmailRuleRow) {
    confirmDialog({
      message: t('ner.delete_confirm'),
      header: t('common.delete'),
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await apiJson<undefined>(`/api/notification-email-rules/${row.id}`, {
            method: 'DELETE',
          })
          toast.current?.show({
            severity: 'success',
            summary: t('ner.deleted'),
            life: 2500,
          })
          await loadRules()
        } catch (e) {
          toast.current?.show({
            severity: 'error',
            summary: t('common.error'),
            detail: e instanceof ApiError ? e.message : String(e),
          })
        }
      },
    })
  }

  function triggerLabel(kind: string): string {
    const hit = EVENT_KINDS.find((k) => k.value === kind)
    return hit ? t(hit.labelKey) : kind
  }

  function recipientsSummary(row: EmailRuleRow): string {
    const emails = (row.recipient_emails ?? []).join(', ')
    const nUsers = (row.recipient_user_ids ?? []).length
    const parts: string[] = []
    if (emails) parts.push(emails)
    if (nUsers > 0) parts.push(t('ner.recipient_user_count', { count: nUsers }))
    return parts.join(' · ') || '—'
  }

  const siteOptions = useMemo(
    () => sites.map((s) => ({ value: s.id, label: `${s.key} — ${s.name}` })),
    [sites],
  )

  const fieldDropdownOptions =
    formKind === 'work_instruction_updated' ? fieldOptionsWi : fieldOptionsWo

  const showFieldFilters =
    formKind === 'work_order_field_changed' || formKind === 'work_instruction_updated'
  const showEmployeeFilter =
    formKind === 'work_order_employee_assigned' ||
    formKind === 'work_order_employee_deassigned'
  const showWiFilter =
    formKind === 'work_instruction_created' ||
    formKind === 'work_instruction_updated' ||
    formKind === 'work_instruction_deleted'

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />
      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        <div>
          <h1 className="text-2xl m-0 mb-1">{t('ner.title')}</h1>
          <p className="text-color-secondary m-0 mb-0 line-height-3">{t('ner.subtitle')}</p>
        </div>
      <Card>
        <div className="flex flex-wrap align-items-center gap-3 mb-3">
          <label htmlFor="ner-site" className="font-medium">
            {t('ner.site')}
          </label>
          <Dropdown
            inputId="ner-site"
            value={siteId}
            options={siteOptions}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => setSiteId(e.value as string)}
            className="min-w-18rem"
            placeholder={t('ner.site')}
          />
          <Button
            type="button"
            label={t('ner.new_rule')}
            icon="pi pi-plus"
            onClick={openNew}
            disabled={!siteId}
          />
        </div>
        {!siteId ? (
          <p className="text-color-secondary">{t('ner.pick_site')}</p>
        ) : (
          <DataTable value={rules} loading={loading} dataKey="id" emptyMessage={t('ner.no_rules')}>
            <Column field="name" header={t('ner.col_name')} />
            <Column
              header={t('ner.col_trigger')}
              body={(r: EmailRuleRow) => triggerLabel(r.event_kind)}
            />
            <Column
              field="enabled"
              header={t('ner.col_enabled')}
              body={(r: EmailRuleRow) =>
                r.enabled ? <i className="pi pi-check text-green-500" aria-hidden /> : <span className="text-500">—</span>
              }
            />
            <Column
              header={t('ner.col_cooldown')}
              body={(r: EmailRuleRow) => Math.round(r.cooldown_seconds / 60)}
            />
            <Column
              header={t('ner.col_recipients')}
              body={(r: EmailRuleRow) => recipientsSummary(r)}
              style={{ maxWidth: '22rem', overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
            <Column
              body={(r: EmailRuleRow) => (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    icon="pi pi-pencil"
                    rounded
                    text
                    severity="secondary"
                    aria-label={t('common.edit')}
                    onClick={() => openEdit(r)}
                  />
                  <Button
                    type="button"
                    icon="pi pi-trash"
                    rounded
                    text
                    severity="danger"
                    aria-label={t('common.delete')}
                    onClick={() => confirmDelete(r)}
                  />
                </div>
              )}
              style={{ width: '7rem' }}
            />
          </DataTable>
        )}
      </Card>
      </div>

      <Dialog
        header={editingId ? t('ner.edit_rule') : t('ner.new_rule')}
        visible={dialogOpen}
        style={{ width: 'min(44rem, 96vw)' }}
        onHide={() => {
          setDialogOpen(false)
          resetForm()
        }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              onClick={() => {
                setDialogOpen(false)
                resetForm()
              }}
            />
            <Button type="button" label={t('common.save')} onClick={() => void saveRule()} />
          </div>
        }
      >
        <div className="flex flex-column gap-3">
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-name">{t('ner.name')}</label>
            <InputText
              id="ner-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex align-items-center gap-2">
            <Checkbox
              inputId="ner-enabled"
              checked={formEnabled}
              onChange={(e) => setFormEnabled(Boolean(e.checked))}
            />
            <label htmlFor="ner-enabled">{t('ner.enabled')}</label>
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-kind">{t('ner.trigger')}</label>
            <Dropdown
              inputId="ner-kind"
              value={formKind}
              options={kindOptions}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => {
                const v = e.value as NotificationEventKind
                setFormKind(v)
                setFormCondField('')
                setFormCondBefore('')
                setFormCondAfter('')
              }}
              className="w-full"
            />
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-cd">{t('ner.cooldown_min')}</label>
            <InputNumber
              inputId="ner-cd"
              value={formCooldownMin}
              onValueChange={(e) => setFormCooldownMin(e.value ?? 0)}
              min={0}
              showButtons
              className="w-full"
            />
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-mail-subj">{t('ner.mail_subject')}</label>
            <InputText
              id="ner-mail-subj"
              value={formMailSubject}
              onChange={(e) => setFormMailSubject(e.target.value)}
              className="w-full"
              placeholder="[WO {wo_key}] {message}"
            />
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-mail-body">{t('ner.mail_body')}</label>
            <InputTextarea
              id="ner-mail-body"
              value={formMailBody}
              onChange={(e) => setFormMailBody(e.target.value)}
              rows={10}
              autoResize
              className="w-full"
              placeholder={'{message}\n\n{payload_json}'}
            />
          </div>
          <p className="text-sm text-color-secondary m-0 line-height-3">{t('ner.mail_placeholders')}</p>
          <div className="flex flex-column gap-1">
            <label>{t('ner.recipient_emails')}</label>
            <Chips value={formEmails} onChange={(e) => setFormEmails(e.value ?? [])} className="w-full" />
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor="ner-users">{t('ner.recipient_users')}</label>
            <MultiSelect
              inputId="ner-users"
              value={formUserIds}
              options={userOptions}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => setFormUserIds(e.value ?? [])}
              display="chip"
              className="w-full"
              filter
              placeholder={t('ner.recipient_users')}
            />
          </div>

          <Panel header={t('ner.condition_optional')}>
            {showFieldFilters ? (
              <div className="flex flex-column gap-3">
                <div className="flex flex-column gap-1">
                  <label htmlFor="ner-cf">{t('ner.condition_field')}</label>
                  <Dropdown
                    inputId="ner-cf"
                    value={formCondField}
                    options={fieldDropdownOptions}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(e) => setFormCondField((e.value as string) ?? '')}
                    className="w-full"
                  />
                </div>
                <div className="flex flex-column gap-1">
                  <label htmlFor="ner-cb">{t('ner.condition_before')}</label>
                  <InputText
                    id="ner-cb"
                    value={formCondBefore}
                    onChange={(e) => setFormCondBefore(e.target.value)}
                    placeholder="e.g. open, true"
                    className="w-full"
                  />
                </div>
                <div className="flex flex-column gap-1">
                  <label htmlFor="ner-ca">{t('ner.condition_after')}</label>
                  <InputText
                    id="ner-ca"
                    value={formCondAfter}
                    onChange={(e) => setFormCondAfter(e.target.value)}
                    placeholder="e.g. done, false"
                    className="w-full"
                  />
                </div>
              </div>
            ) : null}
            {showEmployeeFilter ? (
              <div className="flex flex-column gap-1 mt-3">
                <label htmlFor="ner-ce">{t('ner.condition_employee_id')}</label>
                <InputText
                  id="ner-ce"
                  value={formCondEmployeeId}
                  onChange={(e) => setFormCondEmployeeId(e.target.value)}
                  className="w-full"
                />
              </div>
            ) : null}
            {showWiFilter ? (
              <div className="flex flex-column gap-1 mt-3">
                <label htmlFor="ner-cwi">{t('ner.condition_work_instruction_id')}</label>
                <InputText
                  id="ner-cwi"
                  value={formCondWiId}
                  onChange={(e) => setFormCondWiId(e.target.value)}
                  className="w-full"
                />
              </div>
            ) : null}
          </Panel>
        </div>
      </Dialog>
    </AppShell>
  )
}
