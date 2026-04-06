-- Start button tooltips: workgroup + assignment clarity.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'wo.start_disabled_not_in_workgroup', 'Your linked employee is not a member of this work order''s workgroup.'),
  ('de', 'wo.start_disabled_not_in_workgroup', 'Ihr verknüpfter Mitarbeiter gehört nicht zur Arbeitsgruppe dieses Auftrags.'),
  ('en', 'wo.start_disabled_must_assign', 'You must be assigned to this work order to start or stop work on it.'),
  ('de', 'wo.start_disabled_must_assign', 'Sie müssen diesem Auftrag zugewiesen sein, um ihn zu starten oder zu stoppen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
