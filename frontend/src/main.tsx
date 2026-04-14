import './setupDevPerformanceMeasure'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrimeReactProvider } from 'primereact/api'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'
import './index.css'
import './i18n/i18n.ts'
import { registerPrimeLocales } from './i18n/registerPrimeLocales'
import { PrimeLocaleSync } from './i18n/PrimeLocaleSync'
import { AppI18nLoader } from './i18n/AppI18nLoader'
import { AppParametersProvider } from './layout/AppParametersProvider'
import App from './App.tsx'
import { HotkeySettingsProvider } from './hotkeys/HotkeySettingsContext'
import { AppCreateShortcutProvider } from './layout/AppCreateShortcut'
import { AppToolbarSearchFocusProvider } from './layout/AppToolbarSearchFocus'
import { OpenLastAppShortcutProvider } from './layout/OpenLastAppShortcutProvider'
import { KiraAssistantProvider } from './layout/KiraAssistantProvider'
import { QuickAccessProvider } from './layout/QuickAccessProvider'
import { MinimizedDockStackProvider } from './components/app-crud-dialog'
import { WorkOrderMwProvider } from './layout/WorkOrderMwProvider'
import { WorkOrderNotificationsProvider } from './notifications/WorkOrderNotificationsContext'

registerPrimeLocales()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PrimeReactProvider>
        <AppParametersProvider>
          <PrimeLocaleSync />
          <HotkeySettingsProvider>
            <MinimizedDockStackProvider>
            <WorkOrderMwProvider>
            <WorkOrderNotificationsProvider>
              <OpenLastAppShortcutProvider>
                <AppToolbarSearchFocusProvider>
                  <AppCreateShortcutProvider>
                    <AppI18nLoader>
                      <KiraAssistantProvider>
                        <QuickAccessProvider>
                          <App />
                        </QuickAccessProvider>
                      </KiraAssistantProvider>
                    </AppI18nLoader>
                  </AppCreateShortcutProvider>
                </AppToolbarSearchFocusProvider>
              </OpenLastAppShortcutProvider>
            </WorkOrderNotificationsProvider>
            </WorkOrderMwProvider>
            </MinimizedDockStackProvider>
          </HotkeySettingsProvider>
        </AppParametersProvider>
      </PrimeReactProvider>
    </BrowserRouter>
  </StrictMode>,
)
