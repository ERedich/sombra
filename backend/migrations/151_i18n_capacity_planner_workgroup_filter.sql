-- Capacity Planner: workgroup filter label.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.workgroup_filter', 'Workgroup'),
  ('de', 'capacity_planner.workgroup_filter', 'Arbeitsgruppe'),

  ('en', 'capacity_planner.workgroup_all', 'All workgroups'),
  ('de', 'capacity_planner.workgroup_all', 'Alle Arbeitsgruppen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
