-- Work order <-> employee assignments with site integrity.

CREATE TABLE IF NOT EXISTS work_order_employees (
  work_order_id UUID NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_employees_employee_id
  ON work_order_employees (employee_id);

CREATE OR REPLACE FUNCTION work_order_employees_same_site()
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

DROP TRIGGER IF EXISTS trg_work_order_employees_same_site ON work_order_employees;
CREATE TRIGGER trg_work_order_employees_same_site
  BEFORE INSERT OR UPDATE ON work_order_employees
  FOR EACH ROW
  EXECUTE PROCEDURE work_order_employees_same_site();
