-- Plant site flag, app-wide ask-for-site on login, users site tab note.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'app_params.general_ask_site_change_heading', 'Ask for site change at login'),
  ('de', 'app_params.general_ask_site_change_heading', 'Standortwahl bei Anmeldung abfragen'),
  ('en', 'app_params.general_ask_site_change_help', 'When enabled, users who are assigned to more than one site marked as Plant are prompted to choose their current working site after signing in.'),
  ('de', 'app_params.general_ask_site_change_help', 'Wenn aktiviert, werden Benutzer, die mehr als einem als Werk markierten Standort zugeordnet sind, nach der Anmeldung aufgefordert, den aktuellen Arbeitsstandort zu wählen.'),
  ('en', 'app_params.general_ask_site_change_label', 'Ask for site change'),
  ('de', 'app_params.general_ask_site_change_label', 'Standort abfragen'),
  ('en', 'app_params.general_ask_site_change_y', 'Yes'),
  ('de', 'app_params.general_ask_site_change_y', 'Ja'),
  ('en', 'app_params.general_ask_site_change_n', 'No'),
  ('de', 'app_params.general_ask_site_change_n', 'Nein'),
  ('en', 'sites.col_plant', 'Plant'),
  ('de', 'sites.col_plant', 'Werk'),
  ('en', 'sites.plant_checkbox', 'Plant'),
  ('de', 'sites.plant_checkbox', 'Werk'),
  ('en', 'sites.plant_yes', 'Yes'),
  ('de', 'sites.plant_yes', 'Ja'),
  ('en', 'sites.plant_no', 'No'),
  ('de', 'sites.plant_no', 'Nein')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

UPDATE ui_translations
SET value = 'Users can read data for the working site and any additional sites. New records use the working site. Login-time site selection is configured under App parameters → General (Ask for site change) and applies to users with multiple assigned Plant sites.'
WHERE locale = 'en' AND msg_key = 'users.site_tab_note';

UPDATE ui_translations
SET value = 'Benutzer können Daten für den Arbeitsstandort und weitere Standorte lesen. Neue Datensätze verwenden den Arbeitsstandort. Die Standortabfrage bei der Anmeldung wird unter App-Parameter → Allgemein (Standort abfragen) konfiguriert und gilt für Benutzer mit mehreren zugewiesenen Werken.'
WHERE locale = 'de' AND msg_key = 'users.site_tab_note';

DELETE FROM ui_translations WHERE msg_key = 'users.allow_site_change';
