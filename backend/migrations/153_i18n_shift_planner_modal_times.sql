-- Shift planner Planning modal: per-assignment time overrides.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_times_section', 'Times for this day'),
  ('de', 'shift_planner.modal_times_section', 'Zeiten für diesen Tag'),
  ('en', 'shift_planner.modal_times_start', 'Start'),
  ('de', 'shift_planner.modal_times_start', 'Beginn'),
  ('en', 'shift_planner.modal_times_end', 'End'),
  ('de', 'shift_planner.modal_times_end', 'Ende'),
  ('en', 'shift_planner.modal_times_save', 'Save times'),
  ('de', 'shift_planner.modal_times_save', 'Zeiten speichern'),
  ('en', 'shift_planner.modal_times_reset', 'Use shift default times'),
  ('de', 'shift_planner.modal_times_reset', 'Schicht-Standardzeiten verwenden'),
  ('en', 'shift_planner.modal_times_need_both', 'Set both start and end time.'),
  ('de', 'shift_planner.modal_times_need_both', 'Bitte Beginn und Ende setzen.'),
  ('en', 'shift_planner.modal_times_end_after_start', 'End time must be after start time on the same calendar day.'),
  ('de', 'shift_planner.modal_times_end_after_start', 'Ende muss am selben Kalendertag nach dem Beginn liegen.'),
  ('en', 'shift_planner.modal_times_scheduled_only', 'Times can be edited only while status is Scheduled.'),
  ('de', 'shift_planner.modal_times_scheduled_only', 'Zeiten sind nur im Status „Geplant“ editierbar.'),
  ('en', 'shift_planner.modal_times_projection_hint', 'Custom times are disabled while shift blocks are aligned with shift definitions (app parameters).'),
  ('de', 'shift_planner.modal_times_projection_hint', 'Eigene Zeiten sind deaktiviert, solange Schichtblöcke an die Schichtdefinition gebunden sind (App-Parameter).'),
  ('en', 'shift_planner.modal_times_overnight_hint', 'This shift crosses midnight; per-day time overrides are not supported here yet.'),
  ('de', 'shift_planner.modal_times_overnight_hint', 'Diese Schicht geht über Mitternacht; Tages-Overrides werden hier noch nicht unterstützt.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
