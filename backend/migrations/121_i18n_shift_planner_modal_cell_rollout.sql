-- Planning cell modal: roll out this shift’s assignees (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_rollout_title', 'Roll out to other dates'),
  ('de', 'shift_planner.modal_rollout_title', 'Auf andere Tage ausrollen'),
  ('en', 'shift_planner.modal_rollout_hint', 'Copy the people listed above for this shift to each matching day in the range (respecting weekday checkboxes and when this shift runs).'),
  ('de', 'shift_planner.modal_rollout_hint', 'Die oben genannten Personen für diese Schicht in jeden passenden Tag im Zeitraum kopieren (mit Wochentags-Filter und gültigen Schichttagen).'),
  ('en', 'shift_planner.modal_rollout_no_assignments', 'Add at least one assignment above before rolling out.'),
  ('de', 'shift_planner.modal_rollout_no_assignments', 'Fügen Sie mindestens eine Zuweisung oben hinzu, bevor Sie ausrollen.'),
  ('en', 'shift_planner.modal_rollout_assignees', '{{count}} assignee(s) will be copied.'),
  ('de', 'shift_planner.modal_rollout_assignees', '{{count}} Zuweisung(en) werden kopiert.'),
  ('en', 'shift_planner.modal_rollout_apply', 'Apply to range'),
  ('de', 'shift_planner.modal_rollout_apply', 'Auf Zeitraum anwenden')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
