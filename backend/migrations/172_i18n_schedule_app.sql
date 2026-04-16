-- Schedule app (maintenance) — nav + UI strings (en + de).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'nav.schedule', 'Schedule'),
  ('de', 'nav.schedule', 'Terminplan'),

  ('en', 'schedule.title', 'Schedule'),
  ('de', 'schedule.title', 'Terminplan'),

  ('en', 'schedule.prev_month', 'Previous month'),
  ('de', 'schedule.prev_month', 'Vorheriger Monat'),

  ('en', 'schedule.next_month', 'Next month'),
  ('de', 'schedule.next_month', 'Nächster Monat'),

  ('en', 'schedule.today', 'Today'),
  ('de', 'schedule.today', 'Heute'),

  ('en', 'schedule.jump_month', 'Go to month…'),
  ('de', 'schedule.jump_month', 'Monat wählen…'),

  ('en', 'schedule.load_fail', 'Could not load work orders.'),
  ('de', 'schedule.load_fail', 'Arbeitsaufträge konnten nicht geladen werden.'),

  ('en', 'schedule.more_chips', '+{{count}} more'),
  ('de', 'schedule.more_chips', '+{{count}} weitere'),

  ('en', 'schedule.bar_overflow', '+{{count}} more in this week (multi-day)'),
  ('de', 'schedule.bar_overflow', '+{{count}} weitere in dieser Woche (mehrtägig)')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
