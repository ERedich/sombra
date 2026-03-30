-- Roll-out children: identical to parent except plan_start (stepped date), new wo_key,
-- rolled_out_from_wo_id, and created_by (actor). No short_text suffix; same WO type/interval as parent.

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

  SELECT COALESCE(
    (
      SELECT array_agg(to_char(plan_start::date, 'YYYY-MM-DD') ORDER BY to_char(plan_start::date, 'YYYY-MM-DD'))
      FROM work_orders
      WHERE rolled_out_from_wo_id = p_parent_id
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

    v_child_plan := (v_cursor_ymd || ' 12:00:00+00')::timestamptz;

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
