import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { RadioButton } from 'primereact/radiobutton'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'

type AppParametersResponse = {
  wo: {
    start_requires_assignment: boolean
    user_auto_assign_on_start: boolean
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
  const [baselineStartRequires, setBaselineStartRequires] = useState(true)
  const [baselineUserAutoAssign, setBaselineUserAutoAssign] = useState(true)

  const dirty =
    startRequiresAssignment !== baselineStartRequires ||
    userAutoAssignOnStart !== baselineUserAutoAssign
  const swbRadiosDisabled = loading || !isAdmin
  const uaaRadiosDisabled =
    swbRadiosDisabled || startRequiresAssignment === true

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
      setStartRequiresAssignment(swb)
      setUserAutoAssignOnStart(uaa)
      setBaselineStartRequires(swb)
      setBaselineUserAutoAssign(uaa)
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
      await apiJson<AppParametersResponse>('/api/app-parameters', {
        method: 'PATCH',
        body: JSON.stringify({
          wo: {
            start_requires_assignment: startRequiresAssignment,
            user_auto_assign_on_start: userAutoAssignOnStart,
          },
        }),
      })
      setBaselineStartRequires(startRequiresAssignment)
      setBaselineUserAutoAssign(userAutoAssignOnStart)
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
                <div className="flex flex-column gap-4 pt-2 min-h-[18rem]">
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
