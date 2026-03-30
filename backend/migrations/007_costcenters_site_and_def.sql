-- Default site used as bootstrap admin working site (key DEF).
INSERT INTO sites (key, name, colour)
SELECT 'DEF', 'Default', '#94a3b8'
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE key = 'DEF');

ALTER TABLE costcenters
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites (id) ON DELETE RESTRICT;

UPDATE costcenters c
SET site_id = (SELECT id FROM sites WHERE key = 'DEF' LIMIT 1)
WHERE c.site_id IS NULL;

ALTER TABLE costcenters ALTER COLUMN site_id SET NOT NULL;

ALTER TABLE costcenters DROP CONSTRAINT IF EXISTS costcenters_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_costcenters_site_id_key ON costcenters (site_id, key);

CREATE INDEX IF NOT EXISTS idx_costcenters_site_id ON costcenters (site_id);
