-- TRR default: require registered time before setting work order to Done (Y).
UPDATE app_settings
SET value_json = value_json || '{"require_time_registration_for_done": true}'::jsonb
WHERE key = 'wo'
  AND (value_json->>'require_time_registration_for_done') IS NULL;
