INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.unbound_time_drag_invalid', 'Could not place the block at that time. Keep the same duration within the day.'),
  ('de', 'shift_planner.unbound_time_drag_invalid', 'Block konnte so nicht platziert werden. Dauer innerhalb des Tages beibehalten.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
