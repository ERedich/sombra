import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Message } from 'primereact/message'
import { apiBase, apiJson } from '../api'
import { getToken } from '../auth'
import { AppShell } from '../layout/AppShell'

type ShiftCapacityKpiResponse = {
  tac_hours: number
  tach_hours: number
  working_site_id: string | null
  as_of: string
}

export default function HomePage() {
  const { t } = useTranslation()
  const [shiftKpi, setShiftKpi] = useState<ShiftCapacityKpiResponse | null>(
    null,
  )
  const [shiftKpiLoading, setShiftKpiLoading] = useState(false)
  const [health, setHealth] = useState<
    'idle' | 'loading' | 'ok' | 'error'
  >('idle')
  const [healthDetail, setHealthDetail] = useState<string>('')
  const [dbOk, setDbOk] = useState<boolean | null>(null)

  const checkHealth = useCallback(async () => {
    setHealth('loading')
    setHealthDetail('')
    try {
      const token = getToken()
      const res = await fetch(`${apiBase}/api/health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = (await res.json()) as {
        ok?: boolean
        db?: boolean
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      setHealth('ok')
      setDbOk(data.db ?? null)
      setHealthDetail(
        data.db === undefined
          ? JSON.stringify(data)
          : t('home.health_detail', { db: String(data.db) }),
      )
    } catch (e) {
      setHealth('error')
      setDbOk(null)
      setHealthDetail(e instanceof Error ? e.message : 'Request failed')
    }
  }, [t])

  useEffect(() => {
    void checkHealth()
  }, [checkHealth])

  const loadShiftKpi = useCallback(async () => {
    if (!getToken()) {
      setShiftKpi(null)
      setShiftKpiLoading(false)
      return
    }
    setShiftKpiLoading(true)
    try {
      const d = await apiJson<ShiftCapacityKpiResponse>(
        '/api/dashboard/shift-capacity',
      )
      setShiftKpi(d)
    } catch {
      setShiftKpi(null)
    } finally {
      setShiftKpiLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadShiftKpi()
  }, [loadShiftKpi])

  const homeCardHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-server text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('home.title')}</h1>
        <p className="app-card-hero-desc">{t('home.subtitle')}</p>
      </div>
    </div>
  )

  return (
    <AppShell>
      <div className="p-4 max-w-30rem mx-auto flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={homeCardHeader}
        >
          <div className="px-1 md:px-2">
          <p className="mt-0 text-color-secondary text-sm">{apiBase}</p>
          <Button
            type="button"
            label={t('home.check_health')}
            icon="pi pi-refresh"
            onClick={() => void checkHealth()}
            loading={health === 'loading'}
            className="mb-2"
          />
          {health === 'ok' && (
            <Message severity="success" text={healthDetail} className="w-full" />
          )}
          {health === 'error' && (
            <Message severity="error" text={healthDetail} className="w-full" />
          )}
          {health === 'ok' && dbOk === false && (
            <Message
              severity="warn"
              text={t('home.db_warn')}
              className="w-full mt-2"
            />
          )}
          {getToken() ? (
            <div className="mt-3 pt-3 border-top-1 surface-border">
              {shiftKpiLoading ? (
                <p className="text-sm text-color-secondary m-0">
                  {t('common.loading')}
                </p>
              ) : shiftKpi ? (
                shiftKpi.working_site_id ? (
                  <div className="flex flex-column gap-2">
                    <div className="text-sm line-height-3">
                      <span className="font-medium block sm:inline">
                        {t('home.tac_label')}
                      </span>
                      <span className="sm:ml-2 font-mono text-color-secondary">
                        {t('home.shift_capacity_hours', {
                          hours: shiftKpi.tac_hours.toFixed(2),
                        })}
                      </span>
                    </div>
                    <div className="text-sm line-height-3">
                      <span className="font-medium block sm:inline">
                        {t('home.tach_label')}
                      </span>
                      <span className="sm:ml-2 font-mono text-color-secondary">
                        {t('home.shift_capacity_hours', {
                          hours: shiftKpi.tach_hours.toFixed(2),
                        })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <Message
                    severity="info"
                    className="w-full m-0"
                    text={t('home.shift_capacity_no_site')}
                  />
                )
              ) : null}
            </div>
          ) : null}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
