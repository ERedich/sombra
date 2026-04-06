-- UAA also auto-assigns on feedback (all entry employees), not only on start.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_uaa_explain', 'When SWB is No: on start, and when submitting feedback, employees referenced in feedback entries are automatically added to this work order''s assigned list if they are not already (same site and workgroup rules as manual assignment).'),
  ('de', 'app_params.wo_uaa_explain', 'Wenn SWB Nein ist: Beim Start und beim Feedback werden in den Feedback-Einträgen genannte Mitarbeiter bei Bedarf automatisch den Zugewiesenen hinzugefügt (gleiche Site- und Arbeitsgruppenregeln wie bei manueller Zuweisung).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
