-- Month scheduler: work orders on calendar + load strings.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'mcal.legend_work_orders', 'Work orders (plan dates)'),
('en', 'mcal.wo_loading', 'Loading work orders…'),
('en', 'mcal.wo_load_fail', 'Could not load work orders for the calendar.'),

('de', 'mcal.legend_work_orders', 'Arbeitsaufträge (Plantermine)'),
('de', 'mcal.wo_loading', 'Arbeitsaufträge werden geladen…'),
('de', 'mcal.wo_load_fail', 'Arbeitsaufträge für den Kalender konnten nicht geladen werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
