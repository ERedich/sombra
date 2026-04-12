import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        'kira.title': 'Kira',
        'kira.agent_title': 'Kira AI Agent',
        'kira.conversation_label': 'Conversation',
        'kira.label_you': 'You',
        'kira.label_kira': 'Kira',
        'kira.subtitle':
          'Ask questions, look up data, and prepare work orders or assets. Nothing is saved until you confirm.',
        'kira.empty_hint': 'Describe what you need in your own words.',
        'kira.listen': 'Speak',
        'kira.stop': 'Stop',
        'kira.stt_unsupported': 'Speech input not supported in this browser.',
        'shell.kira_aria': 'Open Kira',
      },
    },
    de: {
      translation: {
        'kira.title': 'Kira',
        'kira.agent_title': 'Kira KI-Assistent',
        'kira.conversation_label': 'Unterhaltung',
        'kira.label_you': 'Sie',
        'kira.label_kira': 'Kira',
        'kira.subtitle':
          'Fragen stellen, Daten abfragen und Arbeitsaufträge oder Objekte vorbereiten. Erst nach Bestätigung wird gespeichert.',
        'kira.empty_hint': 'Beschreiben Sie in eigenen Worten, was Sie brauchen.',
        'kira.listen': 'Sprechen',
        'kira.stop': 'Stopp',
        'kira.stt_unsupported': 'Spracheingabe wird in diesem Browser nicht unterstützt.',
        'shell.kira_aria': 'Kira öffnen',
      },
    },
  },
})

export { i18n }
