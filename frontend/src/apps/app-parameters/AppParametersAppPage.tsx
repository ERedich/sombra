import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { ColorPicker } from 'primereact/colorpicker'
import { InputNumber } from 'primereact/inputnumber'
import { RadioButton } from 'primereact/radiobutton'
import { TabPanel, TabView } from 'primereact/tabview'
import { Toast } from 'primereact/toast'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import {
  mergeDisplayStatusColours,
  woStatusHexFromPickerValue,
  woStatusHexToPickerValue,
  WORK_ORDER_STATUS_KEYS,
  type WorkOrderStatusColourKey,
} from '../../constants/woStatusColours'
import { AppShell } from '../../layout/AppShell'
import { useAppParameters } from '../../layout/AppParametersProvider'
import {
  DEFAULT_GENERAL_DTF,
  GENERAL_DTF_IDS,
  isGeneralDtfId,
  type GeneralDtfId,
} from '../../utils/dateTimeFormatPreference'
import {
  DEFAULT_GENERAL_FDW,
  GENERAL_FDW_IDS,
  isGeneralFdwId,
  type GeneralFdwId,
} from '../../utils/firstDayOfWeekPreference'

const IDLE_SESSION_MAX_MINUTES = 10080

const WO_STATUS_I18N_KEYS: Record<WorkOrderStatusColourKey, string> = {
  open: 'wo.status_open',
  assigned: 'wo.status_assigned',
  started: 'wo.status_started',
  continued: 'wo.status_continued',
  on_hold: 'wo.status_on_hold',
  done: 'wo.status_done',
  closed: 'wo.status_closed',
}

type AppParametersResponse = {
  wo: {
    start_requires_assignment: boolean
    user_auto_assign_on_start: boolean
    allow_multiple_started_work_orders: boolean
    lock_end_date_by_duration?: boolean
    allow_plan_start_in_history?: boolean
    require_time_registration_for_done?: boolean
    planned_hours_restriction?: boolean
    work_order_status_colours?: Partial<
      Record<WorkOrderStatusColourKey, string>
    >
  }
  general: {
    idle_session_timeout_minutes: number
    dtf?: string
    fdw?: string
    ask_for_site_change_on_login?: boolean
  }
  shifts?: {
    shift_login_recognition?: boolean
    shift_planning_capacity_pct?: number
    shift_bound_projection?: boolean
  }
}

const DTF_LABEL_KEYS: Record<GeneralDtfId, string> = {
  ddmmyyyy_hhmm: 'app_params.general_dtf_opt_ddmmyyyy',
  ddmmyy_hhmm: 'app_params.general_dtf_opt_ddmmyy',
  mmddyyyy_hhmm: 'app_params.general_dtf_opt_mmddyyyy',
  mmddyy_hhmm: 'app_params.general_dtf_opt_mmddyy',
}

const FDW_LABEL_KEYS: Record<GeneralFdwId, string> = {
  monday: 'app_params.general_fdw_opt_monday',
  sunday: 'app_params.general_fdw_opt_sunday',
}

