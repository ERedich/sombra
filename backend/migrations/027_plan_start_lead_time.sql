-- Plan start = due date minus lead time (calendar days), UTC noon on that YMD.
-- Applies to roll-out children, generate-due children, and backfills existing rolled-out rows.

CREATE OR REPLACE FUNCTION wo_plan_start_from_due_and_lead(
  p_due date,
  p_lead integer
) RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    to_char(p_due - COALESCE(p_lead, 0), 'YYYY-MM-DD') || ' 12:00:00+00'
  )::timestamptz;
$$;

-- Backfill: children previously stored plan_start = due date; shift to due - lead.
UPDATE work_orders c
SET plan_start = wo_plan_start_from_due_and_lead(
  (c.plan_start AT TIME ZONE 'UTC')::date,
  c.lead_time_days
)
WHERE c.rolled_out_from_wo_id IS NOT NULL
  AND c.lead_time_days > 0;

CREATE OR REPLACE FUNCTION wo_roll_out_children(
  p_parent_id uuid,
  p_want_count integer,
  p_actor_id uuid
) RETURNS TABLE (child_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent record;
  v_cursor date;
  v_cursor_ymd text;
  v_taken text[];
  v_created int := 0;
  v_guard int := 0;
  v_max_guard int := 5000;
  v_step numeric;
  v_unit text;
  v_child_plan timestamptz;
  v_pe timestamptz;
  v_new_id uuid;
BEGIN
  IF p_want_count < 1 OR p_want_count > 100 THEN
    RAISE EXCEPTION 'roll_out_count must be between 1 and 100';
  END IF;

  SELECT * INTO v_parent FROM work_orders WHERE id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent work order not found.';
  END IF;

  IF v_parent.rolled_out_from_wo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Roll out is only available on the source work order, not on rolled-out copies.';
  END IF;

  IF v_parent.wo_type <> 'pm' OR NOT v_parent.interval_enabled OR v_parent.anchor_due_date IS NULL THEN
    RAISE EXCEPTION 'Roll out requires wo_type pm, interval enabled, and a current due date.';
  END IF;

  IF v_parent.interval_value IS NULL OR v_parent.interval_value <= 0 THEN
    RAISE EXCEPTION 'Roll out requires a valid interval value and time type.';
  END IF;

  IF v_parent.interval_time_type IS NULL OR v_parent.interval_time_type NOT IN ('day', 'week', 'month', 'year') THEN
    RAISE EXCEPTION 'Roll out requires a valid interval value and time type.';
  END IF;

  v_step := v_parent.interval_value;
  v_unit := v_parent.interval_time_type;
  v_pe := v_parent.plan_end;
  v_cursor := v_parent.anchor_due_date;

  -- Track due dates already covered: plan_start + lead = due for each child.
  SELECT COALESCE(
    (
      SELECT array_agg(
        to_char((c.plan_start::date + c.lead_time_days), 'YYYY-MM-DD')
        ORDER BY to_char((c.plan_start::date + c.lead_time_days), 'YYYY-MM-DD')
      )
      FROM work_orders c
      WHERE c.rolled_out_from_wo_id = p_parent_id
    ),
    ARRAY[]::text[]
  ) INTO v_taken;

  WHILE v_created < p_want_count AND v_guard < v_max_guard LOOP
    v_guard := v_guard + 1;
    v_cursor := wo_add_interval_to_ymd(v_cursor, v_step, v_unit);
    v_cursor_ymd := to_char(v_cursor, 'YYYY-MM-DD');
    IF v_cursor_ymd = ANY (v_taken) THEN
      CONTINUE;
    END IF;
    v_taken := array_append(v_taken, v_cursor_ymd);

    v_child_plan := wo_plan_start_from_due_and_lead(v_cursor, v_parent.lead_time_days);

    IF v_pe IS NOT NULL AND v_child_plan > v_pe THEN
      RAISE EXCEPTION 'plan_end must be on or after plan_start for each roll-out row.';
    END IF;

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
      p_parent_id,
      v_parent.lead_time_days
    )
    RETURNING id INTO v_new_id;

    child_id := v_new_id;
    RETURN NEXT;
    v_created := v_created + 1;
  END LOOP;

  IF v_created < p_want_count THEN
    RAISE EXCEPTION 'Could not create enough roll-out rows (too many dates already used for this work order).';
  END IF;

  RETURN;
END;
$$;

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
      v_child_plan := wo_plan_start_from_due_and_lead(v_due, v_parent.lead_time_days);

      IF v_pe IS NOT NULL AND v_child_plan > v_pe THEN
        RAISE EXCEPTION 'plan_end must be on or after plan_start for each generated row (wo_key=%).', v_parent.wo_key;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM work_orders c
        WHERE c.rolled_out_from_wo_id = v_parent.id
          AND (c.plan_start::date + c.lead_time_days) = v_due
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
