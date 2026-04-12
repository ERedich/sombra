-- Shift planner View / Planning tabs (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.tab_view', 'View'),
  ('de', 'shift_planner.tab_view', 'Ansicht'),
  ('en', 'shift_planner.tab_planning', 'Planning'),
  ('de', 'shift_planner.tab_planning', 'Planung'),
  ('en', 'shift_planner.view_readonly_hint', 'Read-only. Use Planning to assign shifts or change presence.'),
  ('de', 'shift_planner.view_readonly_hint', 'Nur Anzeige. In Planung können Sie zuweisen und Anwesenheit ändern.'),
  ('en', 'shift_planner.view_empty_slot', 'No assignments'),
  ('de', 'shift_planner.view_empty_slot', 'Keine Zuweisungen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
