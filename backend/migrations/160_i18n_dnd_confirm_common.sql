-- Shared DnD confirmation copy + capacity/shift planner specific labels.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'common.dnd_confirm_move_header', 'Confirm move'),
  ('de', 'common.dnd_confirm_move_header', 'Verschieben bestätigen'),
  ('en', 'common.dnd_confirm_move_msg', 'Are you sure you want to move {{subject}} from {{from}} to {{to}}?'),
  ('de', 'common.dnd_confirm_move_msg', 'Möchten Sie {{subject}} wirklich von {{from}} nach {{to}} verschieben?'),
  ('en', 'capacity_planner.dnd_from_capacity_slot', 'Capacity day cell'),
  ('de', 'capacity_planner.dnd_from_capacity_slot', 'Kapazitäts-Tageszelle'),
  ('en', 'shift_planner.modal_guidelines_drag_drop_body', 'While you drag an assignment, valid drop areas show a dashed outline. When the pointer is over a valid target, the outline becomes a solid green line. After you drop, bars ease into their new position. Before any move is saved, a confirmation dialog asks (for example): are you sure you want to move this assignment from the source cell to the target cell? Cancel leaves everything unchanged.'),
  ('de', 'shift_planner.modal_guidelines_drag_drop_body', 'Während Sie eine Zuweisung ziehen, zeigen gültige Ablagebereiche eine gestrichelte Umrandung. Liegt der Zeiger über einem gültigen Ziel, wird die Umrandung grün und durchgezogen. Nach dem Ablegen gleiten die Balken mit sanfter Beschleunigung an die neue Position. Bevor eine Verschiebung gespeichert wird, erscheint ein Bestätigungsdialog (z. B.: Möchten Sie diese Zuweisung wirklich von der Quell- zur Zielzelle verschieben?). Abbrechen lässt alles unverändert.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
