INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.tab_work_plan', 'Work plan'),
('en', 'wo.open_wp', 'Open WP'),
('de', 'wo.tab_work_plan', 'Arbeitsplan'),
('de', 'wo.open_wp', 'Arbeitsplan öffnen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
