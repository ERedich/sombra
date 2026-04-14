import { Dialog } from 'primereact/dialog'
import type { DialogProps } from 'primereact/dialog'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { AppCrudDialogHeader } from './AppCrudDialogHeader'
import { useMinimizedDockStack } from './MinimizedDockStackProvider'

const DOCK_STEP_REM = 3.5

export type MinimizedDockPlacement = 'bottom-center' | 'top-right'

export type AppCrudDialogProps = Omit<DialogProps, 'header' | 'closable'> & {
  title: ReactNode
  /** Shown on the minimized dock; defaults to `title` when `title` is a string. */
  dockTitle?: string
  /** Where the minimized dock sits when `visible && minimized`. Default bottom-center. */
  minimizedDockPlacement?: MinimizedDockPlacement
  minimizable?: boolean
  /**
   * When true, the minimize button is disabled. If omitted, minimize is disabled when
   * `dismissableMask === false` (same guard as blocking mask dismiss).
   */
  minimizeDisabled?: boolean
  /** For nested modals: parent can clear child overlays when minimized. */
  onMinimizedChange?: (minimized: boolean) => void
}

function syntheticHideEvent(): SyntheticEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    nativeEvent: new Event('hide'),
    currentTarget: null,
    target: null,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: false,
    timeStamp: Date.now(),
    type: 'hide',
  } as unknown as SyntheticEvent
}

export function AppCrudDialog({
  title,
  dockTitle: dockTitleProp,
  visible,
  onHide,
  dismissableMask,
  minimizable = true,
  minimizeDisabled: minimizeDisabledProp,
  onMinimizedChange,
  minimizedDockPlacement = 'bottom-center',
  children,
  ...dialogProps
}: AppCrudDialogProps) {
  const { t } = useTranslation()
  const [minimized, setMinimized] = useState(false)
  const rawId = useId()
  const dockId = useMemo(() => rawId.replace(/:/g, ''), [rawId])
  const { ids, register, unregister } = useMinimizedDockStack()

  const resolvedDockTitle = useMemo(() => {
    if (dockTitleProp != null && dockTitleProp !== '') return dockTitleProp
    if (typeof title === 'string' || typeof title === 'number') return String(title)
    return ''
  }, [dockTitleProp, title])

  useEffect(() => {
    if (visible) return
    const id = requestAnimationFrame(() => setMinimized(false))
    return () => cancelAnimationFrame(id)
  }, [visible])

  const onMinimizedChangeRef = useRef(onMinimizedChange)
  useEffect(() => {
    onMinimizedChangeRef.current = onMinimizedChange
  })
  useEffect(() => {
    onMinimizedChangeRef.current?.(Boolean(visible && minimized))
  }, [visible, minimized])

  useEffect(() => {
    if (visible && minimized) {
      register(dockId)
      return () => unregister(dockId)
    }
    unregister(dockId)
    return undefined
  }, [visible, minimized, dockId, register, unregister])

  const stackIndex = Math.max(0, ids.indexOf(dockId))

  const minimizeDisabled =
    minimizeDisabledProp ??
    (dismissableMask === false)

  const invokeHide = useCallback(() => {
    if (!onHide) return
    const ev = syntheticHideEvent()
    ;(onHide as (e: SyntheticEvent) => void)(ev)
  }, [onHide])

  const expandedVisible = Boolean(visible && !minimized)

  const dockPlacementClass =
    minimizedDockPlacement === 'top-right'
      ? 'app-mw-minimized-dock--top-right'
      : 'app-mw-minimized-dock--bottom-center'

  const dockOffsetStyle =
    minimizedDockPlacement === 'top-right'
      ? {
          top: `calc(1rem + ${stackIndex * DOCK_STEP_REM}rem)`,
        }
      : {
          bottom: `calc(1rem + ${stackIndex * DOCK_STEP_REM}rem)`,
        }

  const dock =
    visible && minimized && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={`app-mw-minimized-dock ${dockPlacementClass} border-1 surface-border border-round shadow-2 flex align-items-center gap-2 px-3 py-2`}
            style={dockOffsetStyle}
            role="region"
            aria-label={t('mw.dock_aria')}
          >
            <span className="flex-1 min-w-0 text-sm font-medium truncate">
              {resolvedDockTitle || '\u00a0'}
            </span>
            <Button
              type="button"
              icon="pi pi-window-maximize"
              text
              rounded
              severity="secondary"
              onClick={() => setMinimized(false)}
              aria-label={t('mw.restore_aria')}
            />
            <Button
              type="button"
              icon="pi pi-times"
              text
              rounded
              severity="secondary"
              onClick={() => invokeHide()}
              aria-label={t('common.close')}
            />
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <Dialog
        {...dialogProps}
        visible={expandedVisible}
        closable={!minimizable}
        onHide={onHide}
        dismissableMask={dismissableMask}
        header={
          minimizable ? (
            <AppCrudDialogHeader
              title={title}
              onMinimize={() => setMinimized(true)}
              onClose={() => invokeHide()}
              minimizeDisabled={minimizeDisabled}
            />
          ) : (
            title
          )
        }
      >
        {children}
      </Dialog>
      {dock}
    </>
  )
}
