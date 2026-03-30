INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.generate_due_orders', 'Generate orders'),
('en', 'wo.generate_due_success', '{{count}} work order(s) generated from due PM intervals.'),
('en', 'wo.generate_due_failed', 'Could not generate orders.'),
('de', 'wo.generate_due_orders', 'Aufträge generieren'),
('de', 'wo.generate_due_success', '{{count}} neue Arbeitsaufträge aus fälligen PM-Intervallen erzeugt.'),
('de', 'wo.generate_due_failed', 'Aufträge konnten nicht generiert werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
