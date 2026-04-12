-- MSWO default: disallow multiple started/continued WOs per assigned employee (N).
UPDATE app_settings
SET value_json = value_json || '{"allow_multiple_started_work_orders": false}'::jsonb
WHERE key = 'wo'
  AND (value_json->>'allow_multiple_started_work_orders') IS NULL;
