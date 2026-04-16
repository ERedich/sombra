-- Capacity planner day view: single day filter + prev/next aria labels.

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'capacity_planner.day_filter', 'Day'),
  ('de', 'capacity_planner.day_filter', 'Tag'),

  ('en', 'capacity_planner.day_prev', 'Previous day'),
  ('de', 'capacity_planner.day_prev', 'Vorheriger Tag'),

  ('en', 'capacity_planner.day_next', 'Next day'),
  ('de', 'capacity_planner.day_next', 'Nächster Tag')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
