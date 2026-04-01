-- Per-site work type master (PM / CM / BD) with colour; replaces work_orders.wo_type text.

CREATE TABLE IF NOT EXISTS work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '#94a3b8',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT work_types_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_work_types_site_id ON work_types (site_id);

INSERT INTO work_types (site_id, key, name, colour)
SELECT s.id, v.key, v.name, v.colour
FROM sites s
CROSS JOIN (
  VALUES
    ('PM', 'Preventive Maintenance', '#2563eb'),
    ('CM', 'Corrective Maintenance', '#16a34a'),
    ('BD', 'Breakdown', '#dc2626')
) AS v(key, name, colour)
WHERE NOT EXISTS (
  SELECT 1 FROM work_types wt
  WHERE wt.site_id = s.id AND wt.key = v.key
);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS work_type_id UUID REFERENCES work_types (id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'wo_type'
  ) THEN
    UPDATE work_orders w
    SET work_type_id = wt.id
    FROM work_types wt
    WHERE wt.site_id = w.site_id
      AND UPPER(wt.key) = UPPER(w.wo_type);
  END IF;
END $$;

UPDATE work_orders w
SET work_type_id = (
  SELECT id FROM work_types wt2
  WHERE wt2.site_id = w.site_id AND wt2.key = 'CM'
  LIMIT 1
)
WHERE work_type_id IS NULL;

ALTER TABLE work_orders ALTER COLUMN work_type_id SET NOT NULL;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_wo_type_check;
ALTER TABLE work_orders DROP COLUMN IF EXISTS wo_type;

DROP INDEX IF EXISTS idx_work_orders_wo_type;

CREATE INDEX IF NOT EXISTS idx_work_orders_work_type_id ON work_orders (work_type_id);
