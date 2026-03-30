CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN ('location', 'building', 'group', 'maintenance_object')
  ),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_asset_id UUID REFERENCES assets (id) ON DELETE SET NULL,
  costcenter_id UUID REFERENCES costcenters (id) ON DELETE SET NULL,
  equipment_number TEXT,
  serial_no TEXT,
  build_year INTEGER,
  warranty_end DATE,
  priority INTEGER CHECK (priority IS NULL OR (priority >= 1 AND priority <= 5)),
  thumbnail_data BYTEA,
  thumbnail_mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT assets_site_id_key_unique UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_assets_site_id ON assets (site_id);
CREATE INDEX IF NOT EXISTS idx_assets_parent_asset_id ON assets (parent_asset_id);
CREATE INDEX IF NOT EXISTS idx_assets_costcenter_id ON assets (costcenter_id);
