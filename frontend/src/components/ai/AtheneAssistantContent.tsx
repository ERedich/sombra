/**
 * Athene in-modal UI: prompt card (with voice input) + RAG transcript.
 *
 * Each assistant turn renders a GPT-authored markdown answer (via KiraRichMessage)
 * plus the GPT-selected hits from the pgvector index. Each hit shows its GPT
 * reason line so the user can tell at a glance why that WO was picked. Voice
 * input reuses the Kira Web Speech API helpers verbatim for UX parity.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { cmmsPaths } from '@sombra/shared'
import { apiJson, ApiError } from '../../api'
import { getStoredUser } from '../../auth'
import type {
  AtheneBootPayload,
  AtheneChatMessage,
  AtheneSimilarWorkOrder,
} from '../../layout/AtheneAssistantProvider'
import { useAtheneAssistant } from '../../layout/AtheneAssistantProvider'
import { KiraRichMessage } from './KiraRichMessage'

import './KiraAssistantChat.css'

function formatAtheneChatTime(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString()
  }
}

/* ── Web Speech API (mirrors KiraAssistantContent) ───────────────────── */

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

type Row =
  | {
      kind: 'user'
      content: string
      at: number
    }
  | {
      kind: 'assistant'
      content: string
      results: AtheneSimilarWorkOrder[]
      at: number
    }
  | { kind: 'thinking' }

export function AtheneAssistantContent({
  visible,
  bootRef,
  messages,
}: {
  visible: boolean
  bootRef: MutableRefObject<AtheneBootPayload | null>
  messages: AtheneChatMessage[]
}) {
  const { t } = useTranslation()
  const { atheneSending, sendAthenePrompt } = useAtheneAssistant()
  const toast = useRef<Toast>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const convScrollRef = useRef<HTMLDivElement>(null)
  const user = getStoredUser()
  const siteId = user?.working_site_id ?? null
  const locale = user?.locale ?? 'en'

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [input, setInput] = useState('')

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
      } catch {
        /* ignore */
      }
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

  /** Optional "thinking" row, then messages newest-first (matches Kira). */
  const displayRows: Row[] = useMemo(() => {
    const msgRows: Row[] = messages.map((m) =>
      m.role === 'user'
        ? { kind: 'user' as const, content: m.content, at: m.at }
        : {
            kind: 'assistant' as const,
            content: m.content,
            results: m.results,
            at: m.at,
          },
    )
    const rev = [...msgRows].reverse()
    const thinking: Row[] = atheneSending ? [{ kind: 'thinking' as const }] : []
    return [...thinking, ...rev]
  }, [messages, atheneSending])

  const hasConversation = displayRows.length > 0

  useLayoutEffect(() => {
    if (!hasConversation || !convScrollRef.current) return
    convScrollRef.current.scrollTop = 0
  }, [hasConversation, messages.length, atheneSending])

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
    } catch {
      /* ignore */
    }
    recRef.current = null
    setListening(false)
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !siteId || atheneSending) return
    setInput('')
    try {
      await sendAthenePrompt(text)
    } catch (e) {
      setInput(text)
      if (visible) {
        const msg = e instanceof ApiError ? e.message : String(e)
        showError(msg)
      }
    }
  }, [input, siteId, atheneSending, sendAthenePrompt, visible, showError])

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
          <div className="text-sm text-color-secondary">
            {t('athene.subtitle')}
          </div>
          <InputTextarea
            ref={promptRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            className="w-full m-0"
            placeholder={t('athene.placeholder')}
            disabled={!siteId || atheneSending || aiConfigured === false}
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
                  disabled={
                    !speechAvailable ||
                    !siteId ||
                    atheneSending ||
                    aiConfigured === false
                  }
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
              label={
                atheneSending ? t('athene.searching') : t('athene.search')
              }
              icon="pi pi-search"
              disabled={
                atheneSending ||
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
              content: { className: 'p-0' },
            }}
          >
            <div
              ref={convScrollRef}
              className="kira-chat-scroll p-3 md:p-4 max-h-[min(35vh,320px)] overflow-y-auto flex flex-column gap-2"
            >
              <div className="text-xs text-color-secondary uppercase font-semibold mb-2">
                {t('kira.conversation_label')}
              </div>
              {displayRows.map((row, i) => {
                if (row.kind === 'thinking') {
                  return (
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
                        {t('athene.searching')}
                      </span>
                    </div>
                  )
                }
                if (row.kind === 'user') {
                  return (
                    <div
                      key={`u-${i}-${row.at}`}
                      className="kira-chat-row kira-chat-row--user text-sm line-height-3"
                    >
                      <div className="kira-chat-row__header flex justify-content-between align-items-start gap-2">
                        <span className="kira-chat-row__label">
                          {t('kira.label_you')}
                        </span>
                        <span className="kira-chat-row__time">
                          {formatAtheneChatTime(row.at, locale)}
                        </span>
                      </div>
                      <div className="white-space-pre-wrap">{row.content}</div>
                    </div>
                  )
                }
                return (
                  <div
                    key={`a-${i}-${row.at}`}
                    className="kira-chat-row kira-chat-row--assistant text-sm line-height-3"
                  >
                    <div className="kira-chat-row__header flex justify-content-between align-items-start gap-2">
                      <span className="kira-chat-row__label">
                        {t('athene.label_athene')}
                      </span>
                      <span className="kira-chat-row__time">
                        {formatAtheneChatTime(row.at, locale)}
                      </span>
                    </div>
                    {row.content ? (
                      <div className="mb-2">
                        <KiraRichMessage content={row.content} />
                      </div>
                    ) : null}
                    {row.results.length > 0 ? (
                      <ul className="list-none p-0 m-0 flex flex-column gap-2">
                        {row.results.map((r) => (
                          <li
                            key={r.id}
                            className="surface-ground border-round p-2 flex flex-column gap-1"
                          >
                            <div className="flex justify-content-between align-items-start gap-2">
                              <div className="flex flex-column min-w-0">
                                <span className="font-semibold text-color">
                                  #{r.wo_key} — {r.short_text}
                                </span>
                                <span className="text-xs text-color-secondary">
                                  {t('athene.status_label')}: {r.status}
                                </span>
                                {r.reason ? (
                                  <span className="text-xs text-color-secondary font-italic mt-1">
                                    {t('athene.reason_label')}: {r.reason}
                                  </span>
                                ) : null}
                              </div>
                              <span
                                className="text-xs font-semibold text-color-secondary flex-shrink-0"
                                title={t('athene.score_tooltip')}
                              >
                                {Math.round(r.score * 100)}%
                              </span>
                            </div>
                            <div>
                              <Link
                                to={`/work-orders?workOrderId=${encodeURIComponent(r.id)}`}
                                className="text-sm"
                              >
                                {t('kira.link_open_work_order')}
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        ) : null}
      </Card>
    </div>
  )
}
