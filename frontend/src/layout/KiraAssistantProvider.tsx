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
import { useLocation, useNavigate } from 'react-router-dom'
import type { ClientAction } from '@sombra/shared'
import { cmmsPaths } from '@sombra/shared'
import { apiJson, ApiError } from '../api'
import { getStoredUser } from '../auth'
import { KiraAssistantContent } from '../components/ai/KiraAssistantContent'
import { applyKiraClientActions } from './kiraClientActions'

export type KiraOpenOptions = { draft?: string }

export type KiraBootPayload = { draft: string; resetThread: boolean }

export type KiraChatMessage = {
  role: 'user' | 'assistant'
  content: string
  /** Client-only: ms since epoch when the message was added (not sent to API). */
  at: number
}

export type KiraConfirmable =
  | { id: string; type: 'create_work_order'; payload: Record<string, unknown> }
  | { id: string; type: 'create_work_plan'; payload: Record<string, unknown> }
  | { id: string; type: 'create_asset'; payload: Record<string, unknown> }
  | {
      id: string
      type: 'update_work_order'
      work_order_id: string
      wo_key: number
      payload: Record<string, unknown>
      summary: {
        short_text: string
        changes: Record<
          string,
          { before: unknown; after: unknown }
        >
      }
    }
  | {
      id: string
      type: 'capacity_allocation'
      work_order_id: string
      wo_key: number
      short_text: string
      payload: {
        employee_id: string
        allocation_date: string
        planned_hours: number
      }
      summary: {
        employee_key: string
        employee_name: string
        allocation_date: string
        planned_hours: number
        action: 'set' | 'clear'
      }
    }
  | {
      id: string
      type: 'create_shift_assignment'
      payload: {
        shift_id: string
        employee_id: string
        assignment_date: string
      }
      summary: {
        shift_key: string
        shift_name: string
        time_start: string
        time_end: string
        employee_key: string
        employee_name: string
        assignment_date: string
      }
    }

type CopilotTurnResult = {
  message: { role: 'assistant'; content: string }
  confirmable: KiraConfirmable[]
  client_actions?: ClientAction[]
}

type KiraAssistantContextValue = {
  openKira: (opts?: KiraOpenOptions) => void
  closeKira: () => void
  kiraOpen: boolean
  /** True while POST /ai/copilot/turn is in flight (survives closing the modal). */
  kiraCopilotSending: boolean
  /**
   * True when a copilot reply arrived while the modal was closed — show a dot on the Kira icon until the user opens Kira.
   */
  kiraUnreadReplyDot: boolean
  sendKiraPrompt: (text: string) => Promise<void>
}

const KiraAssistantContext = createContext<KiraAssistantContextValue | null>(
  null,
)

export function useKiraAssistant(): KiraAssistantContextValue {
  const ctx = useContext(KiraAssistantContext)
  if (!ctx) {
    throw new Error('useKiraAssistant must be used within KiraAssistantProvider')
  }
  return ctx
}

