INSERT INTO app_settings (key, value_json)
VALUES ('general', '{"idle_session_timeout_minutes": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;
