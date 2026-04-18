INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_shift_assignment', 'Assign employee to shift'),
('de', 'copilot.confirm_shift_assignment', 'Mitarbeiter der Schicht zuweisen'),
('en', 'copilot.confirm_shift_assignment_btn', 'Assign shift'),
('de', 'copilot.confirm_shift_assignment_btn', 'Schicht zuweisen'),
('en', 'copilot.shift_assignment_created', 'Shift assignment created.'),
('de', 'copilot.shift_assignment_created', 'Schichtzuweisung gespeichert.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
