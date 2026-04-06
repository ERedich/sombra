-- SWB / UAA headings and copy (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_abbr_legend', 'SWB: Start work behaviour. UAA: User auto assign.'),
  ('de', 'app_params.wo_abbr_legend', 'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen.'),
  ('en', 'app_params.wo_start_heading', 'SWB — Start work behaviour'),
  ('de', 'app_params.wo_start_heading', 'SWB — Start-Verhalten'),
  ('en', 'app_params.wo_uaa_heading', 'UAA — User auto assign'),
  ('de', 'app_params.wo_uaa_heading', 'UAA — Benutzer automatisch zuweisen'),
  ('en', 'app_params.wo_uaa_explain', 'When starting work, the user is automatically added to this work order''s assigned employees.'),
  ('de', 'app_params.wo_uaa_explain', 'Beim Start wird der Benutzer automatisch den zugewiesenen Mitarbeitern dieses Auftrags hinzugefügt.'),
  ('en', 'app_params.wo_uaa_disabled_hint', 'Only applies when SWB is No.'),
  ('de', 'app_params.wo_uaa_disabled_hint', 'Gilt nur, wenn SWB auf Nein steht.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
