-- Plant sites: mark physical plants; app-wide login prompt (see general.ask_for_site_change_on_login).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS is_plant BOOLEAN NOT NULL DEFAULT false;

UPDATE app_settings
SET value_json = COALESCE(value_json, '{}'::jsonb) || '{"ask_for_site_change_on_login": false}'::jsonb
WHERE key = 'general';

ALTER TABLE users
  DROP COLUMN IF EXISTS allow_site_change_on_login;
