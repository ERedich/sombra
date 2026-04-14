-- Work orders table: combined first column header (key + name + asset).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'wo.col_wo_primary', 'Work order'),
  ('de', 'wo.col_wo_primary', 'Arbeitsauftrag')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
