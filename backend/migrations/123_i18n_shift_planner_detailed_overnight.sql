-- Detailed planner: overnight continuation label + updated hint (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.detailed_overnight_continuation', 'continued from previous day'),
  ('de', 'shift_planner.detailed_overnight_continuation', 'Fortsetzung vom Vortag'),
  ('en', 'shift_planner.detailed_hint', 'Select a day to see shifts on a 24-hour scale. Overnight shifts appear in two parts: from start time until midnight on the assignment start date, and from midnight until end time when you open the next calendar day.'),
  ('de', 'shift_planner.detailed_hint', 'Wählen Sie einen Tag für die 24-Stunden-Ansicht. Nachtschichten erscheinen in zwei Teilen: am Zuweisungstag von Start bis Mitternacht und am Folgetag von Mitternacht bis Endzeit.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
