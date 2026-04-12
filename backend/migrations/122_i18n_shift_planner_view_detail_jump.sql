-- View tab: date header opens Detailed planner for that day (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.view_day_open_detailed', 'Open detailed planner for this day'),
  ('de', 'shift_planner.view_day_open_detailed', 'Tagesdetail für diesen Tag öffnen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
