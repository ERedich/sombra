-- Unify categories: one row per (site, key), usable from work orders and work plans.

-- Repoint FKs to a single keeper row per (site_id, key), then remove duplicate rows.
WITH keepers AS (
  SELECT site_id, key, MIN(id::text)::uuid AS keeper_id
  FROM categories
  GROUP BY site_id, key
),
dups AS (
  SELECT c.id AS dup_id, k.keeper_id
  FROM categories c
  INNER JOIN keepers k ON k.site_id = c.site_id AND k.key = c.key
  WHERE c.id <> k.keeper_id
)
UPDATE work_orders wo SET category_id = d.keeper_id
FROM dups d WHERE wo.category_id = d.dup_id;

WITH keepers AS (
  SELECT site_id, key, MIN(id::text)::uuid AS keeper_id
  FROM categories
  GROUP BY site_id, key
),
dups AS (
  SELECT c.id AS dup_id, k.keeper_id
  FROM categories c
  INNER JOIN keepers k ON k.site_id = c.site_id AND k.key = c.key
  WHERE c.id <> k.keeper_id
)
UPDATE work_plans wp SET category_id = d.keeper_id
FROM dups d WHERE wp.category_id = d.dup_id;

DELETE FROM categories c
USING (
  SELECT site_id, key, MIN(id::text)::uuid AS keeper_id
  FROM categories
  GROUP BY site_id, key
) k
WHERE c.site_id = k.site_id AND c.key = k.key AND c.id <> k.keeper_id;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_site_scope_key;
DROP INDEX IF EXISTS idx_categories_site_scope;

ALTER TABLE categories DROP COLUMN IF EXISTS scope;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_site_key'
  ) THEN
    ALTER TABLE categories ADD CONSTRAINT categories_site_key UNIQUE (site_id, key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_site ON categories (site_id);
