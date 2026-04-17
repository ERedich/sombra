INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'mcal.aria_prev_month', 'Previous month'),
('en', 'mcal.aria_next_month', 'Next month'),
('de', 'mcal.aria_prev_month', 'Vorheriger Monat'),
('de', 'mcal.aria_next_month', 'Nächster Monat')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
