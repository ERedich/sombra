-- App parameters → General tab: info toggle for inline help + Guidelines panel.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.general_info_toggle_show_aria', 'Show help text for general display settings'),
  ('de', 'app_params.general_info_toggle_show_aria', 'Hilfetexte für allgemeine Anzeigeeinstellungen anzeigen'),
  ('en', 'app_params.general_info_toggle_hide_aria', 'Hide help text for general display settings'),
  ('de', 'app_params.general_info_toggle_hide_aria', 'Hilfetexte für allgemeine Anzeigeeinstellungen ausblenden'),
  ('en', 'app_params.general_info_toggle_show_tooltip', 'Show explanatory text under each section (date format, week start, site prompt, idle timeout)'),
  ('de', 'app_params.general_info_toggle_show_tooltip', 'Erklärungstexte unter den Abschnitten anzeigen (Datumsformat, Wochenbeginn, Standortabfrage, Sitzungs-Timeout)'),
  ('en', 'app_params.general_info_toggle_hide_tooltip', 'Hide explanatory text'),
  ('de', 'app_params.general_info_toggle_hide_tooltip', 'Erklärungstexte ausblenden'),
  ('en', 'app_params.general_guidelines_title', 'Guidelines'),
  ('de', 'app_params.general_guidelines_title', 'Richtlinien'),
  ('en', 'app_params.general_guidelines_info_messages_title', 'Info messages'),
  ('de', 'app_params.general_guidelines_info_messages_title', 'Infomeldungen'),
  ('en', 'app_params.general_guidelines_info_messages_body', 'The grey help lines under Date/time format, First day of week, Site change prompt, and Idle session are hidden by default. Use the info button at the top of this tab to show or hide them.'),
  ('de', 'app_params.general_guidelines_info_messages_body', 'Die grauen Hilfezeilen unter Datums-/Zeitformat, erster Wochentag, Standortwechsel und Leerlauf-Sitzung sind standardmäßig ausgeblendet. Über die Info-Schaltfläche oben in diesem Reiter blenden Sie sie ein oder aus.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