export function KiraAssistantProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [kiraOpen, setKiraOpen] = useState(false)
  const kiraBootRef = useRef<KiraBootPayload | null>(null)
  const [kiraMessages, setKiraMessages] = useState<KiraChatMessage[]>([])
  const [kiraPending, setKiraPending] = useState<KiraConfirmable[]>([])
  const [kiraCopilotSending, setKiraCopilotSending] = useState(false)
  const [kiraUnreadReplyDot, setKiraUnreadReplyDot] = useState(false)
  const kiraCopilotSendingRef = useRef(false)
  const messagesRef = useRef(kiraMessages)
  const kiraOpenRef = useRef(kiraOpen)
  const toastRef = useRef<Toast>(null)
  /** Last user+site key used while Kira was open; used to drop stale thread after site/user switch. */
  const chatThreadKeyRef = useRef<string | null>(null)

  useEffect(() => {
    messagesRef.current = kiraMessages
  }, [kiraMessages])

  useEffect(() => {
    kiraOpenRef.current = kiraOpen
  }, [kiraOpen])

  const openKira = useCallback((opts?: KiraOpenOptions) => {
    const d = opts?.draft?.trim()
    if (d) {
      kiraBootRef.current = { draft: d, resetThread: true }
      setKiraMessages([])
      setKiraPending([])
    } else {
      kiraBootRef.current = null
    }
    setKiraOpen(true)
  }, [])

  const closeKira = useCallback(() => {
    kiraBootRef.current = null
    setKiraOpen(false)
  }, [])

  const sendKiraPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      const siteId = getStoredUser()?.working_site_id
      if (!trimmed || !siteId) return
      if (kiraCopilotSendingRef.current) return

      const prior = messagesRef.current
      const now = Date.now()
      const nextMsgs: KiraChatMessage[] = [
        ...prior,
        { role: 'user', content: trimmed, at: now },
      ]
      setKiraMessages(nextMsgs)
      kiraCopilotSendingRef.current = true
      setKiraCopilotSending(true)

      try {
        const res = await apiJson<CopilotTurnResult>(cmmsPaths.aiCopilotTurn, {
          method: 'POST',
          body: JSON.stringify({
            messages: nextMsgs.map(({ role, content }) => ({ role, content })),
          }),
        })
        setKiraMessages([
          ...nextMsgs,
          { role: 'assistant', content: res.message.content, at: Date.now() },
        ])
        setKiraPending(res.confirmable)
        applyKiraClientActions(res.client_actions, {
          navigate,
          location,
          openKira: () => setKiraOpen(true),
          closeKira: () => setKiraOpen(false),
        })
        if (!kiraOpenRef.current) {
          setKiraUnreadReplyDot(true)
          toastRef.current?.show({
            severity: 'success',
            summary: t('kira.response_ready_title'),
            detail: t('kira.response_ready_detail'),
            life: 8000,
          })
        }
      } catch (e) {
        setKiraMessages(prior)
        const msg = e instanceof ApiError ? e.message : String(e)
        if (!kiraOpenRef.current) {
          toastRef.current?.show({
            severity: 'error',
            summary: t('common.toast_error'),
            detail: msg,
            life: 8000,
          })
        }
        throw e
      } finally {
        kiraCopilotSendingRef.current = false
        setKiraCopilotSending(false)
      }
    },
    [navigate, location, t],
  )

  useEffect(() => {
    if (kiraOpen) setKiraUnreadReplyDot(false)
  }, [kiraOpen])

  useEffect(() => {
    if (!kiraOpen) return
    const u = getStoredUser()
    const key = `${u?.id ?? ''}:${u?.working_site_id ?? ''}`
    if (chatThreadKeyRef.current === null) {
      chatThreadKeyRef.current = key
      return
    }
    if (chatThreadKeyRef.current !== key) {
      setKiraMessages([])
      setKiraPending([])
      chatThreadKeyRef.current = key
    }
  }, [kiraOpen])

  const value = useMemo(
    () => ({
      openKira,
      closeKira,
      kiraOpen,
      kiraCopilotSending,
      kiraUnreadReplyDot,
      sendKiraPrompt,
    }),
    [openKira, closeKira, kiraOpen, kiraCopilotSending, kiraUnreadReplyDot, sendKiraPrompt],
  )

  return (
    <KiraAssistantContext.Provider value={value}>
      {children}
      <Toast ref={toastRef} position="top-right" />
      <Dialog
        visible={kiraOpen}
        onHide={closeKira}
        header={t('kira.agent_title')}
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
        <KiraAssistantContent
          visible={kiraOpen}
          bootRef={kiraBootRef}
          messages={kiraMessages}
          setMessages={setKiraMessages}
          pending={kiraPending}
          setPending={setKiraPending}
        />
      </Dialog>
    </KiraAssistantContext.Provider>
  )
}
