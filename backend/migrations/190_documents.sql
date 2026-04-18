-- Polymorphic document attachments for assets, employees, and work orders.
-- Payload is either inline (`file_data`, `storage = 'database'`) or stored
-- under the server directory configured in `app_settings.general.docs_application_path`
-- (`storage_relpath`, `storage = 'filesystem'`). Parent existence and site scope
-- are enforced in application code (polymorphic -> no cross-table FK).

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('asset', 'employee', 'work_order')),
  entity_id UUID NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage TEXT NOT NULL CHECK (storage IN ('database', 'filesystem')),
  file_data BYTEA,
  storage_relpath TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT documents_storage_payload CHECK (
    (storage = 'database' AND file_data IS NOT NULL AND storage_relpath IS NULL)
    OR (storage = 'filesystem' AND storage_relpath IS NOT NULL AND file_data IS NULL)
  ),
  CONSTRAINT documents_filename_nonempty CHECK (char_length(trim(original_filename)) > 0),
  CONSTRAINT documents_mime_nonempty CHECK (char_length(trim(mime_type)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_documents_entity
  ON documents (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_site_id
  ON documents (site_id);

-- Seed DOCS general app settings so PATCH can diff without upserting missing keys.
UPDATE app_settings
   SET value_json = value_json
         || jsonb_build_object(
              'docs_storage', COALESCE(value_json->>'docs_storage', 'database'),
              'docs_application_path', COALESCE(value_json->>'docs_application_path', '')
            )
 WHERE key = 'general';
