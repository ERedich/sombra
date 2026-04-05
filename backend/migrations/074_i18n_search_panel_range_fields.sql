INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'search_panel.from_placeholder', 'From'),
  ('de', 'search_panel.from_placeholder', 'Von'),
  ('en', 'search_panel.to_placeholder', 'To'),
  ('de', 'search_panel.to_placeholder', 'Bis')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
