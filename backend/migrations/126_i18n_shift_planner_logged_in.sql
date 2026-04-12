-- Present row caption: "Logged:" before date-time (SLR / manual present).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.started_at', 'Logged'),
  ('de', 'shift_planner.started_at', 'Erfasst')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
