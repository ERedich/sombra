-- Calendar drag-and-drop hints and errors (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'calendar.dnd_hint', 'Drag to another day to reschedule; click to open.'),
  ('de', 'calendar.dnd_hint', 'Ziehen Sie auf einen anderen Tag zum Verschieben; Klick öffnet die Details.'),
  ('en', 'calendar.move_failed', 'Could not move this work order. Check permissions and plan dates.'),
  ('de', 'calendar.move_failed', 'Verschieben fehlgeschlagen. Prüfen Sie Berechtigungen und Plan-Daten.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
