-- Month scheduler: toast strings for work order drag-and-drop (plan dates).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'mcal.dnd_wo_moved', 'Work order plan dates updated.'),
('en', 'mcal.dnd_wo_failed', 'Could not update work order plan dates.'),

('de', 'mcal.dnd_wo_moved', 'Plantermine des Arbeitsauftrags wurden aktualisiert.'),
('de', 'mcal.dnd_wo_failed', 'Plantermine des Arbeitsauftrags konnten nicht aktualisiert werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
