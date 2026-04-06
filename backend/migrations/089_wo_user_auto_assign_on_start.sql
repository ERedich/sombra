-- Default UAA (user auto assign on start) for existing wo app_settings JSON.
UPDATE app_settings
SET value_json = value_json || '{"user_auto_assign_on_start": true}'::jsonb
WHERE key = 'wo'
  AND (value_json->>'user_auto_assign_on_start') IS NULL;
