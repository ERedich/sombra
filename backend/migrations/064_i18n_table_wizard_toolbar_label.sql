INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'table_wizard.toolbar_label', 'Table'),
  ('de', 'table_wizard.toolbar_label', 'Tabelle')
ON CONFLICT (locale, msg_key) DO NOTHING;
