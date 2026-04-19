INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'monitoring.stale_pill', 'Updates available'),
  ('de', 'monitoring.stale_pill', 'Aktualisierungen verfuegbar'),
  ('en', 'monitoring.stale_pill_hint', 'New or updated work orders did not fit the current view. Reload to see them.'),
  ('de', 'monitoring.stale_pill_hint', 'Neue oder geaenderte Auftraege passen nicht in die aktuelle Ansicht. Neu laden, um sie zu sehen.'),
  ('en', 'monitoring.stale_pill_refresh', 'Refresh'),
  ('de', 'monitoring.stale_pill_refresh', 'Neu laden'),
  ('en', 'monitoring.stale_pill_dismiss', 'Dismiss'),
  ('de', 'monitoring.stale_pill_dismiss', 'Verwerfen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
