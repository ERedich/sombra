-- Capacity planner: inline Day/Week Gantt toggle + day picker label; week header opens day mode.

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'capacity_planner.toggle_timescale', 'Toggle Day / Week'),
  ('de', 'capacity_planner.toggle_timescale', 'Tag / Woche umschalten'),

  ('en', 'capacity_planner.gantt_day_picker', 'Gantt day (range)'),
  ('de', 'capacity_planner.gantt_day_picker', 'Gantt-Tag (Zeitraum)'),

  ('en', 'capacity_planner.day_timeline_open_aria', 'Switch to day view for {{date}}'),
  ('de', 'capacity_planner.day_timeline_open_aria', 'Tagesansicht für {{date}}')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
