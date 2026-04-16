-- Capacity Planner: Gantt WO label column (key / name / asset row labels).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.gantt_wo_key_label', 'WO key'),
  ('de', 'capacity_planner.gantt_wo_key_label', 'WO-Nr.'),

  ('en', 'capacity_planner.gantt_wo_name_label', 'WO name'),
  ('de', 'capacity_planner.gantt_wo_name_label', 'Kurztext'),

  ('en', 'capacity_planner.gantt_wo_asset_label', 'WO asset'),
  ('de', 'capacity_planner.gantt_wo_asset_label', 'Anlage')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
