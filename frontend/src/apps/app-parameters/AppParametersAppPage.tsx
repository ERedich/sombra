import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { InputNumber } from 'primereact/inputnumber'
import { RadioButton } from 'primereact/radiobutton'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'

const IDLE_SESSION_MAX_MINUTES = 10080

type AppParametersResponse = {
  wo: {
    start_requires_assignment: boolean
    user_auto_assign_on_start: boolean
    allow_multiple_started_work_orders: boolean
  }
  general: {
    idle_session_timeout_minutes: number
  }
}

export default function AppParametersAppPage() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const isAdmin = getStoredUser()?.role === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [startRequiresAssignment, setStartRequiresAssignment] = useState(true)
  const [userAutoAssignOnStart, setUserAutoAssignOnStart] = useState(true)
  const [allowMultipleStarted, setAllowMultipleStarted] = useState(false)
  const [baselineStartRequires, setBaselineStartRequires] = useState(true)
  const [baselineUserAutoAssign, setBaselineUserAutoAssign] = useState(true)
  const [baselineAllowMultipleStarted, setBaselineAllowMultipleStarted] =
    useState(false)
  const [idleSessionTimeoutMinutes, setIdleSessionTimeoutMinutes] = useState(0)
  const [baselineIdleSessionTimeoutMinutes, setBaselineIdleSessionTimeoutMinutes] =
    useState(0)

  const woDirty =
    startRequiresAssignment !== baselineStartRequires ||
    userAutoAssignOnStart !== baselineUserAutoAssign ||
    allowMultipleStarted !== baselineAllowMultipleStarted
  const generalDirty =
    idleSessionTimeoutMinutes !== baselineIdleSessionTimeoutMinutes
  const dirty = woDirty || generalDirty
  const swbRadiosDisabled = loading || !isAdmin
  const uaaRadiosDisabled =
    swbRadiosDisabled || startRequiresAssignment === true
  const mswoRadiosDisabled = swbRadiosDisabled

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

  const loadParams = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<AppParametersResponse>('/api/app-parameters')
      const swb = data.wo?.start_requires_assignment !== false
      const uaa = data.wo?.user_auto_assign_on_start !== false
      const mswo = data.wo?.allow_multiple_started_work_orders === true
      setStartRequiresAssignment(swb)
      setUserAutoAssignOnStart(uaa)
      setAllowMultipleStarted(mswo)
      setBaselineStartRequires(swb)
      setBaselineUserAutoAssign(uaa)
      setBaselineAllowMultipleStarted(mswo)
      const idleRaw = data.general?.idle_session_timeout_minutes
      const idle =
        typeof idleRaw === 'number' && Number.isInteger(idleRaw) ? idleRaw : 0
      const idleClamped = Math.min(
        Math.max(0, idle),
        IDLE_SESSION_MAX_MINUTES,
      )
      setIdleSessionTimeoutMinutes(idleClamped)
      setBaselineIdleSessionTimeoutMinutes(idleClamped)
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('app_params.load_fail'))
      }
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void loadParams()
  }, [loadParams])

  const save = useCallback(async () => {
    if (!isAdmin || !dirty) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (woDirty) {
        body.wo = {
          start_requires_assignment: startRequiresAssignment,
          user_auto_assign_on_start: userAutoAssignOnStart,
          allow_multiple_started_work_orders: allowMultipleStarted,
        }
      }
      if (generalDirty) {
        body.general = {
          idle_session_timeout_minutes: idleSessionTimeoutMinutes,
        }
      }
      await apiJson<AppParametersResponse>('/api/app-parameters', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setBaselineStartRequires(startRequiresAssignment)
      setBaselineUserAutoAssign(userAutoAssignOnStart)
      setBaselineAllowMultipleStarted(allowMultipleStarted)
      setBaselineIdleSessionTimeoutMinutes(idleSessionTimeoutMinutes)
      showSuccess(t('app_params.saved'))
    } catch (e) {
      if (e instanceof ApiError) {
        showError(e.message)
      } else {
        showError(t('app_params.save_fail'))
      }
    } finally {
      setSaving(false)
    }
  }, [
    dirty,
    isAdmin,
    showError,
    showSuccess,
    startRequiresAssignment,
    userAutoAssignOnStart,
    allowMultipleStarted,
    generalDirty,
    idleSessionTimeoutMinutes,
    woDirty,
    t,
  ])

  const cardHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-sliders-h text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('app_params.title')}</h1>
      </div>
    </div>
  )

  return (
    <AppShell>
      <Toast ref={toast} position="top-right" />
      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={cardHeader}
        >
          <div className="px-1 md:px-2">
            <TabView className="app-modal-tabview">
              <TabPanel header={t('app_params.tab_work_orders')}>
                <div className="flex flex-column gap-4 pt-2 min-h-[28rem]">
                  <p className="text-xs text-color-secondary m-0 line-height-3">
                    {t('app_params.wo_abbr_legend')}
                  </p>

                  <div className="flex flex-column gap-3">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.wo_start_heading')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_start_require_assignment')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_start_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_start_y"
                            name="wo_start_requires_assignment"
                            value={true}
                            checked={startRequiresAssignment === true}
                            onChange={() => setStartRequiresAssignment(true)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_start_y"
                            className={
                              swbRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_yes')}
                          </label>
                        </div>
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_start_n"
                            name="wo_start_requires_assignment"
                            value={false}
                            checked={startRequiresAssignment === false}
                            onChange={() => setStartRequiresAssignment(false)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_start_n"
                            className={
                              swbRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_no')}
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.wo_uaa_heading')}
                    </h2>
                    {startRequiresAssignment ? (
                      <p className="text-xs text-color-secondary m-0">
                        {t('app_params.wo_uaa_disabled_hint')}
                      </p>
                    ) : null}
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_uaa_explain')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_uaa_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_uaa_y"
                            name="wo_user_auto_assign_on_start"
                            value={true}
                            checked={userAutoAssignOnStart === true}
                            onChange={() => setUserAutoAssignOnStart(true)}
                            disabled={uaaRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_uaa_y"
                            className={
                              uaaRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_yes')}
                          </label>
                        </div>
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_uaa_n"
                            name="wo_user_auto_assign_on_start"
                            value={false}
                            checked={userAutoAssignOnStart === false}
                            onChange={() => setUserAutoAssignOnStart(false)}
                            disabled={uaaRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_uaa_n"
                            className={
                              uaaRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_no')}
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.wo_mswo_heading')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_mswo_explain')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_mswo_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_mswo_y"
                            name="wo_allow_multiple_started"
                            value={true}
                            checked={allowMultipleStarted === true}
                            onChange={() => setAllowMultipleStarted(true)}
                            disabled={mswoRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_mswo_y"
                            className={
                              mswoRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_yes')}
                          </label>
                        </div>
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_mswo_n"
                            name="wo_allow_multiple_started"
                            value={false}
                            checked={allowMultipleStarted === false}
                            onChange={() => setAllowMultipleStarted(false)}
                            disabled={mswoRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_mswo_n"
                            className={
                              mswoRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_no')}
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isAdmin ? (
                    <div>
                      <Button
                        type="button"
                        label={t('app_params.save')}
                        icon="pi pi-check"
                        onClick={() => void save()}
                        disabled={!dirty || saving || loading}
                        loading={saving}
                      />
                    </div>
                  ) : null}
                </div>
              </TabPanel>

              <TabPanel header={t('app_params.tab_general')}>
                <div className="flex flex-column gap-4 pt-2 min-h-[28rem]">
                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.general_idle_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.general_idle_help')}
                    </p>
                    <p className="text-xs text-color-secondary m-0">
                      {t('app_params.general_idle_max_hint')}
                    </p>
                    <div className="flex flex-column gap-2 align-items-start max-w-full">
                      <label
                        htmlFor="app_params_idle_timeout"
                        className="text-sm font-medium">
                        {t('app_params.general_idle_label')}
                      </label>
                      <InputNumber
                        inputId="app_params_idle_timeout"
                        value={idleSessionTimeoutMinutes}
                        onValueChange={(e) =>
                          setIdleSessionTimeoutMinutes(
                            typeof e.value === 'number' ? e.value : 0,
                          )
                        }
                        min={0}
                        max={IDLE_SESSION_MAX_MINUTES}
                        step={1}
                        showButtons
                        disabled={loading || !isAdmin}
                        className="w-full"
                        inputClassName="w-full"
                      />
                    </div>
                  </div>

                  {isAdmin ? (
                    <div>
                      <Button
                        type="button"
                        label={t('app_params.save')}
                        icon="pi pi-check"
                        onClick={() => void save()}
                        disabled={!dirty || saving || loading}
                        loading={saving}
                      />
                    </div>
                  ) : null}
                </div>
              </TabPanel>
            </TabView>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
