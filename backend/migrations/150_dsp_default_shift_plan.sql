-- DSP: Apply Default Shift Plan (global app_settings + i18n).

UPDATE app_settings
SET value_json =
  COALESCE(value_json, '{}'::jsonb)
  || '{"apply_default_shift_plan": false, "default_shift_time_start": "08:00:00", "default_shift_time_end": "17:00:00", "default_shift_weekdays": [1, 2, 3, 4, 5]}'::jsonb
WHERE key = 'shifts';

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.shifts_dsp_heading', 'DSP — Apply Default Shift Plan'),
  ('de', 'app_params.shifts_dsp_heading', 'DSP — Standard-Schichtplan anwenden'),
  ('en', 'app_params.shifts_dsp_confirm_header', 'Confirm'),
  ('de', 'app_params.shifts_dsp_confirm_header', 'Bestätigen'),
  (
    'en',
    'app_params.shifts_dsp_help',
    'When Yes, shift capacities come from the default work hours and weekdays below (one template per site). When No, use site-defined shifts. Turning Yes removes all existing shifts and assignments.'
  ),
  (
    'de',
    'app_params.shifts_dsp_help',
    'Bei Ja stammen Schichtkapazitäten aus den unten festgelegten Standard-Arbeitszeiten und -tagen (eine Vorlage pro Standort). Bei Nein gelten standortdefinierte Schichten. Umschalten auf Ja löscht alle bestehenden Schichten und Zuweisungen.'
  ),
  ('en', 'app_params.shifts_dsp_default_start', 'Default start time'),
  ('de', 'app_params.shifts_dsp_default_start', 'Standard-Startzeit'),
  ('en', 'app_params.shifts_dsp_default_end', 'Default end time'),
  ('de', 'app_params.shifts_dsp_default_end', 'Standard-Endzeit'),
  ('en', 'app_params.shifts_dsp_weekdays', 'Working days'),
  ('de', 'app_params.shifts_dsp_weekdays', 'Arbeitstage'),
  ('en', 'app_params.shifts_dsp_weekdays_empty', 'Select at least one working day.'),
  ('de', 'app_params.shifts_dsp_weekdays_empty', 'Wählen Sie mindestens einen Arbeitstag.'),
  (
    'en',
    'app_params.shifts_dsp_purge_warning',
    'Warning, changing this parameter will delete all existing shifts, do you still wish to continue?'
  ),
  (
    'de',
    'app_params.shifts_dsp_purge_warning',
    'Achtung: Diese Änderung löscht alle bestehenden Schichten. Möchten Sie fortfahren?'
  ),
  (
    'en',
    'app_params.shifts_dsp_confirm_required',
    'Confirm purge of shifts is required when enabling DSP (send confirm_purge_shifts_for_dsp).'
  ),
  (
    'de',
    'app_params.shifts_dsp_confirm_required',
    'Zum Aktivieren von DSP ist die Bestätigung zum Löschen der Schichten erforderlich (confirm_purge_shifts_for_dsp).'
  ),
  (
    'en',
    'app_params.shifts_dsp_invalid_schedule',
    'When DSP is enabled, provide valid default start/end times and at least one weekday (1–7).'
  ),
  (
    'de',
    'app_params.shifts_dsp_invalid_schedule',
    'Bei aktiviertem DSP sind gültige Standard-Start-/Endzeiten und mindestens ein Wochentag (1–7) erforderlich.'
  ),
  (
    'en',
    'shifts.dsp_managed_banner',
    'Shifts are managed by App Parameters (DSP — Apply Default Shift Plan). Turn DSP off there to define custom shifts.'
  ),
  (
    'de',
    'shifts.dsp_managed_banner',
    'Schichten werden in den App-Parametern verwaltet (DSP — Standard-Schichtplan). Schalten Sie DSP dort aus, um eigene Schichten zu definieren.'
  ),
  (
    'en',
    'shift_planner.dsp_banner',
    'Using default shift plan from App Parameters (same hours on selected working days).'
  ),
  (
    'de',
    'shift_planner.dsp_banner',
    'Es gilt der Standard-Schichtplan aus den App-Parametern (gleiche Zeiten an den gewählten Arbeitstagen).'
  )
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
