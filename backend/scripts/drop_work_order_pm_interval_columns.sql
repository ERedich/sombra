-- =============================================================================
-- Drop PM interval / roll-out columns; keep wo_type (bd | pm | cm)
-- =============================================================================
-- Run against your app database after backup. Deletes rolled-out child WOs first.
-- Deploy app code that does not SELECT dropped columns before running.
-- =============================================================================

BEGIN;

DELETE FROM work_orders
WHERE rolled_out_from_wo_id IS NOT NULL;

DROP FUNCTION IF EXISTS wo_generate_due_pm_intervals(uuid);
DROP FUNCTION IF EXISTS wo_roll_out_children(uuid, integer, uuid);
DROP FUNCTION IF EXISTS wo_compute_pm_interval_columns(
  integer, text, boolean, numeric, text, date, date
);
DROP FUNCTION IF EXISTS wo_add_interval_to_ymd(date, numeric, text);
DROP FUNCTION IF EXISTS wo_plan_start_from_due_and_lead(date, integer);

DROP INDEX IF EXISTS idx_work_orders_next_due_date;
DROP INDEX IF EXISTS idx_work_orders_rolled_out_from;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_pm_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_lead_time_days_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_time_type_check;

-- Normalize wo_type constraint to bd | pm | cm (keeps column)
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_wo_type_check;
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_wo_type_check CHECK (wo_type IN ('bd', 'pm', 'cm'));

ALTER TABLE work_orders DROP COLUMN IF EXISTS rolled_out_from_wo_id;

ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_enabled;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_value;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_time_type;
ALTER TABLE work_orders DROP COLUMN IF EXISTS anchor_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS last_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS next_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS lead_time_days;

COMMIT;
