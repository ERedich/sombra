-- Toast when Kira copilot finishes while the assistant modal was closed
INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'kira.response_ready_title', 'Kira'),
('de', 'kira.response_ready_title', 'Kira'),
('en', 'kira.response_ready_detail', 'The answer is ready. Open Kira to read it.'),
('de', 'kira.response_ready_detail', 'Die Antwort ist fertig. Öffnen Sie Kira, um sie zu lesen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
