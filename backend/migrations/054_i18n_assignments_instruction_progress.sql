INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.assignments_instructions_progress', '{{done}}/{{total}} Todos done'),
('en', 'wi.view_all_done', 'All done'),
('de', 'wo.assignments_instructions_progress', '{{done}}/{{total}} Erledigt'),
('de', 'wi.view_all_done', 'Alle erledigt')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
