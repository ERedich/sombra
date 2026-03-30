CREATE TABLE asset_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT asset_classifications_site_id_key_unique UNIQUE (site_id, key)
);

CREATE INDEX idx_asset_classifications_site_id ON asset_classifications (site_id);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_classification_id UUID REFERENCES asset_classifications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_asset_classification_id ON assets (asset_classification_id);

ALTER TABLE assets DROP COLUMN IF EXISTS asset_class;
