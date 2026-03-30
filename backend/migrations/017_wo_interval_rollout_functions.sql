-- Remove PM interval / roll-out / generate-due functions (no longer used).

DROP FUNCTION IF EXISTS wo_generate_due_pm_intervals(uuid);
DROP FUNCTION IF EXISTS wo_roll_out_children(uuid, integer, uuid);
DROP FUNCTION IF EXISTS wo_compute_pm_interval_columns(
  integer, text, boolean, numeric, text, date, date
);
DROP FUNCTION IF EXISTS wo_add_interval_to_ymd(date, numeric, text);
DROP FUNCTION IF EXISTS wo_plan_start_from_due_and_lead(date, integer);
