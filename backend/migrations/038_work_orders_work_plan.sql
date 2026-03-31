ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS work_plan_id UUID REFERENCES work_plans (id) ON DELETE SET NULL;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS work_plan_key VARCHAR(200);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS duration NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_duration_check;
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_duration_check CHECK (duration >= 0);

CREATE INDEX IF NOT EXISTS idx_work_orders_work_plan_id
  ON work_orders (work_plan_id)
  WHERE work_plan_id IS NOT NULL;
