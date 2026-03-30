ALTER TABLE users
  ADD COLUMN IF NOT EXISTS working_site_id UUID REFERENCES sites (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allow_site_change_on_login BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_additional_sites (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_user_additional_sites_site_id ON user_additional_sites (site_id);
