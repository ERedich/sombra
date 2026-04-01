INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.col_assignments', 'Assignments'),
('en', 'wo.assignments_material', 'Material'),
('en', 'wo.assignments_employee', 'Employee'),
('en', 'wo.assignments_instructions', 'Work instructions'),
('de', 'wo.col_assignments', 'Zuordnungen'),
('de', 'wo.assignments_material', 'Material'),
('de', 'wo.assignments_employee', 'Mitarbeiter'),
('de', 'wo.assignments_instructions', 'Arbeitshinweise')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
