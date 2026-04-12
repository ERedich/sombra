INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.presence_legend_title', 'Presence'),
  ('de', 'shift_planner.presence_legend_title', 'Anwesenheit'),
  ('en', 'shift_planner.drag_reschedule_hint', 'Drag to another day (scheduled only)'),
  ('de', 'shift_planner.drag_reschedule_hint', 'Zu einem anderen Tag ziehen (nur geplant)'),
  ('en', 'shift_planner.move_assignment_fail', 'Could not move assignment.'),
  ('de', 'shift_planner.move_assignment_fail', 'Zuweisung konnte nicht verschoben werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

UPDATE ui_translations
SET value = 'Scheduled assignments can be dragged to another date in this row (View) or onto a day chip (Detailed) when the target is today or later. Use Planning to add/remove people or change presence.'
WHERE locale = 'en' AND msg_key = 'shift_planner.view_readonly_hint';

UPDATE ui_translations
SET value = 'Geplante Zuweisungen können in dieser Zeile auf ein anderes Datum (Ansicht) oder auf einen Tages-Chip (Detailliert) gezogen werden, wenn das Ziel heute oder später liegt. In Planung können Sie Personen hinzufügen/entfernen oder die Anwesenheit ändern.'
WHERE locale = 'de' AND msg_key = 'shift_planner.view_readonly_hint';
