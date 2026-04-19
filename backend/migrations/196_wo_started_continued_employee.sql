-- Track which employee started (first transition to `started`) and who most
-- recently continued the WO from `on_hold`. Both are read-only fields exposed
-- in the WO & Monitoring UI; nullable, set from actions/start handler.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS started_by_employee_id UUID
    REFERENCES employees (id) ON DELETE SET NULL;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS continued_by_employee_id UUID
    REFERENCES employees (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_started_by_employee_id
  ON work_orders (started_by_employee_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_continued_by_employee_id
  ON work_orders (continued_by_employee_id);
