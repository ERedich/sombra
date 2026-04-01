INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wi.view_title', 'Instruction view'),
('en', 'wi.view_empty', 'No work instructions.'),
('en', 'wi.view_load_fail', 'Could not load instructions.'),
('en', 'wi.view_patch_fail', 'Could not update instruction.'),
('de', 'wi.view_title', 'Anweisungsansicht'),
('de', 'wi.view_empty', 'Keine Arbeitshinweise.'),
('de', 'wi.view_load_fail', 'Anweisungen konnten nicht geladen werden.'),
('de', 'wi.view_patch_fail', 'Anweisung konnte nicht aktualisiert werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
