-- Parallel login warning, idle session, App Parameters General tab (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'login.parallel_session_title', 'Another session is active'),
  ('de', 'login.parallel_session_title', 'Eine weitere Sitzung ist aktiv'),
  ('en', 'login.parallel_session_message', 'You are already signed in elsewhere. Working in multiple sessions at once can cause unexpected behaviour or inconsistent data. Continue only if you understand the risk.'),
  ('de', 'login.parallel_session_message', 'Sie sind bereits woanders angemeldet. Die gleichzeitige Nutzung mehrerer Sitzungen kann zu unerwartetem Verhalten oder inkonsistenten Daten führen. Fahren Sie nur fort, wenn Sie dieses Risiko akzeptieren.'),
  ('en', 'login.parallel_session_ack', 'Continue'),
  ('de', 'login.parallel_session_ack', 'Fortfahren'),
  ('en', 'shell.session_idle_summary', 'Signed out'),
  ('de', 'shell.session_idle_summary', 'Abgemeldet'),
  ('en', 'shell.session_idle_detail', 'You were signed out after a period of inactivity.'),
  ('de', 'shell.session_idle_detail', 'Sie wurden nach einer Inaktivitätsperiode abgemeldet.'),
  ('en', 'app_params.tab_general', 'General'),
  ('de', 'app_params.tab_general', 'Allgemein'),
  ('en', 'app_params.general_idle_heading', 'Idle session timeout'),
  ('de', 'app_params.general_idle_heading', 'Leerlauf-Abmeldung'),
  ('en', 'app_params.general_idle_help', 'Minutes of inactivity before users are signed out automatically. Set to 0 to disable.'),
  ('de', 'app_params.general_idle_help', 'Minuten Inaktivität, nach denen Benutzer automatisch abgemeldet werden. 0 deaktiviert die Funktion.'),
  ('en', 'app_params.general_idle_label', 'Timeout (minutes)'),
  ('de', 'app_params.general_idle_label', 'Timeout (Minuten)'),
  ('en', 'app_params.general_idle_max_hint', 'Maximum is 10080 minutes (7 days).'),
  ('de', 'app_params.general_idle_max_hint', 'Höchstens 10080 Minuten (7 Tage).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
