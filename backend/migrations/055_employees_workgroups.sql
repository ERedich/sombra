-- Site-scoped employees and workgroups; workgroup–employee membership; WO workgroup assignment.

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT employees_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_employees_site_id ON employees (site_id);

CREATE TABLE IF NOT EXISTS workgroups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  costcenter_id UUID REFERENCES costcenters (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT workgroups_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workgroups_site_id ON workgroups (site_id);
CREATE INDEX IF NOT EXISTS idx_workgroups_costcenter_id ON workgroups (costcenter_id);

CREATE OR REPLACE FUNCTION workgroups_costcenter_same_site()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.costcenter_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM costcenters cc
      WHERE cc.id = NEW.costcenter_id AND cc.site_id = NEW.site_id
    ) THEN
      RAISE EXCEPTION 'Cost center must belong to the same site as the workgroup.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workgroups_costcenter_site ON workgroups;
CREATE TRIGGER trg_workgroups_costcenter_site
  BEFORE INSERT OR UPDATE OF costcenter_id, site_id ON workgroups
  FOR EACH ROW
  EXECUTE PROCEDURE workgroups_costcenter_same_site();

CREATE TABLE IF NOT EXISTS workgroup_employees (
  workgroup_id UUID NOT NULL REFERENCES workgroups (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  PRIMARY KEY (workgroup_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_workgroup_employees_employee_id ON workgroup_employees (employee_id);

CREATE OR REPLACE FUNCTION workgroup_employees_same_site()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT e.site_id FROM employees e WHERE e.id = NEW.employee_id
  ) IS DISTINCT FROM (
    SELECT w.site_id FROM workgroups w WHERE w.id = NEW.workgroup_id
  ) THEN
    RAISE EXCEPTION 'Employee and workgroup must belong to the same site.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workgroup_employees_same_site ON workgroup_employees;
CREATE TRIGGER trg_workgroup_employees_same_site
  BEFORE INSERT OR UPDATE ON workgroup_employees
  FOR EACH ROW
  EXECUTE PROCEDURE workgroup_employees_same_site();

-- Default workgroup per site (for migration and PM-generated WOs).
INSERT INTO workgroups (site_id, key, name, costcenter_id)
SELECT s.id, '_DEFAULT', 'Default', NULL
FROM sites s
WHERE NOT EXISTS (
  SELECT 1 FROM workgroups wg WHERE wg.site_id = s.id AND wg.key = '_DEFAULT'
);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS workgroup_id UUID REFERENCES workgroups (id) ON DELETE RESTRICT;

UPDATE work_orders w
SET workgroup_id = wg.id
FROM workgroups wg
WHERE w.workgroup_id IS NULL
  AND wg.site_id = w.site_id
  AND wg.key = '_DEFAULT';

ALTER TABLE work_orders ALTER COLUMN workgroup_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_workgroup_id ON work_orders (workgroup_id);
