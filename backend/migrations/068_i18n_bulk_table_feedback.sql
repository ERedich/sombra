INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'common.bulk_table_rows_busy', 'Updating many table rows, this can take some time.'),
  ('en', 'common.table_layout_applying', 'Applying table layout, this may take a moment.'),
  ('de', 'common.bulk_table_rows_busy', 'Viele Tabellenzeilen werden aktualisiert, das kann etwas dauern.'),
  ('de', 'common.table_layout_applying', 'Tabellenlayout wird angewendet, bitte kurz warten.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
