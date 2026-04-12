-- SPC: default shift planning capacity (%) on existing app_settings.shifts rows.
UPDATE app_settings
SET value_json = value_json || '{"shift_planning_capacity_pct": 100}'::jsonb
WHERE key = 'shifts';
