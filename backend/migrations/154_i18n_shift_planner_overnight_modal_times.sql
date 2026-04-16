-- Overnight shift: modal times hint + zero-duration validation string.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_times_zero_duration', 'Start and end time must not be identical.'),
  ('de', 'shift_planner.modal_times_zero_duration', 'Beginn und Ende dürfen nicht identisch sein.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

UPDATE ui_translations
SET value = 'End time is when the person leaves (often the next morning). For a night shift you can set an end earlier than the start on the clock (e.g. 22:00–05:30).'
WHERE locale = 'en' AND msg_key = 'shift_planner.modal_times_overnight_hint';

UPDATE ui_translations
SET value = 'Ende ist die Gehzeit (oft am nächsten Morgen). Bei Nachtschicht darf die Uhrzeit des Endes vor dem Beginn liegen (z. B. 22:00–05:30).'
WHERE locale = 'de' AND msg_key = 'shift_planner.modal_times_overnight_hint';
