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
import { getStoredUser } from '../auth'
import { KiraAssistantContent } from '../components/ai/KiraAssistantContent'

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

type KiraAssistantContextValue = {
  openKira: (opts?: KiraOpenOptions) => void
  closeKira: () => void
  kiraOpen: boolean
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
  const [kiraOpen, setKiraOpen] = useState(false)
  const kiraBootRef = useRef<KiraBootPayload | null>(null)
  const [kiraMessages, setKiraMessages] = useState<KiraChatMessage[]>([])
  const [kiraPending, setKiraPending] = useState<KiraConfirmable[]>([])
  /** Last user+site key used while Kira was open; used to drop stale thread after site/user switch. */
  const chatThreadKeyRef = useRef<string | null>(null)

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
    }),
    [openKira, closeKira, kiraOpen],
  )

  return (
    <KiraAssistantContext.Provider value={value}>
      {children}
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
