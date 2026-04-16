-- Schedule app — i18n for multi-week WO bar continuation accessibility labels.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'schedule.bar_continues_from_prev_week', 'continues from previous week'),
  ('de', 'schedule.bar_continues_from_prev_week', 'läuft aus Vorwoche weiter'),

  ('en', 'schedule.bar_continues_to_next_week', 'continues into next week'),
  ('de', 'schedule.bar_continues_to_next_week', 'läuft in Folgewoche weiter')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
