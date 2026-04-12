-- PSH — Plan start in history (en + de). Legend extends LEDD migration text.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  (
    'en',
    'app_params.wo_abbr_legend',
    'SWB: Start work behaviour. UAA: User auto assign. MSWO: Multiple started work orders. LEDD: Lock end date by duration. TRR: Time registration requirement. WOST: Status handling (colours). PSH: Plan start in history.'
  ),
  (
    'de',
    'app_params.wo_abbr_legend',
    'SWB: Start-Verhalten. UAA: Benutzer automatisch zuweisen. MSWO: Mehrere gestartete Aufträge. LEDD: Enddatum nach Dauer sperren. TRR: Zeiterfassungspflicht. WOST: Status-Darstellung (Farben). PSH: Planbeginn in der Vergangenheit.'
  ),
  (
    'en',
    'app_params.wo_psh_heading',
    'PSH — Plan start in history'
  ),
  (
    'de',
    'app_params.wo_psh_heading',
    'PSH — Planbeginn in der Vergangenheit'
  ),
  (
    'en',
    'app_params.wo_psh_explain',
    'When Yes, planned start may be on a calendar day before today (UTC). When No, planned start must be today or later (UTC), except existing work orders keep an unchanged past start when saved.'
  ),
  (
    'de',
    'app_params.wo_psh_explain',
    'Bei Ja darf der geplante Beginn auf einen Kalendertag vor heute (UTC) fallen. Bei Nein muss der geplante Beginn heute oder später (UTC) sein; bestehende Aufträge behalten einen unveränderten vergangenen Beginn beim Speichern.'
  )
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