export default function AppParametersAppPage() {
  const { t } = useTranslation()
  const {
    applyGeneralFromApi,
    applyShiftParamsFromApi,
    applyPlannedHoursRestrictionFromApi,
  } = useAppParameters()
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
  const [lockEndDateByDuration, setLockEndDateByDuration] = useState(false)
  const [baselineLockEndDateByDuration, setBaselineLockEndDateByDuration] =
    useState(false)
  const [allowPlanStartInHistory, setAllowPlanStartInHistory] = useState(false)
  const [baselineAllowPlanStartInHistory, setBaselineAllowPlanStartInHistory] =
    useState(false)
  const [requireTimeRegistrationForDone, setRequireTimeRegistrationForDone] =
    useState(true)
  const [baselineRequireTimeRegistrationForDone, setBaselineRequireTimeRegistrationForDone] =
    useState(true)
  const [plannedHoursRestriction, setPlannedHoursRestriction] = useState(true)
  const [baselinePlannedHoursRestriction, setBaselinePlannedHoursRestriction] =
    useState(true)
  const [statusColours, setStatusColours] = useState<
    Record<WorkOrderStatusColourKey, string>
  >(() => mergeDisplayStatusColours({}))
  const [baselineStatusColours, setBaselineStatusColours] = useState<
    Record<WorkOrderStatusColourKey, string>
  >(() => mergeDisplayStatusColours({}))
  const [idleSessionTimeoutMinutes, setIdleSessionTimeoutMinutes] = useState(0)
  const [baselineIdleSessionTimeoutMinutes, setBaselineIdleSessionTimeoutMinutes] =
    useState(0)
  const [dtf, setDtf] = useState<GeneralDtfId>(DEFAULT_GENERAL_DTF)
  const [baselineDtf, setBaselineDtf] = useState<GeneralDtfId>(
    DEFAULT_GENERAL_DTF,
  )
  const [fdw, setFdw] = useState<GeneralFdwId>(DEFAULT_GENERAL_FDW)
  const [baselineFdw, setBaselineFdw] = useState<GeneralFdwId>(
    DEFAULT_GENERAL_FDW,
  )
  const [askSiteChangeOnLogin, setAskSiteChangeOnLogin] = useState(false)
  const [baselineAskSiteChangeOnLogin, setBaselineAskSiteChangeOnLogin] =
    useState(false)
  const [shiftSlr, setShiftSlr] = useState(true)
  const [baselineShiftSlr, setBaselineShiftSlr] = useState(true)
  const [shiftPlanningCapacityPct, setShiftPlanningCapacityPct] = useState(100)
  const [baselineShiftPlanningCapacityPct, setBaselineShiftPlanningCapacityPct] =
    useState(100)
  const [shiftBoundProjection, setShiftBoundProjection] = useState(true)
  const [baselineShiftBoundProjection, setBaselineShiftBoundProjection] =
    useState(true)

  const woDirty =
    startRequiresAssignment !== baselineStartRequires ||
    userAutoAssignOnStart !== baselineUserAutoAssign ||
    allowMultipleStarted !== baselineAllowMultipleStarted ||
    lockEndDateByDuration !== baselineLockEndDateByDuration ||
    allowPlanStartInHistory !== baselineAllowPlanStartInHistory ||
    requireTimeRegistrationForDone !== baselineRequireTimeRegistrationForDone ||
    plannedHoursRestriction !== baselinePlannedHoursRestriction ||
    JSON.stringify(statusColours) !== JSON.stringify(baselineStatusColours)
  const generalDirty =
    idleSessionTimeoutMinutes !== baselineIdleSessionTimeoutMinutes ||
    dtf !== baselineDtf ||
    fdw !== baselineFdw ||
    askSiteChangeOnLogin !== baselineAskSiteChangeOnLogin
  const shiftsDirty =
    shiftSlr !== baselineShiftSlr ||
    shiftPlanningCapacityPct !== baselineShiftPlanningCapacityPct ||
    shiftBoundProjection !== baselineShiftBoundProjection
  const dirty = woDirty || generalDirty || shiftsDirty
  const swbRadiosDisabled = loading || !isAdmin
  const uaaRadiosDisabled =
    swbRadiosDisabled || startRequiresAssignment === true
  const mswoRadiosDisabled = swbRadiosDisabled
  const leddRadiosDisabled = swbRadiosDisabled
  const pshRadiosDisabled = swbRadiosDisabled

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
      const trr = data.wo?.require_time_registration_for_done !== false
      const phr = data.wo?.planned_hours_restriction !== false
      const rawColours = data.wo?.work_order_status_colours
      const mergedColours = mergeDisplayStatusColours(
        rawColours && typeof rawColours === 'object' && !Array.isArray(rawColours)
          ? (rawColours as Partial<Record<WorkOrderStatusColourKey, string>>)
          : {},
      )
      setStartRequiresAssignment(swb)
      setUserAutoAssignOnStart(uaa)
      setAllowMultipleStarted(mswo)
      setBaselineStartRequires(swb)
      setBaselineUserAutoAssign(uaa)
      setBaselineAllowMultipleStarted(mswo)
      const ledd = data.wo?.lock_end_date_by_duration === true
      setLockEndDateByDuration(ledd)
      setBaselineLockEndDateByDuration(ledd)
      const psh = data.wo?.allow_plan_start_in_history === true
      setAllowPlanStartInHistory(psh)
      setBaselineAllowPlanStartInHistory(psh)
      setRequireTimeRegistrationForDone(trr)
      setBaselineRequireTimeRegistrationForDone(trr)
      setPlannedHoursRestriction(phr)
      setBaselinePlannedHoursRestriction(phr)
      setStatusColours(mergedColours)
      setBaselineStatusColours({ ...mergedColours })
      const idleRaw = data.general?.idle_session_timeout_minutes
      const idle =
        typeof idleRaw === 'number' && Number.isInteger(idleRaw) ? idleRaw : 0
      const idleClamped = Math.min(
        Math.max(0, idle),
        IDLE_SESSION_MAX_MINUTES,
      )
      setIdleSessionTimeoutMinutes(idleClamped)
      setBaselineIdleSessionTimeoutMinutes(idleClamped)
      const dtfNext = isGeneralDtfId(data.general?.dtf)
        ? data.general!.dtf
        : DEFAULT_GENERAL_DTF
      setDtf(dtfNext)
      setBaselineDtf(dtfNext)
      const fdwNext = isGeneralFdwId(data.general?.fdw)
        ? data.general!.fdw
        : DEFAULT_GENERAL_FDW
      setFdw(fdwNext)
      setBaselineFdw(fdwNext)
      const askSite =
        data.general?.ask_for_site_change_on_login === true
      setAskSiteChangeOnLogin(askSite)
      setBaselineAskSiteChangeOnLogin(askSite)
      const slr = data.shifts?.shift_login_recognition !== false
      setShiftSlr(slr)
      setBaselineShiftSlr(slr)
      const pctRaw = data.shifts?.shift_planning_capacity_pct
      const pct =
        typeof pctRaw === 'number' && Number.isInteger(pctRaw)
          ? Math.min(100, Math.max(0, pctRaw))
          : 100
      setShiftPlanningCapacityPct(pct)
      setBaselineShiftPlanningCapacityPct(pct)
      const sbpr = data.shifts?.shift_bound_projection !== false
      setShiftBoundProjection(sbpr)
      setBaselineShiftBoundProjection(sbpr)
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
          lock_end_date_by_duration: lockEndDateByDuration,
          allow_plan_start_in_history: allowPlanStartInHistory,
          require_time_registration_for_done: requireTimeRegistrationForDone,
          planned_hours_restriction: plannedHoursRestriction,
          allow_custom_work_order_status_colours: true,
          work_order_status_colours: statusColours,
        }
      }
      if (generalDirty) {
        body.general = {
          idle_session_timeout_minutes: idleSessionTimeoutMinutes,
          dtf,
          fdw,
          ask_for_site_change_on_login: askSiteChangeOnLogin,
        }
      }
      if (shiftsDirty) {
        body.shifts = {
          shift_login_recognition: shiftSlr,
          shift_planning_capacity_pct: shiftPlanningCapacityPct,
          shift_bound_projection: shiftBoundProjection,
        }
      }
      const data = await apiJson<AppParametersResponse>('/api/app-parameters', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (data.general) {
        const idleR = data.general.idle_session_timeout_minutes
        const idleN =
          typeof idleR === 'number' && Number.isInteger(idleR) ? idleR : 0
        const idleC = Math.min(Math.max(0, idleN), IDLE_SESSION_MAX_MINUTES)
        applyGeneralFromApi({
          idle_session_timeout_minutes: idleC,
          dtf: isGeneralDtfId(data.general.dtf)
            ? data.general.dtf
            : DEFAULT_GENERAL_DTF,
          fdw: isGeneralFdwId(data.general.fdw)
            ? data.general.fdw
            : DEFAULT_GENERAL_FDW,
          ask_for_site_change_on_login:
            data.general.ask_for_site_change_on_login === true,
        })
      }
      setBaselineStartRequires(startRequiresAssignment)
      setBaselineUserAutoAssign(userAutoAssignOnStart)
      setBaselineAllowMultipleStarted(allowMultipleStarted)
      setBaselineLockEndDateByDuration(lockEndDateByDuration)
      setBaselineAllowPlanStartInHistory(allowPlanStartInHistory)
      setBaselineRequireTimeRegistrationForDone(requireTimeRegistrationForDone)
      setBaselinePlannedHoursRestriction(plannedHoursRestriction)
      setBaselineStatusColours({ ...statusColours })
      setBaselineIdleSessionTimeoutMinutes(idleSessionTimeoutMinutes)
      setBaselineDtf(dtf)
      setBaselineFdw(fdw)
      setBaselineAskSiteChangeOnLogin(askSiteChangeOnLogin)
      if (shiftsDirty && data.shifts) {
        const slr = data.shifts.shift_login_recognition !== false
        const pctR = data.shifts.shift_planning_capacity_pct
        const pct =
          typeof pctR === 'number' && Number.isInteger(pctR)
            ? Math.min(100, Math.max(0, pctR))
            : 100
        const sbpr = data.shifts.shift_bound_projection !== false
        applyShiftParamsFromApi({
          shiftLoginRecognition: slr,
          shiftPlanningCapacityPct: pct,
          shiftBoundProjection: sbpr,
        })
        setBaselineShiftSlr(slr)
        setShiftSlr(slr)
        setBaselineShiftPlanningCapacityPct(pct)
        setShiftPlanningCapacityPct(pct)
        setBaselineShiftBoundProjection(sbpr)
        setShiftBoundProjection(sbpr)
      }
      if (data.wo) {
        applyPlannedHoursRestrictionFromApi(
          data.wo.planned_hours_restriction !== false,
        )
      }
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
    lockEndDateByDuration,
    allowPlanStartInHistory,
    requireTimeRegistrationForDone,
    plannedHoursRestriction,
    statusColours,
    generalDirty,
    idleSessionTimeoutMinutes,
    dtf,
    fdw,
    askSiteChangeOnLogin,
    woDirty,
    shiftsDirty,
    shiftSlr,
    shiftPlanningCapacityPct,
    shiftBoundProjection,
    t,
    applyGeneralFromApi,
    applyShiftParamsFromApi,
    applyPlannedHoursRestrictionFromApi,
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

                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.wo_ledd_heading')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_ledd_explain')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_ledd_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_ledd_y"
                            name="wo_lock_end_date_by_duration"
                            value={true}
                            checked={lockEndDateByDuration === true}
                            onChange={() => setLockEndDateByDuration(true)}
                            disabled={leddRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_ledd_y"
                            className={
                              leddRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_yes')}
                          </label>
                        </div>
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_ledd_n"
                            name="wo_lock_end_date_by_duration"
                            value={false}
                            checked={lockEndDateByDuration === false}
                            onChange={() => setLockEndDateByDuration(false)}
                            disabled={leddRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_ledd_n"
                            className={
                              leddRadiosDisabled
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
                      {t('app_params.wo_psh_heading')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_psh_explain')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_psh_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_psh_y"
                            name="wo_allow_plan_start_in_history"
                            value={true}
                            checked={allowPlanStartInHistory === true}
                            onChange={() => setAllowPlanStartInHistory(true)}
                            disabled={pshRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_psh_y"
                            className={
                              pshRadiosDisabled
                                ? 'text-sm text-color-secondary cursor-default'
                                : 'text-sm cursor-pointer'
                            }
                          >
                            {t('app_params.option_yes')}
                          </label>
                        </div>
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_psh_n"
                            name="wo_allow_plan_start_in_history"
                            value={false}
                            checked={allowPlanStartInHistory === false}
                            onChange={() => setAllowPlanStartInHistory(false)}
                            disabled={pshRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_psh_n"
                            className={
                              pshRadiosDisabled
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
                      {t('app_params.wo_trr_heading')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <p className="text-sm text-color-secondary m-0 flex-1 min-w-0 lg:pr-4 line-height-3">
                        {t('app_params.wo_trr_explain')}
                      </p>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.wo_trr_heading')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_trr_y"
                            name="wo_require_time_registration_for_done"
                            value={true}
                            checked={requireTimeRegistrationForDone === true}
                            onChange={() => setRequireTimeRegistrationForDone(true)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_trr_y"
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
                            inputId="app_params_wo_trr_n"
                            name="wo_require_time_registration_for_done"
                            value={false}
                            checked={requireTimeRegistrationForDone === false}
                            onChange={() => setRequireTimeRegistrationForDone(false)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_trr_n"
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
                      {t('app_params.phr_section')}
                    </h2>
                    <div className="flex flex-column lg:flex-row lg:align-items-start lg:justify-content-between gap-3">
                      <div className="flex flex-column gap-2 flex-1 min-w-0 lg:pr-4">
                        <p className="text-sm text-color-secondary m-0 line-height-3">
                          {t('app_params.phr_question')}
                        </p>
                        <p className="text-xs text-color-secondary m-0 line-height-3">
                          {t('app_params.phr_hint')}
                        </p>
                      </div>
                      <div
                        className="flex align-items-center gap-4 flex-shrink-0"
                        role="radiogroup"
                        aria-label={t('app_params.phr_section')}
                      >
                        <div className="flex align-items-center gap-2">
                          <RadioButton
                            inputId="app_params_wo_phr_y"
                            name="wo_planned_hours_restriction"
                            value={true}
                            checked={plannedHoursRestriction === true}
                            onChange={() => setPlannedHoursRestriction(true)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_phr_y"
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
                            inputId="app_params_wo_phr_n"
                            name="wo_planned_hours_restriction"
                            value={false}
                            checked={plannedHoursRestriction === false}
                            onChange={() => setPlannedHoursRestriction(false)}
                            disabled={swbRadiosDisabled}
                          />
                          <label
                            htmlFor="app_params_wo_phr_n"
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
                      {t('app_params.wo_wost_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.wo_wost_explain')}
                    </p>
                    <div className="flex flex-column gap-3 pt-2">
                      <h3 className="text-sm font-semibold m-0">
                        {t('app_params.wo_wost_colours_heading')}
                      </h3>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                          columnGap: '1rem',
                          rowGap: '0.75rem',
                          alignItems: 'center',
                        }}
                      >
                        {WORK_ORDER_STATUS_KEYS.map((sk) => (
                          <div key={sk} style={{ display: 'contents' }}>
                            <label
                              className="text-sm min-w-0"
                              htmlFor={`app_params_wo_colour_${sk}`}
                            >
                              {t(WO_STATUS_I18N_KEYS[sk])}
                            </label>
                            <div className="flex align-items-center flex-shrink-0">
                              <ColorPicker
                                inputId={`app_params_wo_colour_${sk}`}
                                format="hex"
                                value={woStatusHexToPickerValue(statusColours[sk])}
                                onChange={(e) =>
                                  setStatusColours((prev) => ({
                                    ...prev,
                                    [sk]: woStatusHexFromPickerValue(
                                      typeof e.value === 'string'
                                        ? e.value
                                        : '000000',
                                    ),
                                  }))
                                }
                                disabled={swbRadiosDisabled}
                              />
                            </div>
                            <span className="text-sm font-mono text-color-secondary white-space-nowrap">
                              {statusColours[sk]}
                            </span>
                          </div>
                        ))}
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

              <TabPanel header={t('app_params.tab_shifts')}>
                <div className="flex flex-column gap-4 pt-2 min-h-[28rem]">
                  <p className="text-xs text-color-secondary m-0 line-height-3">
                    {t('app_params.shifts_tab_legend')}
                  </p>
                  <div className="flex flex-column gap-3">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.shifts_slr_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.shifts_slr_help')}
                    </p>
                    <div
                      className="flex align-items-center gap-4 flex-shrink-0"
                      role="radiogroup"
                      aria-label={t('app_params.shifts_slr_heading')}
                    >
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_slr_y"
                          name="shift_slr"
                          checked={shiftSlr === true}
                          onChange={() => setShiftSlr(true)}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_slr_y"
                          className={
                            loading || !isAdmin
                              ? 'text-sm text-color-secondary cursor-default'
                              : 'text-sm cursor-pointer'
                          }
                        >
                          {t('app_params.option_yes')}
                        </label>
                      </div>
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_slr_n"
                          name="shift_slr"
                          checked={shiftSlr === false}
                          onChange={() => setShiftSlr(false)}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_slr_n"
                          className={
                            loading || !isAdmin
                              ? 'text-sm text-color-secondary cursor-default'
                              : 'text-sm cursor-pointer'
                          }
                        >
                          {t('app_params.option_no')}
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-column gap-3">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.shifts_sbpr_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.shifts_sbpr_help')}
                    </p>
                    <div
                      className="flex align-items-center gap-4 flex-shrink-0"
                      role="radiogroup"
                      aria-label={t('app_params.shifts_sbpr_heading')}
                    >
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_sbpr_y"
                          name="shift_sbpr"
                          checked={shiftBoundProjection === true}
                          onChange={() => setShiftBoundProjection(true)}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_sbpr_y"
                          className={
                            loading || !isAdmin
                              ? 'text-sm text-color-secondary cursor-default'
                              : 'text-sm cursor-pointer'
                          }
                        >
                          {t('app_params.option_yes')}
                        </label>
                      </div>
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_sbpr_n"
                          name="shift_sbpr"
                          checked={shiftBoundProjection === false}
                          onChange={() => setShiftBoundProjection(false)}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_sbpr_n"
                          className={
                            loading || !isAdmin
                              ? 'text-sm text-color-secondary cursor-default'
                              : 'text-sm cursor-pointer'
                          }
                        >
                          {t('app_params.option_no')}
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-column gap-3">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.shifts_spc_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.shifts_spc_help')}
                    </p>
                    <div className="flex flex-column gap-2 align-items-start max-w-full">
                      <label
                        htmlFor="app_params_shift_spc"
                        className="text-sm font-medium"
                      >
                        {t('app_params.shifts_spc_label')}
                      </label>
                      <InputNumber
                        inputId="app_params_shift_spc"
                        value={shiftPlanningCapacityPct}
                        onValueChange={(e) =>
                          setShiftPlanningCapacityPct(
                            typeof e.value === 'number' ? e.value : 0,
                          )
                        }
                        min={0}
                        max={100}
                        suffix=" %"
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

              <TabPanel header={t('app_params.tab_general')}>
                <div className="flex flex-column gap-4 pt-2 min-h-[28rem]">
                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.general_dtf_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.general_dtf_help')}
                    </p>
                    <div
                      className="flex flex-column gap-2 align-items-start"
                      role="radiogroup"
                      aria-label={t('app_params.general_dtf_heading')}
                    >
                      {GENERAL_DTF_IDS.map((id) => (
                        <div key={id} className="flex align-items-center gap-2">
                          <RadioButton
                            inputId={`app_params_dtf_${id}`}
                            onChange={() => setDtf(id)}
                            checked={dtf === id}
                            disabled={loading || !isAdmin}
                          />
                          <label
                            htmlFor={`app_params_dtf_${id}`}
                            className="text-sm cursor-pointer"
                          >
                            {t(DTF_LABEL_KEYS[id])}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.general_fdw_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.general_fdw_help')}
                    </p>
                    <div
                      className="flex flex-column gap-2 align-items-start"
                      role="radiogroup"
                      aria-label={t('app_params.general_fdw_heading')}
                    >
                      {GENERAL_FDW_IDS.map((id) => (
                        <div key={id} className="flex align-items-center gap-2">
                          <RadioButton
                            inputId={`app_params_fdw_${id}`}
                            onChange={() => setFdw(id)}
                            checked={fdw === id}
                            disabled={loading || !isAdmin}
                          />
                          <label
                            htmlFor={`app_params_fdw_${id}`}
                            className="text-sm cursor-pointer"
                          >
                            {t(FDW_LABEL_KEYS[id])}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-column gap-2">
                    <h2 className="text-base font-semibold m-0">
                      {t('app_params.general_ask_site_change_heading')}
                    </h2>
                    <p className="text-sm text-color-secondary m-0 line-height-3">
                      {t('app_params.general_ask_site_change_help')}
                    </p>
                    <div
                      className="flex flex-column gap-2 align-items-start"
                      role="radiogroup"
                      aria-label={t('app_params.general_ask_site_change_label')}
                    >
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_ask_site_y"
                          onChange={() => setAskSiteChangeOnLogin(true)}
                          checked={askSiteChangeOnLogin === true}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_ask_site_y"
                          className="text-sm cursor-pointer"
                        >
                          {t('app_params.general_ask_site_change_y')}
                        </label>
                      </div>
                      <div className="flex align-items-center gap-2">
                        <RadioButton
                          inputId="app_params_ask_site_n"
                          onChange={() => setAskSiteChangeOnLogin(false)}
                          checked={askSiteChangeOnLogin === false}
                          disabled={loading || !isAdmin}
                        />
                        <label
                          htmlFor="app_params_ask_site_n"
                          className="text-sm cursor-pointer"
                        >
                          {t('app_params.general_ask_site_change_n')}
                        </label>
                      </div>
                    </div>
                  </div>

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
