-- Calendar toolbar + updated subtitle (en + de).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'calendar.today', 'Today'),
  ('de', 'calendar.today', 'Heute'),

  ('en', 'calendar.prev_month', 'Previous month'),
  ('de', 'calendar.prev_month', 'Voriger Monat'),

  ('en', 'calendar.next_month', 'Next month'),
  ('de', 'calendar.next_month', 'Nächster Monat'),

  ('en', 'calendar.subtitle', 'Full-month view of planned work orders (local dates). Badges scroll inside each day; click a badge to open the work order.'),
  ('de', 'calendar.subtitle', 'Monatsübersicht geplanter Arbeitsaufträge (Ortszeit). Badges scrollen pro Tag; Klick öffnet den Arbeitsauftrag.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
