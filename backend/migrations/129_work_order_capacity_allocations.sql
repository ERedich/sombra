-- Per-day planned hours: capacity planner (SPC bucket per employee/date).

CREATE TABLE IF NOT EXISTS work_order_capacity_allocations (
  work_order_id UUID NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  allocation_date DATE NOT NULL,
  planned_hours NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (work_order_id, employee_id, allocation_date),
  CONSTRAINT work_order_capacity_allocations_planned_hours_check CHECK (planned_hours >= 0)
);

CREATE INDEX IF NOT EXISTS idx_woca_employee_date
  ON work_order_capacity_allocations (employee_id, allocation_date);

CREATE OR REPLACE FUNCTION work_order_capacity_allocations_same_site()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT w.site_id FROM work_orders w WHERE w.id = NEW.work_order_id
  ) IS DISTINCT FROM (
    SELECT e.site_id FROM employees e WHERE e.id = NEW.employee_id
  ) THEN
    RAISE EXCEPTION 'Work order and employee must belong to the same site.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_order_capacity_allocations_same_site
  ON work_order_capacity_allocations;
CREATE TRIGGER trg_work_order_capacity_allocations_same_site
  BEFORE INSERT OR UPDATE ON work_order_capacity_allocations
  FOR EACH ROW
  EXECUTE PROCEDURE work_order_capacity_allocations_same_site();
