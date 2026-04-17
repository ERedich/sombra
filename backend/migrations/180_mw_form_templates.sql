-- Modal window (MW) form templates per site + optional user-group bindings (priority: lower = wins).

CREATE TABLE IF NOT EXISTS mw_form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  shell_key TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  layout_json JSONB NOT NULL DEFAULT '{"version":1,"fields":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT mw_form_templates_site_shell_key_unique UNIQUE (site_id, shell_key, key),
  CONSTRAINT mw_form_templates_shell_key_check CHECK (
    shell_key ~ '^[a-z0-9_]{1,40}$'
  ),
  CONSTRAINT mw_form_templates_key_check CHECK (
    char_length(trim(key)) >= 1 AND char_length(key) <= 64
  )
);

CREATE INDEX IF NOT EXISTS idx_mw_form_templates_site_shell
  ON mw_form_templates (site_id, shell_key);

CREATE TABLE IF NOT EXISTS user_group_mw_form_template_bindings (
  user_group_id UUID NOT NULL REFERENCES user_groups (id) ON DELETE CASCADE,
  shell_key TEXT NOT NULL,
  mw_form_template_id UUID NOT NULL REFERENCES mw_form_templates (id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (user_group_id, shell_key),
  CONSTRAINT ug_mw_binding_shell_check CHECK (
    shell_key ~ '^[a-z0-9_]{1,40}$'
  ),
  CONSTRAINT ug_mw_binding_priority_check CHECK (priority >= 0 AND priority <= 1000000)
);

CREATE INDEX IF NOT EXISTS idx_ug_mw_bindings_template
  ON user_group_mw_form_template_bindings (mw_form_template_id);

CREATE INDEX IF NOT EXISTS idx_ug_mw_bindings_shell_priority
  ON user_group_mw_form_template_bindings (shell_key, priority);

CREATE OR REPLACE FUNCTION trg_mw_form_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mw_form_templates_updated_at ON mw_form_templates;
CREATE TRIGGER mw_form_templates_updated_at
  BEFORE UPDATE ON mw_form_templates
  FOR EACH ROW EXECUTE PROCEDURE trg_mw_form_templates_updated_at();

CREATE OR REPLACE FUNCTION trg_ug_mw_form_template_bindings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ug_mw_form_template_bindings_updated_at ON user_group_mw_form_template_bindings;
CREATE TRIGGER ug_mw_form_template_bindings_updated_at
  BEFORE UPDATE ON user_group_mw_form_template_bindings
  FOR EACH ROW EXECUTE PROCEDURE trg_ug_mw_form_template_bindings_updated_at();

CREATE OR REPLACE FUNCTION trg_ug_mw_binding_shell_matches_template()
RETURNS TRIGGER AS $$
DECLARE
  tpl_shell TEXT;
BEGIN
  SELECT shell_key INTO tpl_shell FROM mw_form_templates WHERE id = NEW.mw_form_template_id;
  IF tpl_shell IS NULL THEN
    RAISE EXCEPTION 'mw_form_template not found';
  END IF;
  IF tpl_shell IS DISTINCT FROM NEW.shell_key THEN
    RAISE EXCEPTION 'binding shell_key must match template shell_key';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ug_mw_binding_shell_match ON user_group_mw_form_template_bindings;
CREATE TRIGGER ug_mw_binding_shell_match
  BEFORE INSERT OR UPDATE OF shell_key, mw_form_template_id ON user_group_mw_form_template_bindings
  FOR EACH ROW EXECUTE PROCEDURE trg_ug_mw_binding_shell_matches_template();
