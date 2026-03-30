-- Locale registry (extensible; add rows for new languages)
CREATE TABLE IF NOT EXISTS app_locales (
  code TEXT PRIMARY KEY,
  native_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO app_locales (code, native_name, enabled, sort_order) VALUES
  ('en', 'English', true, 1),
  ('de', 'Deutsch', true, 2)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale TEXT
  REFERENCES app_locales (code);

UPDATE users SET preferred_locale = 'en' WHERE preferred_locale IS NULL;

ALTER TABLE users ALTER COLUMN preferred_locale SET DEFAULT 'en';
ALTER TABLE users ALTER COLUMN preferred_locale SET NOT NULL;

CREATE TABLE IF NOT EXISTS ui_translations (
  locale TEXT NOT NULL REFERENCES app_locales (code) ON DELETE CASCADE,
  msg_key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (locale, msg_key)
);

CREATE INDEX IF NOT EXISTS idx_ui_translations_locale ON ui_translations (locale);

-- Seed English (canonical)
INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'shell.brand_name', 'CMMS'),
  ('en', 'shell.nav_aria', 'Main navigation'),
  ('en', 'shell.logout_confirm_header', 'Log out'),
  ('en', 'shell.logout_confirm_message', 'Are you sure you want to log out? You will need to sign in again to continue.'),
  ('en', 'shell.logout_accept', 'Log out'),
  ('en', 'shell.logout_reject', 'Cancel'),
  ('en', 'shell.theme_light_aria', 'Switch to light mode'),
  ('en', 'shell.theme_dark_aria', 'Switch to dark mode'),
  ('en', 'shell.log_out', 'Log out'),
  ('en', 'nav.overview', 'Overview'),
  ('en', 'nav.keyboard_shortcuts', 'Keyboard shortcuts'),
  ('en', 'nav.users', 'Users'),
  ('en', 'nav.sites', 'Sites'),
  ('en', 'nav.costcenters', 'Cost centers'),
  ('en', 'nav.asset_classifications', 'Asset classifications'),
  ('en', 'nav.asset_management', 'Asset management'),
  ('en', 'nav.work_orders', 'Work orders'),
  ('en', 'nav.tree_structure', 'Tree Structure'),
  ('en', 'nav.user_groups', 'User groups'),
  ('en', 'nav.template_app', 'Template app'),
  ('en', 'nav.audit_log', 'Audit log'),
  ('en', 'nav.translations', 'Translations'),
  ('en', 'login.title', 'Sign in'),
  ('en', 'login.login_name_label', 'Login name or email'),
  ('en', 'login.password_label', 'Password'),
  ('en', 'login.sign_in', 'Sign in'),
  ('en', 'login.locale_label', 'Language'),
  ('en', 'login.error_network', 'Network error — is the API running?'),
  ('en', 'login.error_invalid_response', 'Invalid response from server'),
  ('en', 'login.error_login_failed', 'Login failed'),
  ('en', 'login.working_site_title', 'Choose working site'),
  ('en', 'login.working_site_help', 'Select the site new records will be assigned to for this session.'),
  ('en', 'login.working_site_label', 'Working site'),
  ('en', 'login.working_site_placeholder', 'Select site'),
  ('en', 'login.keep_current', 'Keep current'),
  ('en', 'login.continue', 'Continue'),
  ('en', 'login.error_working_site', 'Could not update working site'),
  ('en', 'quick.title', 'Quick Access'),
  ('en', 'quick.description', 'Type to filter. Arrow keys move the highlighted app (including while the search field is focused); click in the search box if you need to move the text caret. Enter opens the selected app.'),
  ('en', 'quick.search_placeholder', 'Search apps…'),
  ('en', 'quick.search_aria', 'Search apps'),
  ('en', 'quick.apps_aria', 'Apps'),
  ('en', 'quick.no_match', 'No apps match your search.'),
  ('en', 'translations.title', 'Translations'),
  ('en', 'translations.subtitle', 'Edit UI strings per language. Changes apply after reload or navigation.'),
  ('en', 'translations.col_key', 'Key'),
  ('en', 'translations.save', 'Save'),
  ('en', 'translations.saved', 'Saved.'),
  ('en', 'translations.save_error', 'Could not save.'),
  ('en', 'translations.load_error', 'Could not load translations.'),
  ('en', 'translations.unsaved', 'You have unsaved changes.')
