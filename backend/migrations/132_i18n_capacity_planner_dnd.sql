-- Capacity Planner: DnD copy (WO move on timeline, employee onto WO pill).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.wo_move_tooltip', 'Drag onto the timeline to change the planned day (UTC time of day is kept). Drop an employee row here to assign planned hours.'),
  ('de', 'capacity_planner.wo_move_tooltip', 'Ziehen Sie auf die Zeitachse, um den Plantag zu ändern (UTC-Uhrzeit bleibt). Ziehen Sie eine Mitarbeiterzeile hierher, um geplante Stunden zuzuweisen.'),

  ('en', 'capacity_planner.wo_move_aria', 'Drag work order to reschedule along the timeline'),
  ('de', 'capacity_planner.wo_move_aria', 'Arbeitsauftrag ziehen, um entlang der Zeitachse zu planen'),

  ('en', 'capacity_planner.employee_drag_hint', 'Drag onto a work order bar to assign planned capacity for that day'),
  ('de', 'capacity_planner.employee_drag_hint', 'Auf einen Arbeitsauftragsbalken ziehen, um geplante Kapazität für diesen Tag zuzuweisen'),

  ('en', 'capacity_planner.drop_no_shift', 'This employee has no shift on the chosen date, or capacity cannot be assigned here.'),
  ('de', 'capacity_planner.drop_no_shift', 'Dieser Mitarbeiter hat am gewählten Datum keine Schicht, oder hier kann keine Kapazität zugewiesen werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

-- Retire obsolete keys (replaced by wo_move_*); update if still present from older seeds.
INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.wo_bar_tooltip', 'Drag onto the timeline to change the planned day. Drag an employee here to assign.'),
  ('de', 'capacity_planner.wo_bar_tooltip', 'Ziehen Sie auf die Zeitachse für den Plantag. Ziehen Sie einen Mitarbeiter hierher zum Zuweisen.'),
  ('en', 'capacity_planner.drag_assign_aria', 'Drag work order to reschedule'),
  ('de', 'capacity_planner.drag_assign_aria', 'Arbeitsauftrag zum Planen ziehen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
