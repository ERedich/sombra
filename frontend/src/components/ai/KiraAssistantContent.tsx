/**
 * In-modal assistant: plain prompt card + optional transcript / confirmables.
 * Supports voice input via Web Speech API (DE + EN).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { cmmsPaths } from '@sombra/shared'
import { apiJson, ApiError } from '../../api'
import { getStoredUser } from '../../auth'

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

/* ── Types ───────────────────────────────────────────────────────── */

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type Confirmable =
  | { id: string; type: 'create_work_order'; payload: Record<string, unknown> }
  | { id: string; type: 'create_asset'; payload: Record<string, unknown> }

type CopilotTurnResult = {
  message: { role: 'assistant'; content: string }
  confirmable: Confirmable[]
}

type Row =
  | { kind: 'msg'; role: 'user' | 'assistant'; content: string }
  | { kind: 'confirm'; item: Confirmable }

export function KiraAssistantContent() {
  const { t } = useTranslation()
  const toast = useRef<Toast>(null)
  const user = getStoredUser()
  const siteId = user?.working_site_id ?? null
  const locale = user?.locale ?? 'en'

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<Confirmable[]>([])
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

  const rows: Row[] = useMemo(() => {
    const r: Row[] = messages.map((m) => ({
      kind: 'msg' as const,
      role: m.role,
      content: m.content,
    }))
    for (const item of pending) {
      r.push({ kind: 'confirm', item })
    }
    return r
  }, [messages, pending])

  const hasConversation = rows.length > 0

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
    const nextMsgs: ChatMessage[] = [...prior, { role: 'user', content: text }]
    setMessages(nextMsgs)
    setInput('')
    setSending(true)
    try {
      const res = await apiJson<CopilotTurnResult>(cmmsPaths.aiCopilotTurn, {
        method: 'POST',
        body: JSON.stringify({ messages: nextMsgs }),
      })
      setMessages([...nextMsgs, res.message])
      setPending(res.confirmable)
    } catch (e) {
      setMessages(prior)
      setInput(text)
      const msg = e instanceof ApiError ? e.message : String(e)
      showError(msg)
    } finally {
      setSending(false)
    }
  }, [input, siteId, sending, messages, showError])

  const onConfirm = useCallback(
    async (item: Confirmable) => {
      try {
        if (item.type === 'create_work_order') {
          await apiJson(cmmsPaths.workOrders, {
            method: 'POST',
            body: JSON.stringify(item.payload),
          })
          showSuccess(t('copilot.created_wo'))
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
                'border-1 surface-border border-round-md shadow-none overflow-hidden',
            },
            body: { className: 'p-0' },
            content: { className: 'p-3 md:p-4 flex flex-column gap-3' },
          }}
        >
          <InputTextarea
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
                className:
                  'border-1 surface-border border-round-md shadow-none',
              },
              body: { className: 'p-0' },
              content: {
                className:
                  'p-3 md:p-4 max-h-[min(35vh,320px)] overflow-y-auto flex flex-column gap-3',
              },
            }}
          >
            <div className="text-xs text-color-secondary uppercase font-semibold">
              {t('kira.conversation_label')}
            </div>
            {rows.map((row, i) =>
              row.kind === 'msg' ? (
                <div key={`m-${i}`} className="text-sm line-height-3">
                  <span className="text-color-secondary font-medium">
                    {row.role === 'user' ?
                      `${t('kira.label_you')}: `
                    : `${t('kira.label_kira')}: `}
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{row.content}</span>
                </div>
              ) : (
                <div
                  key={row.item.id}
                  className="border-top-1 surface-border pt-3 flex flex-column gap-2"
                >
                  <div className="font-semibold text-sm">
                    {row.item.type === 'create_work_order'
                      ? t('copilot.confirm_wo')
                      : t('copilot.confirm_asset')}
                  </div>
                  <pre className="text-xs overflow-auto max-h-8rem surface-ground border-round p-2 m-0 border-1 surface-border">
                    {JSON.stringify(row.item.payload, null, 2)}
                  </pre>
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
                          : t('copilot.confirm_asset')
                      }
                      size="small"
                      disabled={aiConfigured === false}
                      onClick={() => void onConfirm(row.item)}
                    />
                  </div>
                </div>
              ),
            )}
          </Card>
        ) : null}
      </Card>
    </div>
  )
}