ON CONFLICT (locale, msg_key) DO NOTHING;

-- German (initial copy / translations)
INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('de', 'shell.brand_name', 'CMMS'),
  ('de', 'shell.nav_aria', 'Hauptnavigation'),
  ('de', 'shell.logout_confirm_header', 'Abmelden'),
  ('de', 'shell.logout_confirm_message', 'Wirklich abmelden? Sie müssen sich erneut anmelden, um fortzufahren.'),
  ('de', 'shell.logout_accept', 'Abmelden'),
  ('de', 'shell.logout_reject', 'Abbrechen'),
  ('de', 'shell.theme_light_aria', 'Zum Hellmodus wechseln'),
  ('de', 'shell.theme_dark_aria', 'Zum Dunkelmodus wechseln'),
  ('de', 'shell.log_out', 'Abmelden'),
  ('de', 'nav.overview', 'Übersicht'),
  ('de', 'nav.keyboard_shortcuts', 'Tastenkürzel'),
  ('de', 'nav.users', 'Benutzer'),
  ('de', 'nav.sites', 'Standorte'),
  ('de', 'nav.costcenters', 'Kostenstellen'),
  ('de', 'nav.asset_classifications', 'Anlagenklassen'),
  ('de', 'nav.asset_management', 'Anlagenverwaltung'),
  ('de', 'nav.work_orders', 'Arbeitsaufträge'),
  ('de', 'nav.tree_structure', 'Baumstruktur'),
  ('de', 'nav.user_groups', 'Benutzergruppen'),
  ('de', 'nav.template_app', 'Vorlagen-App'),
  ('de', 'nav.audit_log', 'Prüfprotokoll'),
  ('de', 'nav.translations', 'Übersetzungen'),
  ('de', 'login.title', 'Anmelden'),
  ('de', 'login.login_name_label', 'Benutzername oder E-Mail'),
  ('de', 'login.password_label', 'Passwort'),
  ('de', 'login.sign_in', 'Anmelden'),
  ('de', 'login.locale_label', 'Sprache'),
  ('de', 'login.error_network', 'Netzwerkfehler — läuft die API?'),
  ('de', 'login.error_invalid_response', 'Ungültige Serverantwort'),
  ('de', 'login.error_login_failed', 'Anmeldung fehlgeschlagen'),
  ('de', 'login.working_site_title', 'Arbeitsstandort wählen'),
  ('de', 'login.working_site_help', 'Wählen Sie den Standort, dem neue Datensätze in dieser Sitzung zugeordnet werden.'),
  ('de', 'login.working_site_label', 'Arbeitsstandort'),
  ('de', 'login.working_site_placeholder', 'Standort wählen'),
  ('de', 'login.keep_current', 'Aktuellen behalten'),
  ('de', 'login.continue', 'Weiter'),
  ('de', 'login.error_working_site', 'Arbeitsstandort konnte nicht aktualisiert werden'),
  ('de', 'quick.title', 'Schnellzugriff'),
  ('de', 'quick.description', 'Tippen zum Filtern. Pfeiltasten bewegen die markierte App (auch bei Fokus im Suchfeld); klicken Sie ins Suchfeld, um den Textcursor zu verschieben. Eingabetaste öffnet die ausgewählte App.'),
  ('de', 'quick.search_placeholder', 'Apps durchsuchen…'),
  ('de', 'quick.search_aria', 'Apps durchsuchen'),
  ('de', 'quick.apps_aria', 'Apps'),
  ('de', 'quick.no_match', 'Keine passenden Apps.'),
  ('de', 'translations.title', 'Übersetzungen'),
  ('de', 'translations.subtitle', 'UI-Texte pro Sprache bearbeiten. Änderungen gelten nach Neuladen oder Navigation.'),
  ('de', 'translations.col_key', 'Schlüssel'),
  ('de', 'translations.save', 'Speichern'),
  ('de', 'translations.saved', 'Gespeichert.'),
  ('de', 'translations.save_error', 'Speichern fehlgeschlagen.'),
  ('de', 'translations.load_error', 'Übersetzungen konnten nicht geladen werden.'),
  ('de', 'translations.unsaved', 'Ungespeicherte Änderungen.')
ON CONFLICT (locale, msg_key) DO NOTHING;
