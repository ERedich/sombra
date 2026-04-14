import type { ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { WorkOrder } from '../apps/work-orders/workOrderTypes'
import { WorkOrderFormDialog } from '../apps/work-orders/WorkOrderFormDialog'
import type { WoMwEvent, WorkOrderMwSession } from './workOrderMwTypes'

export type { WoMwEvent, WorkOrderMwSession } from './workOrderMwTypes'

type WorkOrderMwContextValue = {
  session: WorkOrderMwSession
  mountWoMw: (workOrderId: string, opts?: { initialTab?: number }) => void
  closeWoMw: () => void
  openCreateWorkOrderMw: () => void
  openEditWorkOrderMw: (row: WorkOrder, initialTab?: number) => void
  subscribeWorkOrderMwEvents: (fn: (e: WoMwEvent) => void) => () => void
}

const Ctx = createContext<WorkOrderMwContextValue | null>(null)

export function WorkOrderMwProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WorkOrderMwSession>(null)
  const listenersRef = useRef(new Set<(e: WoMwEvent) => void>())

  const emit = useCallback((e: WoMwEvent) => {
    for (const fn of listenersRef.current) {
      fn(e)
    }
  }, [])

  const subscribeWorkOrderMwEvents = useCallback(
    (fn: (e: WoMwEvent) => void) => {
      listenersRef.current.add(fn)
      return () => {
        listenersRef.current.delete(fn)
      }
    },
    [],
  )

  const mountWoMw = useCallback(
    (workOrderId: string, opts?: { initialTab?: number }) => {
      const id = workOrderId.trim()
      if (!id) return
      setSession({
        kind: 'edit',
        workOrderId: id,
        seedRow: null,
        initialTab: opts?.initialTab,
      })
    },
    [],
  )

  const closeWoMw = useCallback(() => {
    setSession(null)
  }, [])

  const openCreateWorkOrderMw = useCallback(() => {
    setSession({ kind: 'create' })
  }, [])

  const openEditWorkOrderMw = useCallback(
    (row: WorkOrder, initialTab?: number) => {
      setSession({
        kind: 'edit',
        workOrderId: row.id,
        seedRow: row,
        initialTab,
      })
    },
    [],
  )

  const value = useMemo(
    () =>
      ({
        session,
        mountWoMw,
        closeWoMw,
        openCreateWorkOrderMw,
        openEditWorkOrderMw,
        subscribeWorkOrderMwEvents,
      }) satisfies WorkOrderMwContextValue,
    [
      session,
      mountWoMw,
      closeWoMw,
      openCreateWorkOrderMw,
      openEditWorkOrderMw,
      subscribeWorkOrderMwEvents,
    ],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <WorkOrderFormDialog
        session={session}
        onClose={closeWoMw}
        onEvent={emit}
      />
    </Ctx.Provider>
  )
}

export function useWorkOrderMw(): WorkOrderMwContextValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('useWorkOrderMw must be used within WorkOrderMwProvider')
  }
  return v
}
