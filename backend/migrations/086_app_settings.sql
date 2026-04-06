CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value_json)
VALUES (
    'wo',
    '{"start_requires_assignment": true, "user_auto_assign_on_start": true}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
