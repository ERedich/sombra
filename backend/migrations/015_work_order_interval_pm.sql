ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS wo_type TEXT NOT NULL DEFAULT 'cm',
  ADD COLUMN IF NOT EXISTS interval_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interval_value NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS interval_time_type TEXT,
  ADD COLUMN IF NOT EXISTS anchor_due_date DATE,
  ADD COLUMN IF NOT EXISTS last_due_date DATE,
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_wo_type_check CHECK (wo_type IN ('pm', 'cm'));

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_interval_time_type_check CHECK (
    interval_time_type IS NULL
    OR interval_time_type IN ('day', 'week', 'month', 'year')
  );

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_lead_time_days_check CHECK (lead_time_days >= 0);

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_interval_pm_check CHECK (
    NOT interval_enabled OR wo_type = 'pm'
  );

CREATE INDEX IF NOT EXISTS idx_work_orders_wo_type ON work_orders (wo_type);
CREATE INDEX IF NOT EXISTS idx_work_orders_next_due_date ON work_orders (next_due_date)
  WHERE next_due_date IS NOT NULL;
