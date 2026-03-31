-- Roll back PM interval / woGen columns (from former 033). Safe if columns are missing.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_orders'
      AND column_name = 'generated_from_wo_id'
  ) THEN
    EXECUTE 'DELETE FROM work_orders WHERE generated_from_wo_id IS NOT NULL';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_work_orders_pm_schedule_next_due;
DROP INDEX IF EXISTS idx_work_orders_generated_from;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_pm_interval_fields_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_count_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_time_type_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_lead_time_days_check;

ALTER TABLE work_orders DROP COLUMN IF EXISTS generated_from_wo_id;
ALTER TABLE work_orders DROP COLUMN IF EXISTS next_due_at;
ALTER TABLE work_orders DROP COLUMN IF EXISTS lead_time_days;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_time_type;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_count;
ALTER TABLE work_orders DROP COLUMN IF EXISTS pm_interval_enabled;

COMMIT;
