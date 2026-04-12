-- WOST: status colours are always configured (no Y/N); updated copy (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_abbr_legend', 'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders. TRR: Time registration requirement. WOST: Status colours.'),
  ('de', 'app_params.wo_abbr_legend', 'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge. TRR: Zeiterfassungspflicht. WOST: Status-Farben.'),
  ('en', 'app_params.wo_wost_explain', 'Choose display colours for each work order status. These colours are used on work order status badges across the app.'),
  ('de', 'app_params.wo_wost_explain', 'Legen Sie Anzeigefarben für jeden Auftragsstatus fest. Diese Farben werden für Status-Badges bei Arbeitsaufträgen verwendet.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
