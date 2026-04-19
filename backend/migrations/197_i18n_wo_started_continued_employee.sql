-- i18n for the two new read-only WO fields surfaced on the General tab of
-- the WO / Monitoring modal and the Monitoring table columns.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'wo.field_started_employee', 'Started by employee'),
  ('de', 'wo.field_started_employee', 'Gestartet von'),
  ('en', 'wo.field_continued_employee', 'Continued by employee'),
  ('de', 'wo.field_continued_employee', 'Fortgesetzt von'),
  ('en', 'wo.col_started_employee', 'Started by'),
  ('de', 'wo.col_started_employee', 'Gestartet von'),
  ('en', 'wo.col_continued_employee', 'Continued by'),
  ('de', 'wo.col_continued_employee', 'Fortgesetzt von'),
  -- MW template editor: labels for the new WO general-tab layout slots.
  ('en', 'mwte.wo_field_started_employee', 'Started by employee'),
  ('de', 'mwte.wo_field_started_employee', 'Gestartet von'),
  ('en', 'mwte.wo_field_continued_employee', 'Continued by employee'),
  ('de', 'mwte.wo_field_continued_employee', 'Fortgesetzt von')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
