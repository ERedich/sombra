-- PSH default: disallow plan_start before UTC today (N).
UPDATE app_settings
SET value_json = value_json || '{"allow_plan_start_in_history": false}'::jsonb
WHERE key = 'wo'
  AND (value_json->>'allow_plan_start_in_history') IS NULL;
