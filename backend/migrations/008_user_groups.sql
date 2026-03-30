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

CREATE TABLE user_user_groups (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_group_id UUID NOT NULL REFERENCES user_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, user_group_id)
);

CREATE INDEX idx_user_user_groups_user_id ON user_user_groups (user_id);
CREATE INDEX idx_user_user_groups_group_id ON user_user_groups (user_group_id);
