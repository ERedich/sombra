-- Kira assistant naming + modal strings (EN + DE). Idempotent.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'nav.ai', 'Kira'),
('en', 'shell.kira_aria', 'Open Kira'),
('en', 'kira.title', 'Kira'),
('en', 'kira.agent_title', 'Kira AI Agent'),
('en', 'kira.conversation_label', 'Conversation'),
('en', 'kira.label_you', 'You'),
('en', 'kira.label_kira', 'Kira'),
('en', 'kira.subtitle', 'Ask questions, look up data, and prepare work orders or assets. Nothing is saved until you confirm.'),
('en', 'kira.empty_hint', 'Describe what you need in your own words.'),
('de', 'nav.ai', 'Kira'),
('de', 'shell.kira_aria', 'Kira öffnen'),
('de', 'kira.title', 'Kira'),
('de', 'kira.agent_title', 'Kira KI-Assistent'),
('de', 'kira.conversation_label', 'Unterhaltung'),
('de', 'kira.label_you', 'Sie'),
('de', 'kira.label_kira', 'Kira'),
('de', 'kira.subtitle', 'Fragen stellen, Daten abfragen und Arbeitsaufträge oder Objekte vorbereiten. Erst nach Bestätigung wird gespeichert.'),
('de', 'kira.empty_hint', 'Beschreiben Sie in eigenen Worten, was Sie brauchen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
