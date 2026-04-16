-- Capacity planner day Gantt: WO move snaps to 15-minute UTC steps.

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'capacity_planner.day_timeline_wo_move_tooltip', 'Drag onto the timeline to set planned start in 15-minute UTC steps (grid and header show hours and :00 / :15 / :30 / :45).'),
  ('de', 'capacity_planner.day_timeline_wo_move_tooltip', 'Auf die Zeitachse ziehen, um den Planstart in 15-Minuten-Schritten UTC zu setzen (Raster und Kopfzeile: Stunden und :00 / :15 / :30 / :45).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
