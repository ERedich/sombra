-- i18n strings for the new Assignments column, bulk documents dialog and
-- per-row EntityDocumentsCell in document-enabled apps (asset-management,
-- employees, work-orders / monitoring).

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  -- Per-row Assignments column (folder + count)
  ('en', 'documents.col_assignments', 'Assignments'),
  ('de', 'documents.col_assignments', 'Zuweisungen'),
  ('en', 'documents.cell_aria', 'Documents ({{count}})'),
  ('de', 'documents.cell_aria', 'Dokumente ({{count}})'),
  ('en', 'documents.cell_title_none', 'No documents — click to upload'),
  ('de', 'documents.cell_title_none', 'Keine Dokumente – zum Hochladen klicken'),
  ('en', 'documents.cell_title_some', '{{count}} documents'),
  ('de', 'documents.cell_title_some', '{{count}} Dokumente'),

  -- Bulk toolbar button (documents across filtered rows)
  ('en', 'documents.bulk_button_aria', 'Documents across the filtered table'),
  ('de', 'documents.bulk_button_aria', 'Dokumente der gefilterten Tabelle'),
  ('en', 'documents.bulk_button_title', '{{count}} documents across {{rows}} rows'),
  ('de', 'documents.bulk_button_title', '{{count}} Dokumente in {{rows}} Zeilen'),
  ('en', 'documents.bulk_button_disabled_hint', 'No rows to inspect'),
  ('de', 'documents.bulk_button_disabled_hint', 'Keine Zeilen zum Prüfen'),

  -- Bulk dialog
  ('en', 'documents.bulk_dialog_title', 'Documents (filtered table)'),
  ('de', 'documents.bulk_dialog_title', 'Dokumente (gefilterte Tabelle)'),
  ('en', 'documents.bulk_dialog_subtitle', 'All documents attached to the {{rows}} currently visible rows. Upload from the row''s documents cell.'),
  ('de', 'documents.bulk_dialog_subtitle', 'Alle Dokumente, die den {{rows}} sichtbaren Zeilen zugeordnet sind. Neue Dateien über die Dokumentzelle der Zeile hochladen.'),

  -- Extra "Entity" column shown inside the bulk dialog
  ('en', 'documents.col_entity', 'Record'),
  ('de', 'documents.col_entity', 'Datensatz')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
