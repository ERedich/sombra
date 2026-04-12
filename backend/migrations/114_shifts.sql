-- Site-scoped shift definitions and per-day assignments (planner + presence).

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  time_start TIME NOT NULL,
  time_end TIME NOT NULL,
  available_weekdays SMALLINT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT shifts_site_key UNIQUE (site_id, key),
  CONSTRAINT shifts_available_weekdays_check CHECK (
    cardinality(available_weekdays) >= 1
    AND available_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  )
);

CREATE INDEX IF NOT EXISTS idx_shifts_site_id ON shifts (site_id);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts (id) ON DELETE CASCADE,
  assignment_date DATE NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  presence_status TEXT NOT NULL DEFAULT 'scheduled',
  present_started_at TIMESTAMPTZ,
  absent_reason TEXT,
  absent_remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT shift_assignments_unique_slot UNIQUE (shift_id, assignment_date, employee_id),
  CONSTRAINT shift_assignments_presence_check CHECK (
    presence_status IN ('scheduled', 'present', 'not_present', 'absent')
  ),
  CONSTRAINT shift_assignments_absent_reason_check CHECK (
    absent_reason IS NULL
    OR absent_reason IN ('sick', 'holiday', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift_date
  ON shift_assignments (shift_id, assignment_date);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee_date
  ON shift_assignments (employee_id, assignment_date);

CREATE OR REPLACE FUNCTION shift_assignments_same_site()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT e.site_id FROM employees e WHERE e.id = NEW.employee_id
  ) IS DISTINCT FROM (
    SELECT s.site_id FROM shifts s WHERE s.id = NEW.shift_id
  ) THEN
    RAISE EXCEPTION 'Employee and shift must belong to the same site.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_assignments_same_site ON shift_assignments;
CREATE TRIGGER trg_shift_assignments_same_site
  BEFORE INSERT OR UPDATE OF shift_id, employee_id ON shift_assignments
  FOR EACH ROW
  EXECUTE PROCEDURE shift_assignments_same_site();

INSERT INTO app_settings (key, value_json)
VALUES (
    'shifts',
    '{"shift_login_recognition": true, "shift_planning_capacity_pct": 100}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
