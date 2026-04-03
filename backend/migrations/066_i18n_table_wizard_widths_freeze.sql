INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'table_wizard.freeze_help', 'Frozen columns stay visible when you scroll horizontally. The table uses a fixed scroll area when freezing is enabled.'),
  ('en', 'table_wizard.freeze_first_n', 'Freeze first columns (left)'),
  ('en', 'table_wizard.col_widths_section', 'Column widths (px)'),
  ('en', 'table_wizard.clear_col_widths', 'Clear widths'),
  ('en', 'table_wizard.col_width_px', 'Width'),
  ('en', 'table_wizard.col_width_auto', 'Auto'),
  ('de', 'table_wizard.freeze_help', 'Eingefrorene Spalten bleiben beim horizontalen Scrollen sichtbar. Bei aktivem Einfrieren hat die Tabelle einen festen Scrollbereich.'),
  ('de', 'table_wizard.freeze_first_n', 'Erste Spalten links einfrieren'),
  ('de', 'table_wizard.col_widths_section', 'Spaltenbreiten (px)'),
  ('de', 'table_wizard.clear_col_widths', 'Breiten löschen'),
  ('de', 'table_wizard.col_width_px', 'Breite'),
  ('de', 'table_wizard.col_width_auto', 'Auto')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
