-- Shifts settings: SPC (Shift planning capacity) + combined tab legend (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.shifts_tab_legend', 'SLR: Shift login recognition. SPC: Shift planning capacity — maximum share of each shift (as a percentage) that may be used for planned work, such as work generated from Work Planning.'),
  ('de', 'app_params.shifts_tab_legend', 'SLR: Schicht-Anmeldeerkennung. SPC: Schichtplanungskapazität — höchster Anteil jeder Schicht (in Prozent), der für geplante Arbeit genutzt werden darf, z. B. für Aufträge aus der Wartungsplanung.'),
  ('en', 'app_params.shifts_spc_heading', 'SPC — Shift planning capacity'),
  ('de', 'app_params.shifts_spc_heading', 'SPC — Schichtplanungskapazität'),
  ('en', 'app_params.shifts_spc_help', 'Sets how much of each shift (0–100%) can be allocated to planned tasks—for example, preventive or planned work orders created from Work Planning. At 100%, the full shift duration may be used; lower values reserve part of the shift for other activities.'),
  ('de', 'app_params.shifts_spc_help', 'Legt fest, wie viel von jeder Schicht (0–100 %) für geplante Aufgaben vorgesehen werden kann—z. B. für geplante oder vorbeugende Arbeitsaufträge aus der Wartungsplanung. Bei 100 % kann die gesamte Schichtdauer genutzt werden; niedrigere Werte reservieren einen Teil der Schicht für andere Tätigkeiten.'),
  ('en', 'app_params.shifts_spc_label', 'Capacity'),
  ('de', 'app_params.shifts_spc_label', 'Kapazität')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
