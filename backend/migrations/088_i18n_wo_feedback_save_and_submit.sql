-- Save & Submit (feedback modal footer).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'wo.feedback_save_and_submit', 'Save & Submit'),
  ('de', 'wo.feedback_save_and_submit', 'Speichern und senden')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
