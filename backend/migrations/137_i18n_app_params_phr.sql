-- PHR: planned hours restriction (Capacity Planner SPC bucket cap).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  (
    'en',
    'app_params.wo_abbr_legend',
    'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders. LEDD: Lock end date by duration. PSH: Plan start in history. TRR: Time registration requirement. PHR: Planned hours restriction (Capacity Planner). WOST: Status handling (colours).'
  ),
  (
    'de',
    'app_params.wo_abbr_legend',
    'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge. LEDD: Enddatum nach Dauer sperren. PSH: Planbeginn in der Vergangenheit. TRR: Zeiterfassungspflicht. PHR: Geplante-Stunden-Begrenzung (Kapazitätsplaner). WOST: Status-Darstellung (Farben).'
  ),
  ('en', 'app_params.phr_section', 'PHR — Planned hours restriction (Capacity Planner)'),
  ('de', 'app_params.phr_section', 'PHR — Geplante-Stunden-Begrenzung (Kapazitätsplaner)'),

  ('en', 'app_params.phr_question', 'Limit planned hours per employee per day to shift planning capacity (SPC)?'),
  ('de', 'app_params.phr_question', 'Geplante Stunden pro Mitarbeitendem und Tag auf Schichtplanungskapazität (SPC) begrenzen?'),

  ('en', 'app_params.phr_hint', 'Yes (default): total planned hours on a day cannot exceed the SPC bucket for that employee. No: allocations may exceed that bucket; work order duration and other rules still apply.'),
  ('de', 'app_params.phr_hint', 'Ja (Standard): Die Summe geplanter Stunden an einem Tag darf den SPC-Anteil für diesen Mitarbeitenden nicht überschreiten. Nein: Zuweisungen dürfen darüber liegen; Auftragsdauer und andere Regeln gelten weiter.'),

  ('en', 'capacity_planner.modal_hours_max_no_bucket', 'Shift bucket cap is not applied (PHR off). Maximum follows work order duration if set, otherwise a high input limit.'),
  ('de', 'capacity_planner.modal_hours_max_no_bucket', 'SPC-Bucket-Begrenzung greift nicht (PHR aus). Maximum richtet sich nach Auftragsdauer, sonst hohe Eingabegrenze.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
