-- App Parameters app + WO start tooltip when assignment not required (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'nav.app_parameters', 'App parameters'),
  ('de', 'nav.app_parameters', 'App-Parameter'),
  ('en', 'app_params.title', 'App parameters'),
  ('de', 'app_params.title', 'App-Parameter'),
  ('en', 'app_params.tab_work_orders', 'Work orders'),
  ('de', 'app_params.tab_work_orders', 'Arbeitsaufträge'),
  ('en', 'app_params.wo_start_section', 'Start work behaviour'),
  ('de', 'app_params.wo_start_section', 'Start-Verhalten'),
  ('en', 'app_params.wo_start_require_assignment', 'User must be assigned to the work order to start work'),
  ('de', 'app_params.wo_start_require_assignment', 'Benutzer muss dem Auftrag zugewiesen sein, um zu starten'),
  ('en', 'app_params.option_yes', 'Yes'),
  ('de', 'app_params.option_yes', 'Ja'),
  ('en', 'app_params.option_no', 'No'),
  ('de', 'app_params.option_no', 'Nein'),
  ('en', 'app_params.save', 'Save'),
  ('de', 'app_params.save', 'Speichern'),
  ('en', 'app_params.saved', 'Settings saved.'),
  ('de', 'app_params.saved', 'Einstellungen gespeichert.'),
  ('en', 'app_params.load_fail', 'Could not load app parameters.'),
  ('de', 'app_params.load_fail', 'App-Parameter konnten nicht geladen werden.'),
  ('en', 'app_params.save_fail', 'Could not save app parameters.'),
  ('de', 'app_params.save_fail', 'App-Parameter konnten nicht gespeichert werden.'),
  ('en', 'wo.start_disabled_no_employee_user_only', 'Link your user to an employee.'),
  ('de', 'wo.start_disabled_no_employee_user_only', 'Benutzer mit einem Mitarbeiter verknüpfen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
