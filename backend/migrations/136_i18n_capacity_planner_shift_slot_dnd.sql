-- Capacity Planner: assign by dragging a shift-day utilization cell (not the employee name column).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.shift_slot_drag_hint', 'Drag onto a work order bar to assign planned hours for this employee on this day'),
  ('de', 'capacity_planner.shift_slot_drag_hint', 'Auf einen Arbeitsauftragsbalken ziehen, um geplante Stunden für diesen Mitarbeitenden an diesem Tag zuzuweisen'),

  ('en', 'capacity_planner.wo_move_tooltip', 'Drag onto the timeline to change the planned day (UTC time of day is kept). Drop a shift-day cell from the grid here to assign planned hours.'),
  ('de', 'capacity_planner.wo_move_tooltip', 'Ziehen Sie auf die Zeitachse, um den Plantag zu ändern (UTC-Uhrzeit bleibt). Ziehen Sie eine Schicht-Tag-Zelle aus dem Raster hierher, um geplante Stunden zuzuweisen.'),

  ('en', 'capacity_planner.wo_bar_tooltip', 'Drag onto the timeline to change the planned day. Drop a shift-day utilization cell here to assign.'),
  ('de', 'capacity_planner.wo_bar_tooltip', 'Ziehen Sie auf die Zeitachse für den Plantag. Ziehen Sie eine Schicht-Tag-Zelle aus der Auslastung hierher zum Zuweisen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
