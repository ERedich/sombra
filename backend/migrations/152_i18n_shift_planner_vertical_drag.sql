-- Shift planner View: drag across shifts + copy updates for hints.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.drag_reschedule_hint', 'Drag to another shift or day (scheduled only)'),
  ('de', 'shift_planner.drag_reschedule_hint', 'Zu einer anderen Schicht oder einem anderen Tag ziehen (nur geplant)')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

UPDATE ui_translations
SET value = 'Scheduled assignments can be dragged to another shift or day in View, or onto a day chip in Detailed, when the target is today or later. Use Planning to add/remove people or change presence.'
WHERE locale = 'en' AND msg_key = 'shift_planner.view_readonly_hint';

UPDATE ui_translations
SET value = 'Geplante Zuweisungen können in der Ansicht zu einer anderen Schicht oder einem anderen Tag gezogen werden, oder in Detailliert auf einen Tages-Chip, wenn das Ziel heute oder später liegt. In Planung können Sie Personen hinzufügen/entfernen oder die Anwesenheit ändern.'
WHERE locale = 'de' AND msg_key = 'shift_planner.view_readonly_hint';
