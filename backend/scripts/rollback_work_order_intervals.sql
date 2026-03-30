-- =============================================================================
-- ROLLBACK: Work-order PM interval, roll-out, generate-due (schema ~014 era)
-- =============================================================================
-- WARNING: Destructive. Run only after backup.
--
-- Deploy order: ship application code that no longer SELECTs interval columns
-- BEFORE running this script. If you DROP columns first, an old API will error.
--   1) Deletes ALL rolled-out child work orders (rolled_out_from_wo_id IS NOT NULL).
--   2) Drops DB functions used for intervals / roll-out / (old) generate-due.
--   3) Drops columns and constraints added for PM intervals (015, 016).
--
-- After this script, deploy application code that matches the simplified schema
-- (no wo_type, interval_*, due dates, lead_time, rolled_out_from_wo_id).
--
-- Audit log rows referencing deleted work orders are NOT removed (audit_log is
-- append-only / immutable in this project).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Remove dependent rows (children created by roll-out / generate-due)
-- ---------------------------------------------------------------------------
DELETE FROM work_orders
WHERE rolled_out_from_wo_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Drop functions (dependents first)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS wo_generate_due_pm_intervals(uuid);
DROP FUNCTION IF EXISTS wo_roll_out_children(uuid, integer, uuid);
DROP FUNCTION IF EXISTS wo_compute_pm_interval_columns(
  integer, text, boolean, numeric, text, date, date
);
DROP FUNCTION IF EXISTS wo_add_interval_to_ymd(date, numeric, text);
DROP FUNCTION IF EXISTS wo_plan_start_from_due_and_lead(date, integer);

-- ---------------------------------------------------------------------------
-- 3) Indexes that reference interval / rollout columns
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_work_orders_wo_type;
DROP INDEX IF EXISTS idx_work_orders_next_due_date;
DROP INDEX IF EXISTS idx_work_orders_rolled_out_from;

-- ---------------------------------------------------------------------------
-- 4) Constraints on work_orders (names from migrations 015–016)
-- ---------------------------------------------------------------------------
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_pm_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_lead_time_days_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_interval_time_type_check;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_wo_type_check;

-- ---------------------------------------------------------------------------
-- 5) Columns (016 then 015 order: FK column first)
-- ---------------------------------------------------------------------------
ALTER TABLE work_orders DROP COLUMN IF EXISTS rolled_out_from_wo_id;

ALTER TABLE work_orders DROP COLUMN IF EXISTS wo_type;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_enabled;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_value;
ALTER TABLE work_orders DROP COLUMN IF EXISTS interval_time_type;
ALTER TABLE work_orders DROP COLUMN IF EXISTS anchor_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS last_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS next_due_date;
ALTER TABLE work_orders DROP COLUMN IF EXISTS lead_time_days;

COMMIT;

-- Optional: remove UI strings only used for intervals (safe to skip).
-- DELETE FROM ui_translations WHERE msg_key LIKE 'wo.generate_due%';
-- (Add more keys as needed.)
