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
        'kira.ask_kira': 'Ask Kira',
        'kira.link_open_asset': 'Open asset',
        'kira.link_open_workgroup': 'Open workgroup',
        'kira.link_open_work_order': 'Open work order',
        'kira.thinking': 'Thinking',
        'shell.kira_aria': 'Open Kira',
        'nav.athene': 'Athene',
        'shell.athene_aria': 'Open Athene',
        'athene.title': 'Athene',
        'athene.agent_title': 'Athene — Vector Search',
        'athene.label_athene': 'Athene',
        'athene.subtitle':
          'Ask in plain language. Athene searches the work-order vector index and uses GPT to reason over the matches and answer you directly.',
        'athene.placeholder':
          'e.g. "top 5 breakdowns this month" or "what failed on pump P-12?"',
        'athene.search': 'Search',
        'athene.searching': 'Thinking',
        'athene.status_label': 'Status',
        'athene.reason_label': 'Why',
        'athene.score_tooltip': 'Cosine similarity (100% = identical text)',
        'athene.matches_summary': '{{count}} relevant work orders.',
        'athene.no_matches': 'No relevant work orders found.',
        'athene.response_ready_title': 'Athene reply ready',
        'athene.response_ready_detail': 'Open Athene to see the matches.',
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
        'kira.ask_kira': 'Kira fragen',
        'kira.link_open_asset': 'Objekt öffnen',
        'kira.link_open_workgroup': 'Arbeitsgruppe öffnen',
        'kira.link_open_work_order': 'Arbeitsauftrag öffnen',
        'kira.thinking': 'Denkt nach',
        'shell.kira_aria': 'Kira öffnen',
        'nav.athene': 'Athene',
        'shell.athene_aria': 'Athene öffnen',
        'athene.title': 'Athene',
        'athene.agent_title': 'Athene — Vektor-Suche',
        'athene.label_athene': 'Athene',
        'athene.subtitle':
          'Fragen Sie in natürlicher Sprache. Athene durchsucht den Vektor-Index der Arbeitsaufträge und nutzt GPT, um die Treffer zu bewerten und Ihnen direkt zu antworten.',
        'athene.placeholder':
          'z. B. "Top 5 Störungen diesen Monat" oder "Was ist an Pumpe P-12 kaputtgegangen?"',
        'athene.search': 'Suchen',
        'athene.searching': 'Denke nach',
        'athene.status_label': 'Status',
        'athene.reason_label': 'Warum',
        'athene.score_tooltip': 'Kosinus-Ähnlichkeit (100 % = identischer Text)',
        'athene.matches_summary': '{{count}} relevante Arbeitsaufträge.',
        'athene.no_matches': 'Keine relevanten Arbeitsaufträge gefunden.',
        'athene.response_ready_title': 'Athene-Antwort bereit',
        'athene.response_ready_detail':
          'Öffnen Sie Athene, um die Treffer zu sehen.',
      },
    },
  },
})

export { i18n }
