-- Work order classification: BD / PM / CM (no PM interval scheduling columns here).

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS wo_type TEXT NOT NULL DEFAULT 'cm';

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_wo_type_check;
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_wo_type_check CHECK (wo_type IN ('bd', 'pm', 'cm'));

CREATE INDEX IF NOT EXISTS idx_work_orders_wo_type ON work_orders (wo_type);
