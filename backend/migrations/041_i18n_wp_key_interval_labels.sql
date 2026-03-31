INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wp.field_key', 'Key'),
('en', 'wp.field_interval', 'Interval'),
('en', 'wp.err_key', 'Key is required.'),
('en', 'wp.err_interval', 'Interval must be at least 1.'),
('de', 'wp.field_key', 'Schlüssel'),
('de', 'wp.field_interval', 'Intervall'),
('de', 'wp.err_key', 'Schlüssel ist erforderlich.'),
('de', 'wp.err_interval', 'Intervall muss mindestens 1 sein.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
