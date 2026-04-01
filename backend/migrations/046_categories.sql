-- WO / WP categories: key + name per site; scope distinguishes work order vs work plan usage.

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('wo', 'wp')),
  key VARCHAR(100) NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT categories_site_scope_key UNIQUE (site_id, scope, key)
);

-- Index on (site_id, scope) omitted: re-running migrate after 048 would fail (scope dropped).
-- 048 drops idx_categories_site_scope if present before removing scope.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories (id) ON DELETE SET NULL;

ALTER TABLE work_plans
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_category_id ON work_orders (category_id)
  WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_plans_category_id ON work_plans (category_id)
  WHERE category_id IS NOT NULL;
