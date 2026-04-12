INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'wp.col_wo_gen_countdown', 'Days to WO generation'),
  ('de', 'wp.col_wo_gen_countdown', 'Tage bis WO-Generierung')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
