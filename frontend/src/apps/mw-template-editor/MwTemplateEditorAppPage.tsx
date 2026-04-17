import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Checkbox } from 'primereact/checkbox'
import { Column } from 'primereact/column'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { DataTable } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { OrderList } from 'primereact/orderlist'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import {
  defaultMwLayoutJson,
  MW_FORM_SHELL_KEYS,
  MW_WORK_ORDER_TAB_IDS,
  type MwFormShellKey,
  type MwLayoutJson,
  type MwLayoutJsonCostcenter,
  type MwLayoutJsonWorkOrder,
  type MwLayoutJsonWorkOrderTab,
} from '@sombra/shared'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppCrudDialog } from '../../components/app-crud-dialog'
import { AppShell } from '../../layout/AppShell'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import {
  mwEditorFieldLabel,
  mwEditorTabLabel,
} from '../../mw-templates/mwEditorFieldLabels'

type Site = { id: string; key: string; name: string }

type MwTemplateRow = {
  id: string
  site_id: string
  shell_key: string
  key: string
  name: string
  layout_json: MwLayoutJson
  created_at: string
  updated_at: string
  site_key: string
  site_name: string
}

type BindingRow = {
  user_group_id: string
  shell_key: string
  mw_form_template_id: string
  priority: number
  updated_at: string
  group_key: string
  group_name: string
  site_id: string
  template_key: string
  template_name: string
}

type UserGroup = {
  id: string
  site_id: string
  key: string
  name: string
  site_key: string
  site_name: string
}

type OrderField = { id: string; hidden: boolean }

function layoutToOrderFieldsCostcenter(layout: MwLayoutJsonCostcenter): OrderField[] {
  return layout.fields.map((f) => ({ id: f.id, hidden: f.hidden === true }))
}

function orderFieldsToLayoutCostcenter(items: OrderField[]): MwLayoutJsonCostcenter {
  return {
    version: 1,
    fields: items.map((x) => ({
      id: x.id,
      hidden: x.hidden ? true : undefined,
    })),
  }
}

function layoutToOrderFieldsWo(
  layout: MwLayoutJsonWorkOrder,
): Record<string, OrderField[]> {
  const out: Record<string, OrderField[]> = {}
  for (const tab of layout.tabs) {
    out[tab.tabId] = tab.fields.map((f) => ({
      id: f.id,
      hidden: f.hidden === true,
    }))
  }
  return out
}

function orderFieldsWoToLayout(
  byTab: Record<string, OrderField[]>,
): MwLayoutJsonWorkOrder {
  const tabs: MwLayoutJsonWorkOrderTab[] = MW_WORK_ORDER_TAB_IDS.map((tabId) => ({
    tabId,
    fields: (byTab[tabId] ?? []).map((x) => ({
      id: x.id,
      hidden: x.hidden ? true : undefined,
    })),
  }))
  return { version: 1, tabs }
}

function shellLabel(t: TFunction, shell: MwFormShellKey): string {
  return shell === 'costcenter'
    ? t('mwte.shell_costcenter')
    : t('mwte.shell_work_order')
}

