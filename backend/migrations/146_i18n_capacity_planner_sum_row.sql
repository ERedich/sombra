-- Capacity Planner: sum row label for employee utilization grid.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.row_sum_label', 'Σ All employees'),
  ('de', 'capacity_planner.row_sum_label', 'Σ Alle Mitarbeitenden')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
