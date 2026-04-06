-- Users employee-reference labels/help (EN + DE). Idempotent.
INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'users.field_employee_optional', 'Linked employee (optional)'),
('en', 'users.placeholder_employee_optional', 'Select employee (optional)'),
('en', 'users.employee_note', 'Optional 1:1 link to an employee for future resource assignment flows. Only employees from the user''s working/additional sites are selectable.')
ON CONFLICT (locale, msg_key) DO NOTHING;

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('de', 'users.field_employee_optional', 'Verknüpfter Mitarbeiter (optional)'),
('de', 'users.placeholder_employee_optional', 'Mitarbeiter wählen (optional)'),
('de', 'users.employee_note', 'Optionale 1:1-Verknüpfung zu einem Mitarbeiter für zukünftige Ressourcenzuweisungen. Es sind nur Mitarbeiter aus Arbeits-/Zusatzstandorten des Benutzers auswählbar.')
ON CONFLICT (locale, msg_key) DO NOTHING;
