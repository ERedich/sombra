-- Generate child work orders for PM sources whose next_due_date is on or before "today" (Europe/Berlin).
-- Catches up all overdue intervals (loop until next_due_date > today). Skips duplicate child for same calendar plan_start date.

CREATE OR REPLACE FUNCTION wo_generate_due_pm_intervals(p_actor_id uuid)
RETURNS TABLE (child_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date;
  v_parent work_orders%ROWTYPE;
  v_due date;
  v_child_plan timestamptz;
  v_pe timestamptz;
  v_dup boolean;
  v_new_id uuid;
  v_guard int;
  v_max_guard int := 5000;
BEGIN
  v_today := (timezone('Europe/Berlin', now()))::date;

  FOR v_parent IN
    SELECT w.*
    FROM work_orders w
    WHERE w.rolled_out_from_wo_id IS NULL
      AND w.wo_type = 'pm'
      AND w.interval_enabled
      AND w.interval_value IS NOT NULL
      AND w.interval_value > 0
      AND w.interval_time_type IN ('day', 'week', 'month', 'year')
      AND w.next_due_date IS NOT NULL
      AND w.next_due_date <= v_today
    ORDER BY w.id
    FOR UPDATE OF w
  LOOP
    v_guard := 0;
    WHILE v_parent.next_due_date IS NOT NULL
      AND v_parent.next_due_date <= v_today
      AND v_guard < v_max_guard
    LOOP
      v_guard := v_guard + 1;
      v_due := v_parent.next_due_date;
      v_pe := v_parent.plan_end;
      v_child_plan := (to_char(v_due, 'YYYY-MM-DD') || ' 12:00:00+00')::timestamptz;

      IF v_pe IS NOT NULL AND v_child_plan > v_pe THEN
        RAISE EXCEPTION 'plan_end must be on or after plan_start for each generated row (wo_key=%).', v_parent.wo_key;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM work_orders c
        WHERE c.rolled_out_from_wo_id = v_parent.id
          AND (c.plan_start)::date = v_due
      )
      INTO v_dup;

      IF NOT v_dup THEN
        INSERT INTO work_orders (
          site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
          plan_start, plan_end, worktime, status, created_by,
          wo_type, interval_enabled, interval_value, interval_time_type,
          anchor_due_date, last_due_date, next_due_date, rolled_out_from_wo_id, lead_time_days
        )
        VALUES (
          v_parent.site_id,
          nextval('work_order_wo_key_seq'),
          v_parent.short_text,
          v_parent.asset_id,
          v_parent.costcenter_id,
          v_parent.instruction_text,
          v_child_plan,
          v_parent.plan_end,
          v_parent.worktime,
          v_parent.status,
          p_actor_id,
          v_parent.wo_type,
          v_parent.interval_enabled,
          v_parent.interval_value,
          v_parent.interval_time_type,
          v_parent.anchor_due_date,
          v_parent.last_due_date,
          v_parent.next_due_date,
          v_parent.id,
          v_parent.lead_time_days
        )
        RETURNING id INTO v_new_id;

        child_id := v_new_id;
        RETURN NEXT;
      END IF;

      UPDATE work_orders
      SET
        last_due_date = v_due,
        next_due_date = wo_add_interval_to_ymd(
          v_due,
          v_parent.interval_value,
          v_parent.interval_time_type
        ),
        updated_at = now()
      WHERE id = v_parent.id;

      SELECT * INTO v_parent FROM work_orders WHERE id = v_parent.id;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;
