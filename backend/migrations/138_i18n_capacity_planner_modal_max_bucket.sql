-- Capacity allocation max is shift/SPC bucket only (not work order duration).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'app_params.phr_hint', 'Yes (default): total planned hours on a day cannot exceed the SPC bucket for that employee. No: allocations may exceed that bucket (other validation still applies).'),
  ('de', 'app_params.phr_hint', 'Ja (Standard): Die Summe geplanter Stunden an einem Tag darf den SPC-Anteil für diesen Mitarbeitenden nicht überschreiten. Nein: Zuweisungen dürfen darüber liegen (sonstige Prüfungen bleiben).'),
  ('en', 'capacity_planner.modal_hours_max', 'Maximum for this edit: {{max}} h (remaining shift planning capacity for this employee on this day).'),
  ('de', 'capacity_planner.modal_hours_max', 'Maximum für diese Eingabe: {{max}} h (verbleibende Schichtplanungskapazität für diesen Mitarbeitenden an diesem Tag).'),

  ('en', 'capacity_planner.modal_hours_max_no_bucket', 'PHR is off: a high input limit applies; shift bucket is not enforced on save.'),
  ('de', 'capacity_planner.modal_hours_max_no_bucket', 'PHR aus: hohe Eingabegrenze; der SPC-Bucket wird beim Speichern nicht erzwungen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
