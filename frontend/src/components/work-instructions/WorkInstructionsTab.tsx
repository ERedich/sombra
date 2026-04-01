/**
 * Work instructions editor for work order / work plan dialogs.
 * With parent id: persists lines via API (POST/PATCH/DELETE). Without: local-only for create + POST body.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { Button } from 'primereact/button'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { ApiError, apiJson } from '../../api'

export type FormWorkInstruction = {
  clientKey: string
  serverId?: string
  sort_nr: number
  instruction_text: string
  done: boolean
}

type WorkInstructionDto = {
  id: string
  sort_nr: number
  instruction_text: string
  done: boolean
}

type Props = {
  variant: 'wo' | 'wp'
  parentId: string | null
  rows: FormWorkInstruction[]
  setRows: Dispatch<SetStateAction<FormWorkInstruction[]>>
  disabled: boolean
  reportError: (msg: string) => void
  t: TFunction
}

export function WorkInstructionsTab({
  variant,
  parentId,
  rows,
  setRows,
  disabled,
  reportError,
  t,
}: Props) {
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const apiBase =
    variant === 'wo' ? '/api/work-orders' : '/api/work-plans'

  async function persistNewRow(clientKey: string) {
    if (!parentId) return
    const row = rowsRef.current.find((r) => r.clientKey === clientKey)
    if (!row || row.serverId) return
    const text = row.instruction_text.trim()
    if (!text) return
    try {
      const data = await apiJson<{ work_instruction: WorkInstructionDto }>(
        `${apiBase}/${parentId}/work-instructions`,
        {
          method: 'POST',
          body: JSON.stringify({
            sort_nr: row.sort_nr,
            instruction_text: text,
          }),
        },
      )
      const wi = data.work_instruction
      setRows((prev) =>
        prev.map((r) =>
          r.clientKey === clientKey
            ? {
                clientKey: clientKey,
                serverId: wi.id,
                sort_nr: wi.sort_nr,
                instruction_text: wi.instruction_text,
                done: wi.done,
              }
            : r,
        ),
      )
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wo.save_fail'))
    }
  }

  async function patchRow(
    clientKey: string,
    patch: Partial<
      Pick<FormWorkInstruction, 'sort_nr' | 'instruction_text' | 'done'>
    >,
  ) {
    if (!parentId) return
    const row = rowsRef.current.find((r) => r.clientKey === clientKey)
    if (!row?.serverId) return
    try {
      const data = await apiJson<{ work_instruction: WorkInstructionDto }>(
        `${apiBase}/${parentId}/work-instructions/${row.serverId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      )
      const wi = data.work_instruction
      setRows((prev) =>
        prev.map((r) =>
          r.clientKey === clientKey
            ? {
                ...r,
                sort_nr: wi.sort_nr,
                instruction_text: wi.instruction_text,
                done: wi.done,
              }
            : r,
        ),
      )
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wo.save_fail'))
    }
  }

  async function removeRow(clientKey: string) {
    const row = rowsRef.current.find((r) => r.clientKey === clientKey)
    if (!parentId || !row?.serverId) {
      setRows((prev) => prev.filter((r) => r.clientKey !== clientKey))
      return
    }
    try {
      await apiJson(
        `${apiBase}/${parentId}/work-instructions/${row.serverId}`,
        {
          method: 'DELETE',
        },
      )
      setRows((prev) => prev.filter((r) => r.clientKey !== clientKey))
    } catch (e) {
      if (e instanceof ApiError) reportError(e.message)
      else reportError(t('wo.save_fail'))
    }
  }

  function addRow() {
    setRows((prev) => {
      const maxNr = prev.reduce((m, r) => Math.max(m, r.sort_nr), 0)
      return [
        ...prev,
        {
          clientKey: crypto.randomUUID(),
          sort_nr: maxNr + 1,
          instruction_text: '',
          done: false,
        },
      ]
    })
  }

  return (
    <div className="app-modal-tab-content flex flex-column gap-3 pt-2">
      <div className="flex justify-content-end">
        <Button
          type="button"
          icon="pi pi-plus"
          label={t('wi.add')}
          outlined
          disabled={disabled}
          onClick={addRow}
        />
      </div>
      {rows.length === 0 ? (
        <span className="text-sm text-color-secondary">{t('wi.add')}</span>
      ) : (
        <div className="flex flex-column gap-3">
          {rows.map((row) => (
            <div
              key={row.clientKey}
              className="flex flex-column md:flex-row gap-2 md:align-items-end"
            >
              <div className="flex flex-column gap-2" style={{ width: '6rem' }}>
                <label className="text-sm font-medium">{t('wi.col_nr')}</label>
                <InputNumber
                  value={row.sort_nr}
                  onValueChange={(e) => {
                    const v = e.value
                    const n =
                      typeof v === 'number' && Number.isInteger(v) ? v : row.sort_nr
                    setRows((prev) =>
                      prev.map((r) =>
                        r.clientKey === row.clientKey ? { ...r, sort_nr: n } : r,
                      ),
                    )
                    if (row.serverId) void patchRow(row.clientKey, { sort_nr: n })
                  }}
                  disabled={disabled}
                  className="w-full"
                  inputClassName="w-full min-w-0"
                  useGrouping={false}
                />
              </div>
              <div className="flex flex-column gap-2 flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t('wi.col_instruction')}
                </label>
                <InputText
                  value={row.instruction_text}
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 200)
                    setRows((prev) =>
                      prev.map((r) =>
                        r.clientKey === row.clientKey
                          ? { ...r, instruction_text: v }
                          : r,
                      ),
                    )
                  }}
                  onBlur={() => {
                    const r = rowsRef.current.find((x) => x.clientKey === row.clientKey)
                    if (!r) return
                    if (parentId && !r.serverId) {
                      void persistNewRow(row.clientKey)
                      return
                    }
                    if (parentId && r.serverId) {
                      const text = r.instruction_text.trim()
                      if (!text) {
                        reportError(t('wi.err_instruction_empty'))
                        return
                      }
                      void patchRow(row.clientKey, { instruction_text: text })
                    }
                  }}
                  disabled={disabled}
                  maxLength={200}
                  className="w-full"
                />
              </div>
              <div className="flex align-items-end pb-0 md:pb-0">
                <Button
                  type="button"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  disabled={disabled}
                  onClick={() => void removeRow(row.clientKey)}
                  aria-label={t('wi.remove')}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Map API work instructions to form rows (stable clientKey = server id). */
export function workInstructionsFromApi(
  list: {
    id: string
    sort_nr: number
    instruction_text: string
    done: boolean
  }[],
): FormWorkInstruction[] {
  return list.map((wi) => ({
    clientKey: wi.id,
    serverId: wi.id,
    sort_nr: wi.sort_nr,
    instruction_text: wi.instruction_text,
    done: wi.done,
  }))
}

/** Payload for POST create parent entity. */
export function workInstructionsForCreateBody(
  rows: FormWorkInstruction[],
): { sort_nr: number; instruction_text: string }[] {
  return rows
    .filter((r) => r.instruction_text.trim().length > 0)
    .map((r) => ({
      sort_nr: r.sort_nr,
      instruction_text: r.instruction_text.trim(),
    }))
}
