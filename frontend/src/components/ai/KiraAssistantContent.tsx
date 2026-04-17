/**
 * In-modal assistant: plain prompt card + optional transcript / confirmables.
 * Supports voice input via Web Speech API (DE + EN).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import type { ClientAction } from '@sombra/shared'
import { buildWebPath, cmmsPaths } from '@sombra/shared'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiJson, ApiError } from '../../api'
import { getStoredUser } from '../../auth'
import type {
  KiraBootPayload,
  KiraChatMessage,
  KiraConfirmable,
} from '../../layout/KiraAssistantProvider'
import { useKiraAssistant } from '../../layout/KiraAssistantProvider'
import { KiraRichMessage } from './KiraRichMessage'

import './KiraAssistantChat.css'

function formatKiraChatTime(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString()
  }
}

/* ── Web Speech API (Chrome, Edge, Safari) ───────────────────────── */

type SpeechRecCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: Event) => void) | null
  onerror: ((ev: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): SpeechRecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor
    webkitSpeechRecognition?: SpeechRecCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function sttLangTag(locale: string): string {
  const lc = (locale || 'en').toLowerCase()
  if (lc === 'de' || lc.startsWith('de-')) return 'de-DE'
  return 'en-US'
}

function searchParamsNormalizedEqual(a: string, b: string): boolean {
  const na = a.startsWith('?') ? a.slice(1) : a
  const nb = b.startsWith('?') ? b.slice(1) : b
  const pa = new URLSearchParams(na)
  const pb = new URLSearchParams(nb)
  if (pa.toString() === pb.toString()) return true
  const sa = [...pa.entries()].sort(([x], [y]) => x.localeCompare(y))
  const sb = [...pb.entries()].sort(([x], [y]) => x.localeCompare(y))
  return (
    sa.length === sb.length &&
    sa.every(([k, v], i) => k === sb[i]?.[0] && v === sb[i]?.[1])
  )
}

function applyKiraClientActions(
  actions: ClientAction[] | undefined,
  opts: {
    navigate: ReturnType<typeof useNavigate>
    location: ReturnType<typeof useLocation>
    openKira: () => void
    closeKira: () => void
  },
) {
  if (!actions?.length) return
  for (const action of actions) {
    if (action.type === 'shell' && action.action === 'open_kira') {
      opts.openKira()
      continue
    }
    if (action.type === 'navigate') {
      const { pathname, search } = buildWebPath(action.app, action.entityId)
      const samePath = opts.location.pathname === pathname
      const sameSearch = searchParamsNormalizedEqual(
        opts.location.search,
        search,
      )
      if (!samePath || !sameSearch) {
        opts.navigate({ pathname, search })
      }
      if (action.closeKira === true) opts.closeKira()
    }
  }
}

/* ── Types ───────────────────────────────────────────────────────── */

type CopilotTurnResult = {
  message: { role: 'assistant'; content: string }
  confirmable: KiraConfirmable[]
  client_actions?: ClientAction[]
}

type Row =
  | { kind: 'msg'; role: 'user' | 'assistant'; content: string; at: number }
  | { kind: 'confirm'; item: KiraConfirmable }
  | { kind: 'thinking' }

export function KiraAssistantContent({
  visible,
  bootRef,
  messages,
  setMessages,
  pending,
  setPending,
}: {
  visible: boolean
  bootRef: MutableRefObject<KiraBootPayload | null>
  messages: KiraChatMessage[]
  setMessages: Dispatch<SetStateAction<KiraChatMessage[]>>
  pending: KiraConfirmable[]
  setPending: Dispatch<SetStateAction<KiraConfirmable[]>>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { openKira, closeKira } = useKiraAssistant()
  const toast = useRef<Toast>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const convScrollRef = useRef<HTMLDivElement>(null)
  const user = getStoredUser()
  const siteId = user?.working_site_id ?? null
  const locale = user?.locale ?? 'en'

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  /* ── Speech recognition ─────────────────────────────────────── */
  const [listening, setListening] = useState(false)
  const [speechAvailable, setSpeechAvailable] = useState(false)
  const recRef = useRef<InstanceType<SpeechRecCtor> | null>(null)

  useEffect(() => {
    setSpeechAvailable(getSpeechRecognition() != null)
  }, [])

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop()
      } catch { /* ignore */ }
      recRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!visible) return
    const boot = bootRef.current
    if (boot) {
      setInput(boot.draft)
    }
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      const el = promptRef.current
      if (el) {
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    })
  }, [visible, bootRef])

  /** Confirmables first, optional “thinking”, then messages newest-first. */
  const displayRows: Row[] = useMemo(() => {
    const msgRows: Row[] = messages.map((m) => ({
      kind: 'msg' as const,
      role: m.role,
      content: m.content,
      at: m.at,
    }))
    const rev = [...msgRows].reverse()
    const conf: Row[] = pending.map((item) => ({
      kind: 'confirm' as const,
      item,
    }))
    const thinking: Row[] = sending ? [{ kind: 'thinking' as const }] : []
    return [...conf, ...thinking, ...rev]
  }, [messages, pending, sending])

  const hasConversation = displayRows.length > 0

  useLayoutEffect(() => {
    if (!hasConversation || !convScrollRef.current) return
    convScrollRef.current.scrollTop = 0
  }, [hasConversation, messages.length, pending.length, sending])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await apiJson<{ configured: boolean }>(cmmsPaths.aiStatus)
        if (!cancelled) setAiConfigured(s.configured)
      } catch {
        if (!cancelled) setAiConfigured(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
        life: 2500,
      })
    },
    [t],
  )

  const startListen = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      showError(t('kira.stt_unsupported'))
      return
    }
    const r = new Ctor()
    r.lang = sttLangTag(locale)
    r.continuous = true
    r.interimResults = true
    r.onresult = (ev: Event) => {
      const e = ev as unknown as {
        results: {
          length: number
          [i: number]: { 0: { transcript: string } }
        }
      }
      let text = ''
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? ''
      }
      setInput(text.trim())
    }
    r.onerror = () => setListening(false)
    r.onend = () => setListening(false)
    recRef.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      showError(t('kira.stt_unsupported'))
    }
  }, [locale, showError, t])

  const stopListen = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch { /* ignore */ }
    recRef.current = null
    setListening(false)
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !siteId || sending) return
    const prior = messages
    const now = Date.now()
    const nextMsgs: KiraChatMessage[] = [
      ...prior,
      { role: 'user', content: text, at: now },
    ]
    setMessages(nextMsgs)
    setInput('')
    setSending(true)
    try {
      const res = await apiJson<CopilotTurnResult>(cmmsPaths.aiCopilotTurn, {
        method: 'POST',
        body: JSON.stringify({
          messages: nextMsgs.map(({ role, content }) => ({ role, content })),
        }),
      })
      setMessages([
        ...nextMsgs,
        { ...res.message, at: Date.now() },
      ])
      setPending(res.confirmable)
      applyKiraClientActions(res.client_actions, {
        navigate,
        location,
        openKira,
        closeKira,
      })
    } catch (e) {
      setMessages(prior)
      setInput(text)
      const msg = e instanceof ApiError ? e.message : String(e)
      showError(msg)
    } finally {
      setSending(false)
    }
  }, [
    input,
    siteId,
    sending,
    messages,
    showError,
    navigate,
    location,
    openKira,
    closeKira,
  ])

  const onConfirm = useCallback(
    async (item: KiraConfirmable) => {
      try {
        if (item.type === 'create_work_order') {
          await apiJson(cmmsPaths.workOrders, {
            method: 'POST',
            body: JSON.stringify(item.payload),
          })
          showSuccess(t('copilot.created_wo'))
        } else if (item.type === 'create_work_plan') {
          await apiJson(cmmsPaths.workPlans, {
            method: 'POST',
            body: JSON.stringify(item.payload),
          })
          showSuccess(t('copilot.created_wp'))
        } else if (item.type === 'update_work_order') {
          await apiJson(cmmsPaths.workOrder(item.work_order_id), {
            method: 'PATCH',
            body: JSON.stringify(item.payload),
          })
          showSuccess(t('copilot.updated_wo'))
        } else {
          await apiJson(cmmsPaths.assets, {
            method: 'POST',
            body: JSON.stringify(item.payload),
          })
          showSuccess(t('copilot.created_asset'))
        }
        setPending((p) => p.filter((x) => x.id !== item.id))
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : String(e)
        showError(msg)
      }
    },
    [showError, showSuccess, t],
  )

  return (
    <div className="flex flex-column gap-3 w-full">
      <Toast ref={toast} position="top-right" />
      {!siteId ? (
        <Message
          severity="warn"
          text={t('copilot.no_site')}
          className="w-full"
        />
      ) : null}
      {aiConfigured === false ? (
        <Message
          severity="warn"
          text={t('copilot.not_configured')}
          className="w-full"
        />
      ) : null}

      <Card
        className="m-0 shadow-none border-none"
        pt={{
          root: { className: 'border-none shadow-none bg-transparent' },
          body: { className: 'p-0' },
          content: { className: 'p-0 flex flex-column gap-3' },
        }}
      >
        <Card
          className="m-0 shadow-none"
          pt={{
            root: {
              className:
                'border-none shadow-none surface-ground border-round-md overflow-hidden',
            },
            body: { className: 'p-0' },
            content: { className: 'p-3 md:p-4 flex flex-column gap-3' },
          }}
        >
          <InputTextarea
            ref={promptRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            className="w-full m-0"
            placeholder={t('copilot.placeholder')}
            disabled={!siteId || sending || aiConfigured === false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="flex justify-content-between align-items-center">
            <div className="flex align-items-center gap-2">
              {!listening ? (
                <Button
                  type="button"
                  icon="pi pi-microphone"
                  label={t('kira.listen')}
                  severity="secondary"
                  outlined
                  disabled={!speechAvailable || !siteId || sending || aiConfigured === false}
                  onClick={startListen}
                />
              ) : (
                <Button
                  type="button"
                  icon="pi pi-stop-circle"
                  label={t('kira.stop')}
                  severity="danger"
                  outlined
                  onClick={stopListen}
                />
              )}
              {!speechAvailable ? (
                <span className="text-xs text-color-secondary">
                  {t('kira.stt_unsupported')}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              label={sending ? t('copilot.sending') : t('copilot.send')}
              icon="pi pi-send"
              disabled={
                sending ||
                !input.trim() ||
                !siteId ||
                aiConfigured === false
              }
              onClick={() => void send()}
            />
          </div>
        </Card>

        {hasConversation ? (
          <Card
            className="m-0 shadow-none"
            pt={{
              root: {
                className: 'border-none shadow-none bg-transparent',
              },
              body: { className: 'p-0' },
              content: {
                className: 'p-0',
              },
            }}
          >
            <div
              ref={convScrollRef}
              className="kira-chat-scroll p-3 md:p-4 max-h-[min(35vh,320px)] overflow-y-auto flex flex-column gap-2"
            >
              <div className="text-xs text-color-secondary uppercase font-semibold mb-2">
                {t('kira.conversation_label')}
              </div>
              {displayRows.map((row, i) =>
                row.kind === 'msg' ? (
                  <div
                    key={`m-${i}-${row.at}`}
                    className={
                      row.role === 'user' ?
                        'kira-chat-row kira-chat-row--user text-sm line-height-3'
                      : 'kira-chat-row kira-chat-row--assistant text-sm line-height-3'
                    }
                  >
                    <div className="kira-chat-row__header flex justify-content-between align-items-start gap-2">
                      <span className="kira-chat-row__label">
                        {row.role === 'user' ?
                          t('kira.label_you')
                        : t('kira.label_kira')}
                      </span>
                      <span className="kira-chat-row__time">
                        {formatKiraChatTime(row.at, locale)}
                      </span>
                    </div>
                    <KiraRichMessage content={row.content} />
                  </div>
                ) : row.kind === 'thinking' ? (
                  <div
                    key="thinking"
                    className="kira-chat-row kira-chat-row--assistant kira-chat-thinking"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="kira-thinking-bounce" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="text-sm text-color-secondary font-medium">
                      {t('kira.thinking')}
                    </span>
                  </div>
                ) : (
                <div
                  key={row.item.id}
                  className="flex flex-column gap-2"
                >
                  <div className="font-semibold text-sm">
                    {row.item.type === 'create_work_order'
                      ? t('copilot.confirm_wo')
                      : row.item.type === 'create_work_plan'
                        ? t('copilot.confirm_wp')
                        : row.item.type === 'update_work_order'
                          ? t('copilot.confirm_wo_update', {
                              wo_key: row.item.wo_key,
                              short_text: row.item.summary.short_text,
                            })
                          : t('copilot.confirm_asset')}
                  </div>
                  {row.item.type === 'update_work_order' ? (
                    <div className="flex flex-column gap-1 text-xs surface-ground border-round p-2">
                      {Object.entries(row.item.summary.changes).map(
                        ([field, { before, after }]) => (
                          <div key={field} className="flex flex-wrap gap-2">
                            <span className="font-semibold">{field}:</span>
                            <span className="text-color-secondary line-through">
                              {before === null || before === undefined
                                ? '—'
                                : String(before)}
                            </span>
                            <span>→</span>
                            <span>
                              {after === null || after === undefined
                                ? '—'
                                : String(after)}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <pre className="text-xs overflow-auto max-h-8rem surface-ground border-round p-2 m-0">
                      {JSON.stringify(row.item.payload, null, 2)}
                    </pre>
                  )}
                  <div className="flex gap-2 flex-wrap justify-content-end">
                    <Button
                      type="button"
                      label={t('copilot.discard')}
                      severity="secondary"
                      outlined
                      size="small"
                      onClick={() =>
                        setPending((p) =>
                          p.filter((x) => x.id !== row.item.id),
                        )
                      }
                    />
                    <Button
                      type="button"
                      label={
                        row.item.type === 'create_work_order'
                          ? t('copilot.confirm_wo')
                          : row.item.type === 'create_work_plan'
                            ? t('copilot.confirm_wp')
                            : row.item.type === 'update_work_order'
                              ? t('copilot.confirm_wo_update_btn')
                              : t('copilot.confirm_asset')
                      }
                      size="small"
                      disabled={aiConfigured === false}
                      onClick={() => void onConfirm(row.item)}
                    />
                  </div>
                </div>
                )
              )}
            </div>
          </Card>
        ) : null}
      </Card>
    </div>
  )
}
