CREATE TABLE IF NOT EXISTS table_layout_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_path TEXT NOT NULL,
  layout_key TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT table_layout_presets_owner_app_key UNIQUE (owner_user_id, app_path, layout_key),
  CONSTRAINT table_layout_presets_app_path_check CHECK (char_length(app_path) >= 1 AND app_path LIKE '/%')
);

CREATE INDEX IF NOT EXISTS idx_table_layout_presets_owner_app ON table_layout_presets (owner_user_id, app_path);

CREATE TABLE IF NOT EXISTS table_layout_preset_shares (
  preset_id UUID NOT NULL REFERENCES table_layout_presets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_table_layout_preset_shares_user ON table_layout_preset_shares (user_id);

CREATE TABLE IF NOT EXISTS user_table_layout_defaults (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_path TEXT NOT NULL,
  preset_id UUID NOT NULL REFERENCES table_layout_presets(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_path),
  CONSTRAINT user_table_layout_defaults_app_path_check CHECK (char_length(app_path) >= 1 AND app_path LIKE '/%')
);

CREATE OR REPLACE FUNCTION trg_table_layout_presets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS table_layout_presets_updated_at ON table_layout_presets;
CREATE TRIGGER table_layout_presets_updated_at
  BEFORE UPDATE ON table_layout_presets
  FOR EACH ROW EXECUTE PROCEDURE trg_table_layout_presets_updated_at();
