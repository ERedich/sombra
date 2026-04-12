-- LEDD: lock plan end to plan_start + duration (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_abbr_legend', 'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders. LEDD: Lock end date by duration. TRR: Time registration requirement. WOST: Status handling (colours).'),
  ('de', 'app_params.wo_abbr_legend', 'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge. LEDD: Enddatum nach Dauer sperren. TRR: Zeiterfassungspflicht. WOST: Status-Darstellung (Farben).'),
  ('en', 'app_params.wo_ledd_heading', 'LEDD — Lock end date by duration'),
  ('de', 'app_params.wo_ledd_heading', 'LEDD — Enddatum nach Dauer sperren'),
  ('en', 'app_params.wo_ledd_explain', 'When Yes, planned end is always plan start plus duration and cannot be edited separately. When No, planned end can be set freely as long as it is not before plan start.'),
  ('de', 'app_params.wo_ledd_explain', 'Bei Ja ist das geplante Ende immer Planbeginn plus Dauer und nicht separat änderbar. Bei Nein kann das geplante Ende frei gesetzt werden, sofern es nicht vor dem Planbeginn liegt.'),
  ('en', 'wo.err_plan_end_before_start', 'Planned end must be on or after planned start.'),
  ('de', 'wo.err_plan_end_before_start', 'Das geplante Ende muss am oder nach dem geplanten Beginn liegen.'),
  ('en', 'wo.plan_end_free_hint', 'You can set planned end independently of duration (not before plan start).'),
  ('de', 'wo.plan_end_free_hint', 'Sie können das geplante Ende unabhängig von der Dauer setzen (nicht vor dem Planbeginn).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
