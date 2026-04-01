/**
 * Read-only instruction list from table row; work orders get Done toggles (PATCH).
 */
import { useCallback, useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { Checkbox } from 'primereact/checkbox'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { ApiError, apiJson } from '../../api'

export type ViewInstructionRow = {
  id: string
  sort_nr: number
  instruction_text: string
  done: boolean
}

type WoDetail = {
  work_order: { work_instructions?: ViewInstructionRow[] }
}
type WpDetail = {
  work_plan: { work_instructions?: ViewInstructionRow[] }
}

export function WorkInstructionViewModal({
  visible,
  onHide,
  mode,
  entityId,
  t,
  reportError,
  onAfterInstructionsChange,
}: {
  visible: boolean
  onHide: () => void
  mode: 'wo' | 'wp'
  entityId: string | null
  t: TFunction
  reportError: (msg: string) => void
  /** Called after done state changes (work orders) so list counts can refresh. */
  onAfterInstructionsChange?: () => void
}) {
  const [rows, setRows] = useState<ViewInstructionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [savingAll, setSavingAll] = useState(false)

  const load = useCallback(async () => {
    if (!entityId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      if (mode === 'wo') {
        const data = await apiJson<WoDetail>(
          `/api/work-orders/${encodeURIComponent(entityId)}`,
        )
        setRows(data.work_order.work_instructions ?? [])
      } else {
        const data = await apiJson<WpDetail>(
          `/api/work-plans/${encodeURIComponent(entityId)}`,
        )
        setRows(data.work_plan.work_instructions ?? [])
      }
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wi.view_load_fail'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [entityId, mode, reportError, t])

  useEffect(() => {
    if (visible && entityId) void load()
    if (!visible) setRows([])
  }, [visible, entityId, load])

  async function patchDone(
    row: ViewInstructionRow,
    checked: boolean,
  ): Promise<ViewInstructionRow | undefined> {
    if (mode !== 'wo' || !entityId) return undefined
    const data = await apiJson<{ work_instruction: ViewInstructionRow }>(
      `/api/work-orders/${encodeURIComponent(entityId)}/work-instructions/${encodeURIComponent(row.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ done: checked }),
      },
    )
    return data.work_instruction
  }

  async function toggleDone(row: ViewInstructionRow, checked: boolean) {
    if (mode !== 'wo' || !entityId) return
    try {
      const wi = await patchDone(row, checked)
      if (!wi) return
      setRows((prev) =>
        prev.map((r) => (r.id === wi.id ? { ...r, ...wi } : r)),
      )
      onAfterInstructionsChange?.()
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wi.view_patch_fail'))
    }
  }

  const allDone =
    rows.length > 0 && rows.every((r) => r.done)

  async function setAllDone(checked: boolean) {
    if (mode !== 'wo' || !entityId || rows.length === 0) return
    const need = rows.filter((r) => r.done !== checked)
    if (need.length === 0) return
    setSavingAll(true)
    try {
      await Promise.all(
        need.map((r) => patchDone(r, checked)),
      )
      setRows((prev) => prev.map((r) => ({ ...r, done: checked })))
      onAfterInstructionsChange?.()
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wi.view_patch_fail'))
    } finally {
      setSavingAll(false)
    }
  }

  const showDoneCol = mode === 'wo'

  return (
    <Dialog
      header={t('wi.view_title')}
      visible={visible}
      onHide={onHide}
      dismissableMask
      className="work-instruction-view-dialog"
      style={{ width: 'min(42rem, 96vw)' }}
      breakpoints={{ '640px': '98vw' }}
    >
      {showDoneCol && rows.length > 0 ? (
        <div className="flex align-items-center gap-2 mb-3">
          <Checkbox
            inputId="wi-view-all-done"
            checked={allDone}
            disabled={loading || savingAll}
            onChange={(e) => void setAllDone(!!e.checked)}
          />
          <label htmlFor="wi-view-all-done" className="text-sm cursor-pointer">
            {t('wi.view_all_done')}
          </label>
        </div>
      ) : null}
      <DataTable
        value={rows}
        loading={loading || savingAll}
        dataKey="id"
        size="small"
        stripedRows
        emptyMessage={t('wi.view_empty')}
        rowClassName={(data) => {
          const r = data as ViewInstructionRow
          return mode === 'wo' && r.done ? 'wi-view-row-done' : ''
        }}
      >
        <Column
          field="sort_nr"
          header={t('wi.col_nr')}
          style={{ width: '5rem' }}
        />
        <Column
          field="instruction_text"
          header={t('wi.col_instruction')}
          body={(r: ViewInstructionRow) => (
            <span className="text-sm">{r.instruction_text}</span>
          )}
        />
        {showDoneCol ? (
          <Column
            header={t('wi.col_done')}
            style={{ width: '7rem' }}
            body={(r: ViewInstructionRow) => (
              <Checkbox
                inputId={`wi-view-done-${r.id}`}
                checked={r.done}
                disabled={savingAll}
                onChange={(e) => void toggleDone(r, !!e.checked)}
              />
            )}
          />
        ) : null}
      </DataTable>
    </Dialog>
  )
}
