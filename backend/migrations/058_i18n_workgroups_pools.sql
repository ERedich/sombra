INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'workgroups.pool_available', 'Available'),
('en', 'workgroups.pool_assigned', 'Assigned'),
('en', 'workgroups.pool_hint', 'Left: employees at this site who are not in the group. Right: members. Use the arrows to move; changes save automatically.'),
('de', 'workgroups.pool_available', 'Verfügbar'),
('de', 'workgroups.pool_assigned', 'Zugewiesen'),
('de', 'workgroups.pool_hint', 'Links: Mitarbeiter am Standort, die nicht in der Gruppe sind. Rechts: Mitglieder. Mit den Pfeilen verschieben; Änderungen werden automatisch gespeichert.')
ON CONFLICT DO NOTHING;
