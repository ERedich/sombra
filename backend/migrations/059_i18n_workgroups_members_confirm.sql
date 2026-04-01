INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'workgroups.members_apply', 'Apply assignment'),
('en', 'workgroups.members_revert', 'Revert'),
('en', 'workgroups.members_saved', 'Member assignment saved.'),
('en', 'workgroups.members_discard_header', 'Discard changes?'),
('en', 'workgroups.members_discard_msg', 'You have unsaved assignment changes. Close without applying?'),
('en', 'workgroups.pool_hint_confirm', 'Adjust Available and Assigned, then click Apply assignment to save. Revert restores the last saved state.'),
('de', 'workgroups.members_apply', 'Zuweisung übernehmen'),
('de', 'workgroups.members_revert', 'Zurücksetzen'),
('de', 'workgroups.members_saved', 'Zuweisung gespeichert.'),
('de', 'workgroups.members_discard_header', 'Änderungen verwerfen?'),
('de', 'workgroups.members_discard_msg', 'Sie haben nicht gespeicherte Zuweisungsänderungen. Schließen ohne Übernehmen?'),
('de', 'workgroups.pool_hint_confirm', 'Verfügbar und Zugewiesen anpassen, dann „Zuweisung übernehmen“ zum Speichern. „Zurücksetzen“ stellt den zuletzt gespeicherten Stand wieder her.')
ON CONFLICT DO NOTHING;
