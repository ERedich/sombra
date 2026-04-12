import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from 'primereact/dialog'
import { KiraAssistantContent } from '../components/ai/KiraAssistantContent'

type KiraAssistantContextValue = {
  openKira: () => void
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

  const openKira = useCallback(() => setKiraOpen(true), [])
  const closeKira = useCallback(() => setKiraOpen(false), [])

  const value = useMemo(
    () => ({ openKira, closeKira, kiraOpen }),
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
        <KiraAssistantContent />
      </Dialog>
    </KiraAssistantContext.Provider>
  )
}
