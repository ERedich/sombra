import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type MinimizedDockStackValue = {
  /** Bottom-up order: index 0 is closest to the viewport bottom. */
  ids: readonly string[]
  register: (id: string) => void
  unregister: (id: string) => void
}

const Ctx = createContext<MinimizedDockStackValue | null>(null)

export function MinimizedDockStackProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([])

  const register = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const unregister = useCallback((id: string) => {
    setIds((prev) => prev.filter((x) => x !== id))
  }, [])

  const value = useMemo(
    () =>
      ({
        ids,
        register,
        unregister,
      }) satisfies MinimizedDockStackValue,
    [ids, register, unregister],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* Hook is intentionally exported next to its provider (same pattern as other layout contexts). */
// eslint-disable-next-line react-refresh/only-export-components -- useMinimizedDockStack
export function useMinimizedDockStack(): MinimizedDockStackValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error(
      'useMinimizedDockStack must be used within MinimizedDockStackProvider',
    )
  }
  return v
}
