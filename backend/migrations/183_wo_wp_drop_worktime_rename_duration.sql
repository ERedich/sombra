-- Drop `worktime` from work_orders and work_plans.
-- Rename `duration` (work_orders) and `duration_hours` (work_plans) to
-- `planned_duration` so both tables share the same column name.
--
-- Idempotent and tolerant of partial applies:
-- - If only legacy column exists → rename.
-- - If only `planned_duration` exists → no-op for rename.
-- - If both exist (collision) → drop legacy column and keep `planned_duration`.

ALTER TABLE work_orders DROP COLUMN IF EXISTS worktime;
ALTER TABLE work_plans DROP COLUMN IF EXISTS worktime;

-- work_orders: duration -> planned_duration
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_duration_check;

DO $$
DECLARE
  has_duration boolean;
  has_planned boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'duration'
  ) INTO has_duration;
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'planned_duration'
  ) INTO has_planned;

  IF has_duration AND has_planned THEN
    ALTER TABLE work_orders DROP COLUMN duration;
  ELSIF has_duration AND NOT has_planned THEN
    ALTER TABLE work_orders RENAME COLUMN duration TO planned_duration;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_planned_duration_check'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'planned_duration'
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_planned_duration_check CHECK (planned_duration >= 0);
  END IF;
END $$;

-- work_plans: duration_hours -> planned_duration
ALTER TABLE work_plans DROP CONSTRAINT IF EXISTS work_plans_duration_hours_check;

DO $$
DECLARE
  has_dh boolean;
  has_planned boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_plans'
      AND column_name = 'duration_hours'
  ) INTO has_dh;
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_plans'
      AND column_name = 'planned_duration'
  ) INTO has_planned;

  IF has_dh AND has_planned THEN
    ALTER TABLE work_plans DROP COLUMN duration_hours;
  ELSIF has_dh AND NOT has_planned THEN
    ALTER TABLE work_plans RENAME COLUMN duration_hours TO planned_duration;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_plans_planned_duration_check'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_plans'
      AND column_name = 'planned_duration'
  ) THEN
    ALTER TABLE work_plans
      ADD CONSTRAINT work_plans_planned_duration_check CHECK (planned_duration >= 0);
  END IF;
END $$;
