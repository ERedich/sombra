-- Capacity Planner: tooltip for double-click to Shift Planner detailed day.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.shift_cell_open_shift_planner', 'Double-click: Shift Planner — day details'),
  ('de', 'capacity_planner.shift_cell_open_shift_planner', 'Doppelklick: Schichtplaner — Tagesdetail')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
