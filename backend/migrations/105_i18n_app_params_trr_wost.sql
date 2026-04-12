-- TRR, WOST, updated legend, feedback error when Done without time (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.wo_abbr_legend', 'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders. TRR: Time registration requirement. WOST: Status handling (colours).'),
  ('de', 'app_params.wo_abbr_legend', 'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge. TRR: Zeiterfassungspflicht. WOST: Status-Darstellung (Farben).'),
  ('en', 'app_params.wo_trr_heading', 'TRR — Time registration requirement'),
  ('de', 'app_params.wo_trr_heading', 'TRR — Zeiterfassungspflicht'),
  ('en', 'app_params.wo_trr_explain', 'When set to Yes, a work order cannot be set to Done until at least some time has been registered (feedback hours). When No, Done is allowed without registered time.'),
  ('de', 'app_params.wo_trr_explain', 'Bei Ja kann ein Auftrag erst auf Erledigt gesetzt werden, wenn mindestens etwas Zeit erfasst wurde (Stunden im Feedback). Bei Nein ist Erledigt auch ohne erfasste Zeit möglich.'),
  ('en', 'app_params.wo_wost_heading', 'WOST — Status handling'),
  ('de', 'app_params.wo_wost_heading', 'WOST — Status-Darstellung'),
  ('en', 'app_params.wo_wost_explain', 'When set to Yes, you can choose display colours for each work order status below. When No, the default status colours are used.'),
  ('de', 'app_params.wo_wost_explain', 'Bei Ja können Sie unten Anzeigefarben für jeden Auftragsstatus wählen. Bei Nein gelten die Standardfarben.'),
  ('en', 'app_params.wo_wost_colours_heading', 'Status colours'),
  ('de', 'app_params.wo_wost_colours_heading', 'Status-Farben'),
  ('en', 'wo.feedback_done_requires_time', 'Register time (hours) before marking this work order as Done.'),
  ('de', 'wo.feedback_done_requires_time', 'Erfassen Sie Zeit (Stunden), bevor Sie den Auftrag als Erledigt markieren.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
