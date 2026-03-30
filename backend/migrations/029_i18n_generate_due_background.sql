INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.generate_due_started', 'Generation started; new work orders will appear as they are created.'),
('de', 'wo.generate_due_started', 'Generierung gestartet; neue Aufträge erscheinen, sobald sie erzeugt sind.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
