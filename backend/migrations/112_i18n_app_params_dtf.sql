-- DTF (date & time format) general app parameters UI strings (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.general_dtf_heading', 'DTF'),
  ('de', 'app_params.general_dtf_heading', 'DTF'),
  ('en', 'app_params.general_dtf_help', 'Select your date & time format'),
  ('de', 'app_params.general_dtf_help', 'Wählen Sie Ihr Datums- und Zeitformat'),
  ('en', 'app_params.general_dtf_opt_ddmmyyyy', 'DD.MM.YYYY - HH:MM'),
  ('de', 'app_params.general_dtf_opt_ddmmyyyy', 'DD.MM.YYYY - HH:MM'),
  ('en', 'app_params.general_dtf_opt_ddmmyy', 'DD.MM.YY - HH:MM'),
  ('de', 'app_params.general_dtf_opt_ddmmyy', 'DD.MM.YY - HH:MM'),
  ('en', 'app_params.general_dtf_opt_mmddyyyy', 'MM/DD/YYYY - HH:MM'),
  ('de', 'app_params.general_dtf_opt_mmddyyyy', 'MM/DD/YYYY - HH:MM'),
  ('en', 'app_params.general_dtf_opt_mmddyy', 'MM/DD/YY - HH:MM'),
  ('de', 'app_params.general_dtf_opt_mmddyy', 'MM/DD/YY - HH:MM')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
