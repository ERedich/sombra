-- Shift planner cell modal Guidelines: Visualization / drag-and-drop affordance.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_guidelines_visualization_title', 'Visualization'),
  ('de', 'shift_planner.modal_guidelines_visualization_title', 'Visualisierung'),
  ('en', 'shift_planner.modal_guidelines_drag_drop_body', 'While you drag an assignment, valid drop areas show a dashed outline. When the pointer is over a valid target, that outline becomes solid so you can see exactly where the assignment will land.'),
  ('de', 'shift_planner.modal_guidelines_drag_drop_body', 'Während Sie eine Zuweisung ziehen, zeigen gültige Ablagebereiche eine gestrichelte Umrandung. Liegt der Zeiger über einem gültigen Ziel, wird diese Umrandung durchgehend, damit Sie genau erkennen, wo die Zuweisung landet.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
