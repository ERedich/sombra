/**
 * Athene is Kira's sibling assistant dedicated to the pgvector work-order index.
 *
 * Unlike Kira (which runs a copilot turn with tool calls + confirmables), Athene
 * is a RAG endpoint: every prompt is sent to `POST /api/ai/athene/ask`, where
 * the server embeds the query, pulls top-K candidates from pgvector, hands them
 * to GPT and gets back a prose answer plus filtered hits with per-hit reasons.
 * We keep a chat-style transcript so follow-up queries read naturally, but
 * there is no server-side thread — each prompt is an independent RAG call.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from 'primereact/dialog'
import { Toast } from 'primereact/toast'
import { cmmsPaths } from '@sombra/shared'
import { apiJson, ApiError } from '../api'
import { getStoredUser } from '../auth'
import { AtheneAssistantContent } from '../components/ai/AtheneAssistantContent'

export type AtheneOpenOptions = { draft?: string }

export type AtheneBootPayload = { draft: string; resetThread: boolean }

export type AtheneSimilarWorkOrder = {
  id: string
  wo_key: number
  short_text: string
  status: string
  /** Cosine similarity in [0, 1]; 1 = identical. */
  score: number
  /** One-line GPT-generated explanation for why this WO was selected. */
  reason: string
}

export type AtheneChatMessage =
  | {
      role: 'user'
      content: string
      /** Client-only: ms since epoch when the message was added. */
      at: number
    }
  | {
      role: 'assistant'
      /** GPT prose answer (markdown-allowed). */
      content: string
      /** GPT-picked work-order hits, ordered by relevance. */
      results: AtheneSimilarWorkOrder[]
      at: number
    }

type AtheneAskResponse = {
  answer: string
  hits: AtheneSimilarWorkOrder[]
}

type AtheneAssistantContextValue = {
  openAthene: (opts?: AtheneOpenOptions) => void
  closeAthene: () => void
  atheneOpen: boolean
  /** True while /ai/similar-work-orders is in flight. */
  atheneSending: boolean
  /** True when a reply arrived while the modal was closed — shows a dot on the Athene icon. */
  atheneUnreadReplyDot: boolean
  sendAthenePrompt: (text: string) => Promise<void>
}

const AtheneAssistantContext = createContext<AtheneAssistantContextValue | null>(
  null,
)

export function useAtheneAssistant(): AtheneAssistantContextValue {
  const ctx = useContext(AtheneAssistantContext)
  if (!ctx) {
    throw new Error(
      'useAtheneAssistant must be used within AtheneAssistantProvider',
    )
  }
  return ctx
}

export function AtheneAssistantProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [atheneOpen, setAtheneOpen] = useState(false)
  const bootRef = useRef<AtheneBootPayload | null>(null)
  const [messages, setMessages] = useState<AtheneChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [unreadDot, setUnreadDot] = useState(false)
  const sendingRef = useRef(false)
  const messagesRef = useRef(messages)
  const openRef = useRef(atheneOpen)
  const toastRef = useRef<Toast>(null)
  /** Drop stale transcript when the user or working site changes. */
  const threadKeyRef = useRef<string | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    openRef.current = atheneOpen
  }, [atheneOpen])

  const openAthene = useCallback((opts?: AtheneOpenOptions) => {
    const d = opts?.draft?.trim()
    if (d) {
      bootRef.current = { draft: d, resetThread: true }
      setMessages([])
    } else {
      bootRef.current = null
    }
    setAtheneOpen(true)
  }, [])

  const closeAthene = useCallback(() => {
    bootRef.current = null
    setAtheneOpen(false)
  }, [])

  const sendAthenePrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      const siteId = getStoredUser()?.working_site_id
      if (!trimmed || !siteId) return
      if (sendingRef.current) return

      const prior = messagesRef.current
      const now = Date.now()
      const nextMsgs: AtheneChatMessage[] = [
        ...prior,
        { role: 'user', content: trimmed, at: now },
      ]
      setMessages(nextMsgs)
      sendingRef.current = true
      setSending(true)

      try {
        const res = await apiJson<AtheneAskResponse>(
          cmmsPaths.aiAtheneAsk,
          {
            method: 'POST',
            body: JSON.stringify({ query: trimmed }),
          },
        )
        const results = Array.isArray(res?.hits) ? res.hits : []
        const answer =
          typeof res?.answer === 'string' && res.answer.trim()
            ? res.answer.trim()
            : results.length === 0
              ? t('athene.no_matches')
              : t('athene.matches_summary', { count: results.length })
        setMessages([
          ...nextMsgs,
          {
            role: 'assistant',
            content: answer,
            results,
            at: Date.now(),
          },
        ])
        if (!openRef.current) {
          setUnreadDot(true)
          toastRef.current?.show({
            severity: 'success',
            summary: t('athene.response_ready_title'),
            detail: t('athene.response_ready_detail'),
            life: 8000,
          })
        }
      } catch (e) {
        setMessages(prior)
        const msg = e instanceof ApiError ? e.message : String(e)
        if (!openRef.current) {
          toastRef.current?.show({
            severity: 'error',
            summary: t('common.toast_error'),
            detail: msg,
            life: 8000,
          })
        }
        throw e
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [t],
  )

  useEffect(() => {
    if (atheneOpen) setUnreadDot(false)
  }, [atheneOpen])

  useEffect(() => {
    if (!atheneOpen) return
    const u = getStoredUser()
    const key = `${u?.id ?? ''}:${u?.working_site_id ?? ''}`
    if (threadKeyRef.current === null) {
      threadKeyRef.current = key
      return
    }
    if (threadKeyRef.current !== key) {
      setMessages([])
      threadKeyRef.current = key
    }
  }, [atheneOpen])

  const value = useMemo(
    () => ({
      openAthene,
      closeAthene,
      atheneOpen,
      atheneSending: sending,
      atheneUnreadReplyDot: unreadDot,
      sendAthenePrompt,
    }),
    [openAthene, closeAthene, atheneOpen, sending, unreadDot, sendAthenePrompt],
  )

  return (
    <AtheneAssistantContext.Provider value={value}>
      {children}
      <Toast ref={toastRef} position="top-right" />
      <Dialog
        visible={atheneOpen}
        onHide={closeAthene}
        header={t('athene.agent_title')}
        modal
        dismissableMask
        draggable={false}
        className="kira-assistant-dialog"
        style={{ width: '80vw', maxWidth: '80vw' }}
        contentStyle={{
          padding: '0.75rem 1rem 1.25rem',
          maxHeight: 'min(85vh, 900px)',
          overflow: 'auto',
        }}
        appendTo={typeof document !== 'undefined' ? document.body : undefined}
      >
        <AtheneAssistantContent
          visible={atheneOpen}
          bootRef={bootRef}
          messages={messages}
        />
      </Dialog>
    </AtheneAssistantContext.Provider>
  )
}
