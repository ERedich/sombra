INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'monitoring.col_employee', 'Employee'),
('en', 'monitoring.employee_current_option', 'Current Employee'),
('de', 'monitoring.col_employee', 'Mitarbeiter'),
('de', 'monitoring.employee_current_option', 'Aktueller Mitarbeiter')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
