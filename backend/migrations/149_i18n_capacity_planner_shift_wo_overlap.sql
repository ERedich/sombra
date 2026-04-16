-- Capacity Planner: toast when shift wall clock (UTC) does not overlap WO plan on allocation date.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.drop_shift_wo_time_mismatch', 'Planned work order time does not overlap this employee''s shift on that day (UTC).'),
  ('de', 'capacity_planner.drop_shift_wo_time_mismatch', 'Geplante Auftragszeit überlappt an diesem Tag (UTC) nicht mit der Schicht des Mitarbeitenden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
