-- Kira modal title, conversation labels, voice buttons (EN + DE).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'kira.agent_title', 'Kira AI Agent'),
('en', 'kira.conversation_label', 'Conversation'),
('en', 'kira.label_you', 'You'),
('en', 'kira.label_kira', 'Kira'),
('en', 'kira.listen', 'Speak'),
('en', 'kira.stop', 'Stop'),
('en', 'kira.stt_unsupported', 'Speech input not supported in this browser.'),
('de', 'kira.agent_title', 'Kira KI-Assistent'),
('de', 'kira.conversation_label', 'Unterhaltung'),
('de', 'kira.label_you', 'Sie'),
('de', 'kira.label_kira', 'Kira'),
('de', 'kira.listen', 'Sprechen'),
('de', 'kira.stop', 'Stopp'),
('de', 'kira.stt_unsupported', 'Spracheingabe wird in diesem Browser nicht unterstützt.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
