INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'search_panel.select_values', 'Select values'),
  ('de', 'search_panel.select_values', 'Werte auswaehlen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
