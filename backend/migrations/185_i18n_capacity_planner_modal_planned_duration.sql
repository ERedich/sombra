-- Capacity planner: WO modal label uses planned duration wording.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.modal_wo_duration', 'Planned duration'),
  ('de', 'capacity_planner.modal_wo_duration', 'Geplante Dauer')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
