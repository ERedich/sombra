-- Kira: confirm / success strings for work plan (WP) creation from copilot.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_wp', 'Create work plan'),
('en', 'copilot.created_wp', 'Work plan created.'),
('de', 'copilot.confirm_wp', 'Arbeitsplan anlegen'),
('de', 'copilot.created_wp', 'Arbeitsplan angelegt.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
