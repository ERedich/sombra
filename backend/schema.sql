-- CMMS consolidated schema (matches migrations 001–009 applied in order).
-- Run on an empty database as a superuser or owner who may create objects.
-- For normal app bootstrap, prefer: npm run migrate (applies numbered migrations + seed).
-- This file does NOT insert the admin user; migrate.ts does that.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_login_name ON users (login_name);
CREATE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL;

CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '#94a3b8',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

ALTER TABLE users
  ADD COLUMN created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN working_site_id UUID REFERENCES sites (id) ON DELETE SET NULL,
  ADD COLUMN allow_site_change_on_login BOOLEAN NOT NULL DEFAULT false;

INSERT INTO sites (key, name, colour)
VALUES ('DEF', 'Default', '#94a3b8')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE user_additional_sites (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

CREATE INDEX idx_user_additional_sites_site_id ON user_additional_sites (site_id);

CREATE TABLE costcenters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT costcenters_site_id_key_unique UNIQUE (site_id, key)
);

CREATE INDEX idx_costcenters_site_id ON costcenters (site_id);

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

CREATE TABLE user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT user_groups_site_id_key_unique UNIQUE (site_id, key)
);

CREATE INDEX idx_user_groups_site_id ON user_groups (site_id);

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN ('location', 'building', 'group', 'maintenance_object')
  ),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_classification_id UUID REFERENCES asset_classifications (id) ON DELETE SET NULL,
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

CREATE INDEX idx_assets_site_id ON assets (site_id);
CREATE INDEX idx_assets_parent_asset_id ON assets (parent_asset_id);
CREATE INDEX idx_assets_costcenter_id ON assets (costcenter_id);
CREATE INDEX idx_assets_asset_classification_id ON assets (asset_classification_id);

CREATE TABLE user_user_groups (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_group_id UUID NOT NULL REFERENCES user_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, user_group_id)
);

CREATE INDEX idx_user_user_groups_user_id ON user_user_groups (user_id);
CREATE INDEX idx_user_user_groups_group_id ON user_user_groups (user_group_id);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_key TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  before_state JSONB,
  after_state JSONB,
  field_changes JSONB,
  http_method TEXT NOT NULL,
  path TEXT NOT NULL
);

CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log (resource_type, resource_id);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id);

CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE audit_log_prevent_mutation();
