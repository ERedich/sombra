-- Work order calendar (maintenance) UI strings (en + de).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'nav.calendar', 'Calendar'),
  ('de', 'nav.calendar', 'Kalender'),

  ('en', 'calendar.title', 'Work order calendar'),
  ('de', 'calendar.title', 'Arbeitsauftragskalender'),

  ('en', 'calendar.subtitle', 'Planned work orders by day for the selected month (local dates). Each badge opens the work order.'),
  ('de', 'calendar.subtitle', 'Geplante Arbeitsaufträge nach Tag für den gewählten Monat (Ortszeit). Jeder Badge öffnet den Arbeitsauftrag.'),

  ('en', 'calendar.reload', 'Reload'),
  ('de', 'calendar.reload', 'Aktualisieren'),

  ('en', 'calendar.load_fail', 'Could not load work orders.'),
  ('de', 'calendar.load_fail', 'Arbeitsaufträge konnten nicht geladen werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
