-- Day Gantt tooltip: header shows hours only (15 min snap unchanged).

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'capacity_planner.day_timeline_wo_move_tooltip', 'Drag onto the timeline to set planned start in 15-minute UTC steps (hour labels 00–23; fine grid every 15 minutes).'),
  ('de', 'capacity_planner.day_timeline_wo_move_tooltip', 'Auf die Zeitachse ziehen, um den Planstart in 15-Minuten-Schritten UTC zu setzen (Stunden 00–23; feines Raster alle 15 Minuten).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