export default function MwTemplateEditorAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const user = getStoredUser()
  const isAdmin = user?.role === 'admin'

  const [mainTab, setMainTab] = useState(0)
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState<string | null>(null)
  const [shellFilter, setShellFilter] = useState<MwFormShellKey | null>(null)
  const [search, setSearch] = useState('')

  const [templates, setTemplates] = useState<MwTemplateRow[]>([])
  const [bindings, setBindings] = useState<BindingRow[]>([])
  const [userGroups, setUserGroups] = useState<UserGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [sitesLoaded, setSitesLoaded] = useState(false)

  const [tplDialogOpen, setTplDialogOpen] = useState(false)
  const [tplSaving, setTplSaving] = useState(false)
  const [editingTplId, setEditingTplId] = useState<string | null>(null)
  const [formSiteId, setFormSiteId] = useState<string>('')
  const [formShell, setFormShell] = useState<MwFormShellKey>('costcenter')
  const [formKey, setFormKey] = useState('')
  const [formName, setFormName] = useState('')
  const [ccOrder, setCcOrder] = useState<OrderField[]>([])
  const [woOrderByTab, setWoOrderByTab] = useState<Record<string, OrderField[]>>({})

  const [bindDialogOpen, setBindDialogOpen] = useState(false)
  const [bindSaving, setBindSaving] = useState(false)
  const [bindGroupId, setBindGroupId] = useState<string | null>(null)
  const [bindShell, setBindShell] = useState<MwFormShellKey>('costcenter')
  const [bindTemplateId, setBindTemplateId] = useState<string | null>(null)
  const [bindPriority, setBindPriority] = useState(100)

  const accessibleSiteIds = useMemo(() => {
    if (isAdmin) return null
    const s = new Set<string>()
    if (user?.working_site_id) s.add(user.working_site_id)
    for (const id of user?.additional_site_ids ?? []) s.add(id)
    return [...s]
  }, [isAdmin, user])

  const siteOptions = useMemo(() => {
    const list = isAdmin ? sites : sites.filter((s) => accessibleSiteIds?.includes(s.id))
    return list.map((s) => ({
      label: `${s.key} — ${s.name}`,
      value: s.id,
    }))
  }, [sites, isAdmin, accessibleSiteIds])

  const loadTemplates = useCallback(async () => {
    const q = new URLSearchParams()
    if (siteFilter) q.set('site_id', siteFilter)
    if (shellFilter) q.set('shell_key', shellFilter)
    const qs = q.toString()
    const d = await apiJson<{ templates: MwTemplateRow[] }>(
      `/api/mw-form-templates${qs ? `?${qs}` : ''}`,
    )
    setTemplates(d.templates)
  }, [siteFilter, shellFilter])

  const loadBindings = useCallback(async () => {
    const q = siteFilter ? `?site_id=${encodeURIComponent(siteFilter)}` : ''
    const d = await apiJson<{ bindings: BindingRow[] }>(
      `/api/mw-form-templates/bindings${q}`,
    )
    setBindings(d.bindings)
  }, [siteFilter])

  const loadUserGroups = useCallback(async () => {
    const d = await apiJson<{ user_groups: UserGroup[] }>('/api/user-groups')
    setUserGroups(d.user_groups)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadTemplates(), loadBindings(), loadUserGroups()])
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: t('common.error'),
        detail: e instanceof ApiError ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }, [loadTemplates, loadBindings, loadUserGroups, t])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await apiJson<{ sites: Site[] }>('/api/sites')
        if (cancelled) return
        setSites(d.sites)
        setSitesLoaded(true)
      } catch {
        if (!cancelled) setSitesLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sitesLoaded || sites.length === 0 || siteFilter !== null) return
    const wid = user?.working_site_id
    const pick =
      wid && sites.some((x) => x.id === wid) ? wid : sites[0]!.id
    setSiteFilter(pick)
    setFormSiteId(pick)
  }, [sitesLoaded, sites, siteFilter, user?.working_site_id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (siteFilter) setFormSiteId(siteFilter)
  }, [siteFilter])

  function openNewTemplate() {
    setEditingTplId(null)
    const shell: MwFormShellKey = shellFilter ?? 'costcenter'
    setFormShell(shell)
    setFormKey('')
    setFormName('')
    const base = defaultMwLayoutJson(shell)
    if (shell === 'costcenter') {
      setCcOrder(layoutToOrderFieldsCostcenter(base as MwLayoutJsonCostcenter))
      setWoOrderByTab({})
    } else {
      setWoOrderByTab(layoutToOrderFieldsWo(base as MwLayoutJsonWorkOrder))
      setCcOrder([])
    }
    setTplDialogOpen(true)
  }

  function openEditTemplate(row: MwTemplateRow) {
    setEditingTplId(row.id)
    setFormSiteId(row.site_id)
    setFormShell(row.shell_key as MwFormShellKey)
    setFormKey(row.key)
    setFormName(row.name)
    const lj = row.layout_json
    if (row.shell_key === 'costcenter') {
      setCcOrder(layoutToOrderFieldsCostcenter(lj as MwLayoutJsonCostcenter))
      setWoOrderByTab({})
    } else {
      setWoOrderByTab(layoutToOrderFieldsWo(lj as MwLayoutJsonWorkOrder))
      setCcOrder([])
    }
    setTplDialogOpen(true)
  }

  function currentLayoutJson(): MwLayoutJson {
    if (formShell === 'costcenter') {
      return orderFieldsToLayoutCostcenter(ccOrder)
    }
    return orderFieldsWoToLayout(woOrderByTab)
  }

  async function saveTemplate() {
    const key = formKey.trim()
    const name = formName.trim()
    if (!formSiteId || !key || !name) {
      toast.current?.show({
        severity: 'warn',
        summary: t('common.error'),
        detail: t('common.error'),
      })
      return
    }
    setTplSaving(true)
    try {
      const layout_json = currentLayoutJson()
      if (editingTplId) {
        await apiJson(`/api/mw-form-templates/${editingTplId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, key, layout_json }),
        })
      } else {
        await apiJson('/api/mw-form-templates', {
          method: 'POST',
          body: JSON.stringify({
            site_id: formSiteId,
            shell_key: formShell,
            key,
            name,
            layout_json,
          }),
        })
      }
      toast.current?.show({
        severity: 'success',
        summary: t('common.toast_success'),
        detail: t('mwte.template_saved'),
      })
      setTplDialogOpen(false)
      await loadTemplates()
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: t('common.error'),
        detail: e instanceof ApiError ? e.message : String(e),
      })
    } finally {
      setTplSaving(false)
    }
  }

  function confirmDeleteTemplate(row: MwTemplateRow) {
    confirmDialog({
      message: row.name,
      header: t('common.delete'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('common.delete'),
      rejectLabel: t('common.cancel'),
      accept: async () => {
        try {
          await apiJson(`/api/mw-form-templates/${row.id}`, { method: 'DELETE' })
          await loadTemplates()
          await loadBindings()
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

  function openNewBinding() {
    setBindGroupId(null)
    setBindShell(shellFilter ?? 'costcenter')
    setBindTemplateId(null)
    setBindPriority(100)
    setBindDialogOpen(true)
  }

  async function saveBinding() {
    if (!bindGroupId || !bindTemplateId) {
      toast.current?.show({
        severity: 'warn',
        summary: t('common.error'),
        detail: t('common.error'),
      })
      return
    }
    setBindSaving(true)
    try {
      await apiJson('/api/mw-form-templates/bindings', {
        method: 'PUT',
        body: JSON.stringify({
          user_group_id: bindGroupId,
          shell_key: bindShell,
          mw_form_template_id: bindTemplateId,
          priority: bindPriority,
        }),
      })
      toast.current?.show({
        severity: 'success',
        summary: t('mwte.binding_saved'),
        detail: t('mwte.binding_saved'),
      })
      setBindDialogOpen(false)
      await loadBindings()
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: t('common.error'),
        detail: e instanceof ApiError ? e.message : String(e),
      })
    } finally {
      setBindSaving(false)
    }
  }

  function confirmDeleteBinding(b: BindingRow) {
    confirmDialog({
      message: `${b.group_name} / ${b.shell_key}`,
      header: t('common.delete'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('common.delete'),
      rejectLabel: t('common.cancel'),
      accept: async () => {
        try {
          const q = new URLSearchParams({
            user_group_id: b.user_group_id,
            shell_key: b.shell_key,
          })
          await apiJson(`/api/mw-form-templates/bindings?${q}`, {
            method: 'DELETE',
          })
          toast.current?.show({
            severity: 'success',
            summary: t('mwte.binding_removed'),
            detail: t('mwte.binding_removed'),
          })
          await loadBindings()
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

  const groupOptions = useMemo(() => {
    let g = userGroups
    if (siteFilter) g = g.filter((x) => x.site_id === siteFilter)
    return g.map((x) => ({
      label: `${x.site_key} — ${x.name} (${x.key})`,
      value: x.id,
    }))
  }, [userGroups, siteFilter])

  const templateOptionsForBind = useMemo(() => {
    return templates
      .filter((x) => x.shell_key === bindShell)
      .map((x) => ({
        label: `${x.key} — ${x.name}`,
        value: x.id,
      }))
  }, [templates, bindShell])

  const shellOptions = MW_FORM_SHELL_KEYS.map((s) => ({
    label: shellLabel(t, s),
    value: s,
  }))

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.shell_key.toLowerCase().includes(q),
    )
  }, [templates, search])

  const cardHeader = (
    <div className="app-card-hero flex align-items-start justify-content-between gap-3 p-4 md:p-5 w-full flex-wrap">
      <div className="flex align-items-start gap-3 min-w-0 flex-1">
        <span
          className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
          aria-hidden
        >
          <i className="pi pi-table text-xl" />
        </span>
        <div className="min-w-0 pt-0">
          <h1 className="app-card-hero-title">{t('mwte.title')}</h1>
          <p className="app-card-hero-desc">{t('mwte.subtitle')}</p>
        </div>
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
          header={cardHeader}
        >
          <div className="px-1 md:px-2">
            <div className="flex flex-wrap align-items-center gap-2 mb-3 w-full">
              <Dropdown
                value={siteFilter}
                options={siteOptions}
                onChange={(e) => setSiteFilter(e.value as string)}
                placeholder={t('mwte.filter_site')}
                className="min-w-12rem"
                showClear={isAdmin}
              />
              <Dropdown
                value={shellFilter}
                options={[{ label: t('mwte.shell'), value: null }, ...shellOptions]}
                onChange={(e) => setShellFilter(e.value as MwFormShellKey | null)}
                placeholder={t('mwte.shell')}
                className="min-w-12rem"
                optionLabel="label"
                optionValue="value"
              />
              <IconField
                iconPosition="left"
                className="app-crud-toolbar-search flex-shrink-0 ml-auto"
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

            <TabView activeIndex={mainTab} onTabChange={(e) => setMainTab(e.index)}>
          <TabPanel header={t('mwte.tab_templates')}>
            <div className="flex justify-content-end mb-3">
              <Button
                type="button"
                label={t('mwte.new_template')}
                icon="pi pi-plus"
                onClick={openNewTemplate}
              />
            </div>
            <DataTable
              value={filteredTemplates}
              loading={loading}
              dataKey="id"
              emptyMessage={t('common.empty')}
              size="small"
            >
              <Column
                field="site_key"
                header={t('common.col_site')}
                body={(r: MwTemplateRow) => `${r.site_key} — ${r.site_name}`}
              />
              <Column
                field="shell_key"
                header={t('mwte.col_shell')}
                body={(r: MwTemplateRow) => shellLabel(t, r.shell_key as MwFormShellKey)}
              />
              <Column field="key" header={t('common.col_key')} />
              <Column field="name" header={t('common.col_name')} />
              <Column
                header={t('common.actions')}
                body={(r: MwTemplateRow) => (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      icon="pi pi-pencil"
                      text
                      rounded
                      onClick={() => openEditTemplate(r)}
                      aria-label={t('mwte.edit_template')}
                    />
                    <Button
                      type="button"
                      icon="pi pi-trash"
                      text
                      rounded
                      severity="danger"
                      onClick={() => confirmDeleteTemplate(r)}
                      aria-label={t('common.delete')}
                    />
                  </div>
                )}
              />
            </DataTable>
          </TabPanel>
          <TabPanel header={t('mwte.tab_bindings')}>
            <div className="flex flex-column gap-2 mb-3">
              <p className="text-sm text-color-secondary m-0">{t('mwte.priority_hint')}</p>
              <div>
                <Button
                  type="button"
                  label={t('mwte.new_binding')}
                  icon="pi pi-link"
                  onClick={openNewBinding}
                />
              </div>
            </div>
            <DataTable
              value={bindings.map((b) => ({
                ...b,
                _rid: `${b.user_group_id}:${b.shell_key}`,
              }))}
              loading={loading}
              dataKey="_rid"
              size="small"
            >
              <Column
                header={t('common.col_site')}
                body={(b: BindingRow) =>
                  `${userGroups.find((g) => g.id === b.user_group_id)?.site_key ?? ''} — ${
                    userGroups.find((g) => g.id === b.user_group_id)?.site_name ?? ''
                  }`
                }
              />
              <Column
                field="group_name"
                header={t('nav.user_groups')}
                body={(b: BindingRow) => `${b.group_name} (${b.group_key})`}
              />
              <Column
                field="shell_key"
                header={t('mwte.col_shell')}
                body={(b: BindingRow) => shellLabel(t, b.shell_key as MwFormShellKey)}
              />
              <Column
                field="template_name"
                header={t('mwte.col_template')}
                body={(b: BindingRow) => `${b.template_name} (${b.template_key})`}
              />
              <Column field="priority" header={t('mwte.col_priority')} />
              <Column
                header={t('common.actions')}
                body={(b: BindingRow) => (
                  <Button
                    type="button"
                    icon="pi pi-trash"
                    text
                    rounded
                    severity="danger"
                    onClick={() => confirmDeleteBinding(b)}
                    aria-label={t('common.delete')}
                  />
                )}
              />
            </DataTable>
          </TabPanel>
            </TabView>
          </div>
        </Card>
      </div>

      <AppCrudDialog
        title={editingTplId ? t('mwte.edit_template') : t('mwte.new_template')}
        visible={tplDialogOpen}
        onHide={() => setTplDialogOpen(false)}
        dismissableMask={!tplSaving}
        style={{ width: 'min(44rem, 96vw)' }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              onClick={() => setTplDialogOpen(false)}
              disabled={tplSaving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveTemplate()}
              loading={tplSaving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          {!editingTplId ? (
            <div className="grid">
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('mwte.filter_site')}</label>
                <Dropdown
                  value={formSiteId}
                  options={siteOptions}
                  onChange={(e) => setFormSiteId(e.value as string)}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('mwte.shell')}</label>
                <Dropdown
                  value={formShell}
                  options={shellOptions}
                  onChange={(e) => {
                    const s = e.value as MwFormShellKey
                    setFormShell(s)
                    const base = defaultMwLayoutJson(s)
                    if (s === 'costcenter') {
                      setCcOrder(
                        layoutToOrderFieldsCostcenter(base as MwLayoutJsonCostcenter),
                      )
                    } else {
                      setWoOrderByTab(layoutToOrderFieldsWo(base as MwLayoutJsonWorkOrder))
                    }
                  }}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('common.col_key')}</label>
                <InputText
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('common.col_name')}</label>
                <InputText
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
            </div>
          ) : (
            <div className="grid">
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('common.col_key')}</label>
                <InputText
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
              <div className="col-12 md:col-6 flex flex-column gap-2">
                <label className="text-sm font-medium">{t('common.col_name')}</label>
                <InputText
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full"
                  disabled={tplSaving}
                />
              </div>
            </div>
          )}
          <span className="text-sm font-medium">{t('mwte.field_order')}</span>
          {formShell === 'costcenter' ? (
            <OrderList
              dataKey="id"
              value={ccOrder}
              onChange={(e) => setCcOrder(e.value as OrderField[])}
              dragdrop
              className="mw-template-orderlist"
              itemTemplate={(item: OrderField) => (
                <div className="flex align-items-center gap-2 py-1">
                  <Checkbox
                    inputId={`hid-${item.id}`}
                    checked={item.hidden}
                    onChange={(ev) => {
                      const checked = ev.checked === true
                      setCcOrder((prev) =>
                        prev.map((x) =>
                          x.id === item.id ? { ...x, hidden: checked } : x,
                        ),
                      )
                    }}
                  />
                  <label htmlFor={`hid-${item.id}`} className="text-xs text-color-secondary">
                    {t('mwte.hide_field')}
                  </label>
                  <span className="flex-1 min-w-0">
                    {mwEditorFieldLabel(t, 'costcenter', item.id)}
                  </span>
                </div>
              )}
            />
          ) : (
            <TabView>
              {MW_WORK_ORDER_TAB_IDS.map((tabId) => (
                <TabPanel
                  key={tabId}
                  header={mwEditorTabLabel(t, tabId)}
                >
                  <OrderList
                    dataKey="id"
                    value={woOrderByTab[tabId] ?? []}
                    onChange={(e) =>
                      setWoOrderByTab((prev) => ({
                        ...prev,
                        [tabId]: e.value as OrderField[],
                      }))
                    }
                    dragdrop
                    itemTemplate={(item: OrderField) => (
                      <div className="flex align-items-center gap-2 py-1">
                        <Checkbox
                          inputId={`wo-${tabId}-${item.id}`}
                          checked={item.hidden}
                          onChange={(ev) => {
                            const checked = ev.checked === true
                            setWoOrderByTab((prev) => {
                              const cur = prev[tabId] ?? []
                              return {
                                ...prev,
                                [tabId]: cur.map((x) =>
                                  x.id === item.id ? { ...x, hidden: checked } : x,
                                ),
                              }
                            })
                          }}
                        />
                        <label
                          htmlFor={`wo-${tabId}-${item.id}`}
                          className="text-xs text-color-secondary"
                        >
                          {t('mwte.hide_field')}
                        </label>
                        <span className="flex-1 min-w-0">
                          {mwEditorFieldLabel(t, 'work_order', item.id)}
                        </span>
                      </div>
                    )}
                  />
                </TabPanel>
              ))}
            </TabView>
          )}
        </div>
      </AppCrudDialog>

      <AppCrudDialog
        title={t('mwte.new_binding')}
        visible={bindDialogOpen}
        onHide={() => setBindDialogOpen(false)}
        dismissableMask={!bindSaving}
        style={{ width: 'min(32rem, 95vw)' }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label={t('common.cancel')}
              severity="secondary"
              outlined
              onClick={() => setBindDialogOpen(false)}
              disabled={bindSaving}
            />
            <Button
              type="button"
              label={t('common.save')}
              icon="pi pi-check"
              onClick={() => void saveBinding()}
              loading={bindSaving}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">{t('nav.user_groups')}</label>
            <Dropdown
              value={bindGroupId}
              options={groupOptions}
              onChange={(e) => setBindGroupId(e.value as string)}
              className="w-full"
              filter
              placeholder={t('common.search_ellipsis')}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">{t('mwte.shell')}</label>
            <Dropdown
              value={bindShell}
              options={shellOptions}
              onChange={(e) => {
                setBindShell(e.value as MwFormShellKey)
                setBindTemplateId(null)
              }}
              className="w-full"
            />
          </div>
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">{t('mwte.col_template')}</label>
            <Dropdown
              value={bindTemplateId}
              options={templateOptionsForBind}
              onChange={(e) => setBindTemplateId(e.value as string)}
              className="w-full"
              filter
              placeholder={t('common.search_ellipsis')}
            />
          </div>
          <div className="flex flex-column gap-2">
            <label className="text-sm font-medium">{t('mwte.col_priority')}</label>
            <InputNumber
              value={bindPriority}
              onValueChange={(e) => setBindPriority(e.value ?? 100)}
              min={0}
              max={1_000_000}
              className="w-full"
              inputClassName="w-full"
            />
            <span className="text-xs text-color-secondary">{t('mwte.priority_hint')}</span>
          </div>
        </div>
      </AppCrudDialog>
    </AppShell>
  )
}
