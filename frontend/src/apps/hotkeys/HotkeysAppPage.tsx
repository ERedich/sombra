import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Divider } from 'primereact/divider'
import { InputText } from 'primereact/inputtext'
import { Tag } from 'primereact/tag'
import { bindingFromKeyboardEvent } from '../../hotkeys/bindingFromKeyboardEvent'
import {
  DEFAULT_CREATE_DATA,
  DEFAULT_JUMP_TO_SEARCHBAR,
  DEFAULT_OPEN_LAST_APP,
  DEFAULT_QUICK_ACCESS,
} from '../../hotkeys/defaults'
import { formatHotkey } from '../../hotkeys/formatHotkey'
import { useHotkeySettings } from '../../hotkeys/HotkeySettingsContext'
import { AppShell } from '../../layout/AppShell'

type RecordingKey =
  | 'jumpToSearchbar'
  | 'createData'
  | 'quickAccess'
  | 'openLastApp'

function useAppleKeyboardLabels(): boolean {
  return useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    [],
  )
}

export default function HotkeysAppPage() {
  const { t } = useTranslation()
  const {
    jumpToSearchbar,
    setJumpToSearchbar,
    createData,
    setCreateData,
    quickAccess,
    setQuickAccess,
    openLastApp,
    setOpenLastApp,
    resetToDefaults,
  } = useHotkeySettings()
  const preferMacLabels = useAppleKeyboardLabels()
  const [recording, setRecording] = useState<RecordingKey | null>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (recording) captureInputRef.current?.focus()
  }, [recording])

  const jumpDisplay = useMemo(
    () => formatHotkey(jumpToSearchbar, preferMacLabels),
    [jumpToSearchbar, preferMacLabels],
  )

  const createDisplay = useMemo(
    () => formatHotkey(createData, preferMacLabels),
    [createData, preferMacLabels],
  )

  const defaultJumpDisplay = useMemo(
    () => formatHotkey(DEFAULT_JUMP_TO_SEARCHBAR, preferMacLabels),
    [preferMacLabels],
  )

  const defaultCreateDisplay = useMemo(
    () => formatHotkey(DEFAULT_CREATE_DATA, preferMacLabels),
    [preferMacLabels],
  )

  const quickAccessDisplay = useMemo(
    () => formatHotkey(quickAccess, preferMacLabels),
    [quickAccess, preferMacLabels],
  )

  const defaultQuickAccessDisplay = useMemo(
    () => formatHotkey(DEFAULT_QUICK_ACCESS, preferMacLabels),
    [preferMacLabels],
  )

  const openLastAppDisplay = useMemo(
    () => formatHotkey(openLastApp, preferMacLabels),
    [openLastApp, preferMacLabels],
  )

  const defaultOpenLastAppDisplay = useMemo(
    () => formatHotkey(DEFAULT_OPEN_LAST_APP, preferMacLabels),
    [preferMacLabels],
  )

  const tipLine = useMemo(
    () =>
      t('hotkeys.tip_line', {
        jump: defaultJumpDisplay,
        create: defaultCreateDisplay,
        qa: defaultQuickAccessDisplay,
        last: defaultOpenLastAppDisplay,
      }),
    [
      t,
      defaultJumpDisplay,
      defaultCreateDisplay,
      defaultQuickAccessDisplay,
      defaultOpenLastAppDisplay,
    ],
  )

  const onCaptureKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const native = e.nativeEvent
      const b = bindingFromKeyboardEvent(native)
      if (!b) return
      if (recording === 'jumpToSearchbar') setJumpToSearchbar(b)
      else if (recording === 'createData') setCreateData(b)
      else if (recording === 'quickAccess') setQuickAccess(b)
      else if (recording === 'openLastApp') setOpenLastApp(b)
      setRecording(null)
    },
    [
      recording,
      setJumpToSearchbar,
      setCreateData,
      setQuickAccess,
      setOpenLastApp,
    ],
  )

  const cardHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-key text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('hotkeys.title')}</h1>
        <p className="app-card-hero-desc">{t('hotkeys.intro_saved')}</p>
      </div>
    </div>
  )

  return (
    <AppShell>
      <div className="p-4 max-w-screen-lg mx-auto flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={cardHeader}
        >
          <div className="px-1 md:px-2">
            <div className="text-xs font-semibold uppercase text-color-secondary letter-spacing-1 mb-3">
              {t('hotkeys.section_actions')}
            </div>

            {/* Jump to search bar — fixed-width right column keeps vertical divider aligned */}
            <div className="flex flex-column lg:flex-row lg:align-items-stretch gap-4 lg:gap-6">
              <div className="flex gap-3 flex-1 min-w-0">
                <span
                  className="flex align-items-center justify-content-center border-round-lg flex-shrink-0 surface-100 border-1 border-200"
                  style={{ width: '2.75rem', height: '2.75rem' }}
                  aria-hidden
                >
                  <i className="pi pi-search text-lg text-primary" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-color text-lg line-height-3">
                    {t('hotkeys.jump_title')}
                  </div>
                  <p className="text-sm text-color-secondary mt-1 mb-0 line-height-3">
                    {t('hotkeys.jump_desc')}
                  </p>
                </div>
              </div>

              <Divider
                layout="vertical"
                className="hidden lg:flex m-0 flex-shrink-0 align-self-stretch"
                style={{ minHeight: '4.5rem' }}
              />
              <Divider className="lg:hidden m-0 w-full" />

              <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full lg:w-24rem flex-shrink-0 lg:justify-content-end">
                {recording === 'jumpToSearchbar' ? (
                  <div className="flex flex-column sm:flex-row gap-2 w-full">
                    <InputText
                      ref={captureInputRef}
                      readOnly
                      data-hotkey-capture=""
                      className="font-mono w-full border-primary border-2 text-center"
                      placeholder={t('common.press_keys')}
                      aria-label={t('hotkeys.aria_jump')}
                      onKeyDown={onCaptureKeyDown}
                    />
                    <Button
                      type="button"
                      label={t('hotkeys.cancel_record')}
                      icon="pi pi-times"
                      severity="secondary"
                      outlined
                      className="sm:w-auto w-full"
                      onClick={() => setRecording(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full">
                    <div className="flex align-items-center justify-content-end gap-2 flex-wrap flex-1 min-w-0">
                      <span className="text-xs text-color-secondary uppercase font-medium whitespace-nowrap">
                        {t('hotkeys.current_label')}
                      </span>
                      <Tag
                        value={jumpDisplay}
                        className="font-mono text-base px-3 py-2 border-round-md max-w-full"
                        severity="secondary"
                        aria-live="polite"
                      />
                    </div>
                    <Button
                      type="button"
                      label={t('common.change')}
                      icon="pi pi-pencil"
                      outlined
                      className="sm:w-auto w-full flex-shrink-0"
                      onClick={() => setRecording('jumpToSearchbar')}
                      disabled={recording !== null}
                    />
                  </div>
                )}
              </div>
            </div>

            <Divider className="my-4" />

            {/* Create data */}
            <div className="flex flex-column lg:flex-row lg:align-items-stretch gap-4 lg:gap-6">
              <div className="flex gap-3 flex-1 min-w-0">
                <span
                  className="flex align-items-center justify-content-center border-round-lg flex-shrink-0 surface-100 border-1 border-200"
                  style={{ width: '2.75rem', height: '2.75rem' }}
                  aria-hidden
                >
                  <i className="pi pi-plus text-lg text-primary" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-color text-lg line-height-3">
                    {t('hotkeys.create_title')}
                  </div>
                  <p className="text-sm text-color-secondary mt-1 mb-0 line-height-3">
                    {t('hotkeys.create_desc')}
                  </p>
                </div>
              </div>

              <Divider
                layout="vertical"
                className="hidden lg:flex m-0 flex-shrink-0 align-self-stretch"
                style={{ minHeight: '4.5rem' }}
              />
              <Divider className="lg:hidden m-0 w-full" />

              <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full lg:w-24rem flex-shrink-0 lg:justify-content-end">
                {recording === 'createData' ? (
                  <div className="flex flex-column sm:flex-row gap-2 w-full">
                    <InputText
                      ref={captureInputRef}
                      readOnly
                      data-hotkey-capture=""
                      className="font-mono w-full border-primary border-2 text-center"
                      placeholder={t('common.press_keys')}
                      aria-label={t('hotkeys.aria_create')}
                      onKeyDown={onCaptureKeyDown}
                    />
                    <Button
                      type="button"
                      label={t('hotkeys.cancel_record')}
                      icon="pi pi-times"
                      severity="secondary"
                      outlined
                      className="sm:w-auto w-full"
                      onClick={() => setRecording(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full">
                    <div className="flex align-items-center justify-content-end gap-2 flex-wrap flex-1 min-w-0">
                      <span className="text-xs text-color-secondary uppercase font-medium whitespace-nowrap">
                        {t('hotkeys.current_label')}
                      </span>
                      <Tag
                        value={createDisplay}
                        className="font-mono text-base px-3 py-2 border-round-md max-w-full"
                        severity="secondary"
                        aria-live="polite"
                      />
                    </div>
                    <Button
                      type="button"
                      label={t('common.change')}
                      icon="pi pi-pencil"
                      outlined
                      className="sm:w-auto w-full flex-shrink-0"
                      onClick={() => setRecording('createData')}
                      disabled={recording !== null}
                    />
                  </div>
                )}
              </div>
            </div>

            <Divider className="my-4" />

            {/* Quick Access */}
            <div className="flex flex-column lg:flex-row lg:align-items-stretch gap-4 lg:gap-6">
              <div className="flex gap-3 flex-1 min-w-0">
                <span
                  className="flex align-items-center justify-content-center border-round-lg flex-shrink-0 surface-100 border-1 border-200"
                  style={{ width: '2.75rem', height: '2.75rem' }}
                  aria-hidden
                >
                  <i className="pi pi-bolt text-lg text-primary" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-color text-lg line-height-3">
                    {t('hotkeys.quick_title')}
                  </div>
                  <p className="text-sm text-color-secondary mt-1 mb-0 line-height-3">
                    {t('hotkeys.quick_desc')}
                  </p>
                </div>
              </div>

              <Divider
                layout="vertical"
                className="hidden lg:flex m-0 flex-shrink-0 align-self-stretch"
                style={{ minHeight: '4.5rem' }}
              />
              <Divider className="lg:hidden m-0 w-full" />

              <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full lg:w-24rem flex-shrink-0 lg:justify-content-end">
                {recording === 'quickAccess' ? (
                  <div className="flex flex-column sm:flex-row gap-2 w-full">
                    <InputText
                      ref={captureInputRef}
                      readOnly
                      data-hotkey-capture=""
                      className="font-mono w-full border-primary border-2 text-center"
                      placeholder="Press keys…"
                      aria-label="Record shortcut for Quick Access"
                      onKeyDown={onCaptureKeyDown}
                    />
                    <Button
                      type="button"
                      label={t('hotkeys.cancel_record')}
                      icon="pi pi-times"
                      severity="secondary"
                      outlined
                      className="sm:w-auto w-full"
                      onClick={() => setRecording(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full">
                    <div className="flex align-items-center justify-content-end gap-2 flex-wrap flex-1 min-w-0">
                      <span className="text-xs text-color-secondary uppercase font-medium whitespace-nowrap">
                        {t('hotkeys.current_label')}
                      </span>
                      <Tag
                        value={quickAccessDisplay}
                        className="font-mono text-base px-3 py-2 border-round-md max-w-full"
                        severity="secondary"
                        aria-live="polite"
                      />
                    </div>
                    <Button
                      type="button"
                      label={t('common.change')}
                      icon="pi pi-pencil"
                      outlined
                      className="sm:w-auto w-full flex-shrink-0"
                      onClick={() => setRecording('quickAccess')}
                      disabled={recording !== null}
                    />
                  </div>
                )}
              </div>
            </div>

            <Divider className="my-4" />

            {/* Open last app */}
            <div className="flex flex-column lg:flex-row lg:align-items-stretch gap-4 lg:gap-6">
              <div className="flex gap-3 flex-1 min-w-0">
                <span
                  className="flex align-items-center justify-content-center border-round-lg flex-shrink-0 surface-100 border-1 border-200"
                  style={{ width: '2.75rem', height: '2.75rem' }}
                  aria-hidden
                >
                  <i className="pi pi-arrow-left text-lg text-primary" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-color text-lg line-height-3">
                    Open last app
                  </div>
                  <p className="text-sm text-color-secondary mt-1 mb-0 line-height-3">
                    Go back to the app screen you had open before this one (same
                    as browser back for in-app routes).
                  </p>
                </div>
              </div>

              <Divider
                layout="vertical"
                className="hidden lg:flex m-0 flex-shrink-0 align-self-stretch"
                style={{ minHeight: '4.5rem' }}
              />
              <Divider className="lg:hidden m-0 w-full" />

              <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full lg:w-24rem flex-shrink-0 lg:justify-content-end">
                {recording === 'openLastApp' ? (
                  <div className="flex flex-column sm:flex-row gap-2 w-full">
                    <InputText
                      ref={captureInputRef}
                      readOnly
                      data-hotkey-capture=""
                      className="font-mono w-full border-primary border-2 text-center"
                      placeholder={t('common.press_keys')}
                      aria-label={t('hotkeys.aria_last_app')}
                      onKeyDown={onCaptureKeyDown}
                    />
                    <Button
                      type="button"
                      label={t('hotkeys.cancel_record')}
                      icon="pi pi-times"
                      severity="secondary"
                      outlined
                      className="sm:w-auto w-full"
                      onClick={() => setRecording(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-column sm:flex-row align-items-stretch sm:align-items-center gap-3 w-full">
                    <div className="flex align-items-center justify-content-end gap-2 flex-wrap flex-1 min-w-0">
                      <span className="text-xs text-color-secondary uppercase font-medium whitespace-nowrap">
                        {t('hotkeys.current_label')}
                      </span>
                      <Tag
                        value={openLastAppDisplay}
                        className="font-mono text-base px-3 py-2 border-round-md max-w-full"
                        severity="secondary"
                        aria-live="polite"
                      />
                    </div>
                    <Button
                      type="button"
                      label={t('common.change')}
                      icon="pi pi-pencil"
                      outlined
                      className="sm:w-auto w-full flex-shrink-0"
                      onClick={() => setRecording('openLastApp')}
                      disabled={recording !== null}
                    />
                  </div>
                )}
              </div>
            </div>

            <Divider className="my-4" />

            <div className="flex flex-column sm:flex-row sm:align-items-center sm:justify-content-between gap-3">
              <p className="text-sm text-color-secondary m-0 line-height-3">
                {tipLine}
              </p>
              <Button
                type="button"
                label={t('common.reset_to_defaults')}
                icon="pi pi-refresh"
                severity="secondary"
                text
                className="flex-shrink-0 align-self-start sm:align-self-center"
                onClick={resetToDefaults}
              />
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
