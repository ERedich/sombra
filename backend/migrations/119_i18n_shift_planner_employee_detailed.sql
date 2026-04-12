-- Shift planner: by-employee tab, week navigation, detailed day timeline (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.prev_week', 'Previous week'),
  ('de', 'shift_planner.prev_week', 'Vorherige Woche'),
  ('en', 'shift_planner.next_week', 'Next week'),
  ('de', 'shift_planner.next_week', 'Nächste Woche'),
  ('en', 'shift_planner.tab_by_employee', 'By employee'),
  ('de', 'shift_planner.tab_by_employee', 'Nach Mitarbeitenden'),
  ('en', 'shift_planner.tab_detailed', 'Detailed planner'),
  ('de', 'shift_planner.tab_detailed', 'Tagesdetail'),
  ('en', 'shift_planner.by_employee_hint', 'Read-only roster by person. Edit assignments under Planning.'),
  ('de', 'shift_planner.by_employee_hint', 'Nur Anzeige nach Person. Zuweisungen bearbeiten Sie unter Planung.'),
  ('en', 'shift_planner.detailed_hint', 'Select a day to see shifts on a 24-hour scale. Night shifts that cross midnight show from start until midnight on the assignment date; the rest appears only if there is an assignment on the following day.'),
  ('de', 'shift_planner.detailed_hint', 'Wählen Sie einen Tag, um Schichten auf einer 24-Stunden-Skala zu sehen. Nachtschichten über Mitternacht: am Zuweisungstag von Start bis 24:00; der frühe Teil am Folgetag nur bei Zuweisung an diesem Tag.'),
  ('en', 'shift_planner.detailed_empty', 'No assignments on this day.'),
  ('de', 'shift_planner.detailed_empty', 'Keine Zuweisungen an diesem Tag.'),
  ('en', 'shift_planner.column_employee', 'Employee'),
  ('de', 'shift_planner.column_employee', 'Mitarbeitende/r')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
