INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'table_wizard.preset_default_aria', 'Default layout'),
  ('de', 'table_wizard.preset_default_aria', 'Standardlayout')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
