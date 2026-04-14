-- First day of week (FDW) general app parameters UI strings (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.general_fdw_heading', 'First day of week'),
  ('de', 'app_params.general_fdw_heading', 'Erster Wochentag'),
  ('en', 'app_params.general_fdw_help', 'Choose whether calendars start the week on Monday or Sunday.'),
  ('de', 'app_params.general_fdw_help', 'Legen Sie fest, ob Kalender die Woche mit Montag oder Sonntag beginnen.'),
  ('en', 'app_params.general_fdw_opt_monday', 'Monday'),
  ('de', 'app_params.general_fdw_opt_monday', 'Montag'),
  ('en', 'app_params.general_fdw_opt_sunday', 'Sunday'),
  ('de', 'app_params.general_fdw_opt_sunday', 'Sonntag')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
