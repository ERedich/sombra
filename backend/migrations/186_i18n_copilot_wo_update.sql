-- Kira: confirm / success strings for updating an existing work order from copilot.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_wo_update', 'Update work order {{wo_key}} — {{short_text}}'),
('en', 'copilot.confirm_wo_update_btn', 'Apply changes'),
('en', 'copilot.updated_wo', 'Work order updated.'),
('de', 'copilot.confirm_wo_update', 'Arbeitsauftrag {{wo_key}} aktualisieren — {{short_text}}'),
('de', 'copilot.confirm_wo_update_btn', 'Änderungen übernehmen'),
('de', 'copilot.updated_wo', 'Arbeitsauftrag aktualisiert.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
