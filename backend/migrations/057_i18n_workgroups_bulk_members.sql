INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'workgroups.pick_employees', 'Employees'),
('en', 'workgroups.add_members', 'Add selected'),
('en', 'workgroups.members_bulk_added', 'Added {{count}} member(s).'),
('en', 'workgroups.members_bulk_partial', 'Added {{added}}; {{skipped}} already in this group.'),
('en', 'workgroups.members_bulk_none', 'No new members (all selected were already in this group).'),
('de', 'workgroups.pick_employees', 'Mitarbeiter'),
('de', 'workgroups.add_members', 'Ausgewählte hinzufügen'),
('de', 'workgroups.members_bulk_added', '{{count}} Mitglied(er) hinzugefügt.'),
('de', 'workgroups.members_bulk_partial', '{{added}} hinzugefügt; {{skipped}} waren bereits in der Gruppe.'),
('de', 'workgroups.members_bulk_none', 'Keine neuen Mitglieder (alle ausgewählten waren bereits in der Gruppe).')
ON CONFLICT DO NOTHING;
