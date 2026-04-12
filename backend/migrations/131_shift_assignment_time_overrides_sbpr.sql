-- Optional wall-clock overrides per assignment (when shift_bound_projection is off).
ALTER TABLE shift_assignments
  ADD COLUMN IF NOT EXISTS override_time_start TIME NULL,
  ADD COLUMN IF NOT EXISTS override_time_end TIME NULL;

COMMENT ON COLUMN shift_assignments.override_time_start IS 'When set with override_time_end, replaces shift times for this assignment (unbound planner).';
COMMENT ON COLUMN shift_assignments.override_time_end IS 'When set with override_time_start, replaces shift times for this assignment (unbound planner).';

-- SBPR default Y: align scheduled blocks with shift definition (shift_bound_projection true).
UPDATE app_settings
SET value_json = COALESCE(value_json, '{}'::jsonb) || '{"shift_bound_projection": true}'::jsonb
WHERE key = 'shifts';

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.shifts_sbpr_heading', 'Align scheduled blocks with shift hours'),
  ('de', 'app_params.shifts_sbpr_heading', 'Geplante Blöcke an Schichtzeiten ausrichten'),
  ('en', 'app_params.shifts_sbpr_help', 'When Yes, the shift planner keeps scheduled blocks on shift-defined times and dates. When No, users with scheduled assignments can drag blocks along the time axis in the Detailed planner (custom start/end).'),
  ('de', 'app_params.shifts_sbpr_help', 'Bei Ja bleiben geplante Blöcke an den Schichtzeiten und -tagen. Bei Nein können Nutzer geplante Zuweisungen in der Detailansicht entlang der Zeitachse verschieben (eigene Start-/Endzeiten).'),
  ('en', 'home.tac_label', 'TAC — total available capacity (today)'),
  ('de', 'home.tac_label', 'TAC — verfügbare Kapazität heute (Summe)'),
  ('en', 'home.tach_label', 'TACh — total available capacity (this hour)'),
  ('de', 'home.tach_label', 'TACh — verfügbare Kapazität in dieser Stunde'),
  ('en', 'home.shift_capacity_hours', '{{hours}} h'),
  ('de', 'home.shift_capacity_hours', '{{hours}} h'),
  ('en', 'home.shift_capacity_no_site', 'Select a working site to see capacity.'),
  ('de', 'home.shift_capacity_no_site', 'Wählen Sie einen Arbeitsstandort für die Kapazität.'),
  ('en', 'shift_planner.unbound_time_drag_hint', 'Drag the block horizontally to change times (custom hours allowed).'),
  ('de', 'shift_planner.unbound_time_drag_hint', 'Block horizontal ziehen, um die Zeiten zu ändern (eigene Stunden möglich).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
