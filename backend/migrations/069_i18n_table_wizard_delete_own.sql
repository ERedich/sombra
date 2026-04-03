INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'table_wizard.delete_own_header', 'Delete layout'),
  ('en', 'table_wizard.delete_own_msg', 'Delete layout "{{key}}"? This cannot be undone.'),
  ('en', 'table_wizard.delete_own_aria', 'Delete layout {{key}}'),
  ('en', 'table_wizard.preset_default_badge', '(default)'),
  ('en', 'table_wizard.save_to_existing_help', 'Overwrite replaces the saved layout with your current table settings. You can pick any of your layouts, even while viewing a shared layout.'),
  ('de', 'table_wizard.delete_own_header', 'Layout löschen'),
  ('de', 'table_wizard.delete_own_msg', 'Layout „{{key}}“ löschen? Dies kann nicht rückgängig gemacht werden.'),
  ('de', 'table_wizard.delete_own_aria', 'Layout {{key}} löschen'),
  ('de', 'table_wizard.preset_default_badge', '(Standard)'),
  ('de', 'table_wizard.save_to_existing_help', 'Überschreiben ersetzt das gespeicherte Layout durch Ihre aktuellen Tabelleneinstellungen. Sie können eines Ihrer Layouts wählen, auch während ein geteiltes Layout angezeigt wird.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
