-- Rename "Duration" label to "Planned duration" (WO + WP) in EN/DE.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'wo.field_planned_duration_hours', 'Planned duration (hours)'),
  ('de', 'wo.field_planned_duration_hours', 'Geplante Dauer (Stunden)'),
  ('en', 'wp.field_planned_duration_hours', 'Planned duration (hours)'),
  ('de', 'wp.field_planned_duration_hours', 'Geplante Dauer (Stunden)'),
  ('en', 'wp.err_planned_duration', 'Planned duration must be a non-negative number (hours).'),
  ('de', 'wp.err_planned_duration', 'Geplante Dauer muss eine nicht-negative Zahl (Stunden) sein.'),
  ('en', 'wo.err_planned_duration', 'Planned duration must be a non-negative number (hours).'),
  ('de', 'wo.err_planned_duration', 'Geplante Dauer muss eine nicht-negative Zahl (Stunden) sein.'),
  ('en', 'mwte.wo_field_planned_duration', 'Planned duration (hours)'),
  ('de', 'mwte.wo_field_planned_duration', 'Geplante Dauer (Std.)')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
