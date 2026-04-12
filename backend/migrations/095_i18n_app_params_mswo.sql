-- MSWO + updated legend + work orders start tooltip (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_abbr_legend', 'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders.'),
  ('de', 'app_params.wo_abbr_legend', 'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge.'),
  ('en', 'app_params.wo_mswo_heading', 'MSWO — Multiple started work orders'),
  ('de', 'app_params.wo_mswo_heading', 'MSWO — Mehrere gestartete Aufträge'),
  ('en', 'app_params.wo_mswo_explain', 'When set to Yes, a user may start another work order while already having one in Started or Continued status (as an assigned employee). When No, only one such work order is allowed at a time.'),
  ('de', 'app_params.wo_mswo_explain', 'Bei Ja darf ein Benutzer einen weiteren Auftrag starten, während bereits einer in Status Gestartet oder Fortgesetzt läuft (als zugewiesener Mitarbeiter). Bei Nein ist nur einer gleichzeitig erlaubt.'),
  ('en', 'wo.start_disabled_mswo', 'Finish or hold your other started work order first (only one active started order allowed).'),
  ('de', 'wo.start_disabled_mswo', 'Beenden oder warten Sie zuerst den anderen gestarteten Auftrag (nur ein aktiver gestarteter Auftrag erlaubt).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
