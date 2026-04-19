-- Mass-seed 2000 Breakdown (BD) work orders with maintenance-context text
-- (short_text, instruction_text, transaction feedback) and matching PCR triples
-- for the first site.
--
-- Idempotency marker: seeded rows end short_text with "[SEED-BD]". Rows from
-- the prior seed version (prefix "SEED-BD:") are purged up front so we end up
-- with a single, clean seed set.
--
-- Consistency rules:
--  * Site scope: lowest-created site, matching 201_pcr_seed.sql.
--  * work_type_id = BD for that site.
--  * workgroup_id = a workgroup of the site that has >= 1 member via
--    workgroup_employees; started / continued / done / feedback employees
--    all come from that workgroup (same site trigger on transactions + wo_emp).
--  * asset_id from the same site, costcenter copied from the asset.
--  * PCR triple is always hierarchically consistent:
--    problem -> cause (problem_id = problem) -> remedy (cause_id = cause).
--  * Feedback text explicitly references the selected problem / cause / remedy
--    so the free text matches the PCR fields on the WO feedback tab.

DO $$
DECLARE
  target_site_id UUID;
  bd_type_id UUID;
  actor_user_id UUID;
  existing_seed INTEGER;
  wg_with_members INTEGER;
  asset_count INTEGER;
  pcr_problem_count INTEGER;

  i INTEGER;
  v_wg_id UUID;
  v_emp_id UUID;
  v_extra_emp_id UUID;
  v_asset_id UUID;
  v_asset_key TEXT;
  v_asset_name TEXT;
  v_cc_id UUID;
  v_cat_id UUID;
  v_wo_id UUID;

  v_problem_id UUID;
  v_problem_name TEXT;
  v_cause_id UUID;
  v_cause_name TEXT;
  v_remedy_id UUID;
  v_remedy_name TEXT;

  v_duration NUMERIC(12, 2);
  v_hours NUMERIC(12, 2);
  v_extra_hours NUMERIC(12, 2);
  v_plan_start TIMESTAMPTZ;
  v_plan_end TIMESTAMPTZ;
  v_done_at TIMESTAMPTZ;

  v_short_text TEXT;
  v_instruction TEXT;
  v_feedback TEXT;
  v_asset_label TEXT;
  v_subject_variant INTEGER;
BEGIN
  -- Purge rows from the older seed pattern so we don't mix seed variants.
  DELETE FROM work_orders
  WHERE short_text LIKE 'SEED-BD: %';

  SELECT id INTO target_site_id
  FROM sites
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1;
  IF target_site_id IS NULL THEN
    RAISE NOTICE 'No site found; skipping BD mass seed.';
    RETURN;
  END IF;

  SELECT id INTO bd_type_id
  FROM work_types
  WHERE site_id = target_site_id AND key = 'BD';
  IF bd_type_id IS NULL THEN
    RAISE NOTICE 'No BD work type for site %; skipping.', target_site_id;
    RETURN;
  END IF;

  SELECT id INTO actor_user_id
  FROM users
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1;
  IF actor_user_id IS NULL THEN
    RAISE NOTICE 'No user available as created_by; skipping.';
    RETURN;
  END IF;

  SELECT count(*) INTO existing_seed
  FROM work_orders
  WHERE site_id = target_site_id
    AND work_type_id = bd_type_id
    AND short_text LIKE '%[SEED-BD]';
  IF existing_seed >= 2000 THEN
    RAISE NOTICE 'BD mass seed already present (% rows); skipping.', existing_seed;
    RETURN;
  END IF;

  SELECT count(*) INTO wg_with_members
  FROM workgroups wg
  WHERE wg.site_id = target_site_id
    AND EXISTS (SELECT 1 FROM workgroup_employees we WHERE we.workgroup_id = wg.id);
  IF wg_with_members = 0 THEN
    RAISE NOTICE 'No workgroup with members for site %; skipping.', target_site_id;
    RETURN;
  END IF;

  SELECT count(*) INTO asset_count
  FROM assets WHERE site_id = target_site_id;
  IF asset_count = 0 THEN
    RAISE NOTICE 'No assets for site %; skipping.', target_site_id;
    RETURN;
  END IF;

  SELECT count(*) INTO pcr_problem_count
  FROM pcr_problems WHERE site_id = target_site_id;
  IF pcr_problem_count = 0 THEN
    RAISE NOTICE 'No PCR problems for site %; skipping.', target_site_id;
    RETURN;
  END IF;

  FOR i IN (existing_seed + 1)..2000 LOOP
    SELECT wg.id INTO v_wg_id
    FROM workgroups wg
    WHERE wg.site_id = target_site_id
      AND EXISTS (SELECT 1 FROM workgroup_employees we WHERE we.workgroup_id = wg.id)
    ORDER BY random()
    LIMIT 1;

    SELECT we.employee_id INTO v_emp_id
    FROM workgroup_employees we
    WHERE we.workgroup_id = v_wg_id
    ORDER BY random()
    LIMIT 1;

    IF v_emp_id IS NULL THEN
      CONTINUE;
    END IF;

    v_extra_emp_id := NULL;
    IF random() < 0.3 THEN
      SELECT we.employee_id INTO v_extra_emp_id
      FROM workgroup_employees we
      WHERE we.workgroup_id = v_wg_id
        AND we.employee_id <> v_emp_id
      ORDER BY random()
      LIMIT 1;
    END IF;

    SELECT a.id, a.key, a.name, a.costcenter_id
      INTO v_asset_id, v_asset_key, v_asset_name, v_cc_id
    FROM assets a
    WHERE a.site_id = target_site_id
    ORDER BY random()
    LIMIT 1;

    IF v_asset_id IS NULL THEN
      CONTINUE;
    END IF;
    v_asset_label := coalesce(nullif(v_asset_key, '') || ' ' || coalesce(v_asset_name, ''),
                              v_asset_name, v_asset_key, 'Anlage');

    SELECT c.id INTO v_cat_id
    FROM categories c
    WHERE c.site_id = target_site_id
    ORDER BY random()
    LIMIT 1;

    SELECT p.id, p.name INTO v_problem_id, v_problem_name
    FROM pcr_problems p
    WHERE p.site_id = target_site_id
    ORDER BY random()
    LIMIT 1;

    SELECT c.id, c.name INTO v_cause_id, v_cause_name
    FROM pcr_causes c
    WHERE c.site_id = target_site_id
      AND c.problem_id = v_problem_id
    ORDER BY random()
    LIMIT 1;

    IF v_cause_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT r.id, r.name INTO v_remedy_id, v_remedy_name
    FROM pcr_remedies r
    WHERE r.site_id = target_site_id
      AND r.cause_id = v_cause_id
    ORDER BY random()
    LIMIT 1;

    IF v_remedy_id IS NULL THEN
      CONTINUE;
    END IF;

    v_duration := round((0.5 + random() * 5.5)::numeric, 2);
    v_plan_start := now() - (random() * interval '365 days');
    v_plan_end := v_plan_start + (v_duration * interval '1 hour');
    v_done_at := v_plan_end + (random() * interval '120 minutes');

    v_hours := round((0.25 + random() * (v_duration + 0.5))::numeric, 2);
    IF v_hours < 0.25 THEN v_hours := 0.25; END IF;

    v_subject_variant := floor(random() * 3)::int;
    v_short_text := left(
      CASE v_subject_variant
        WHEN 0 THEN format('Notreparatur %s – %s [SEED-BD]', v_asset_label, v_problem_name)
        WHEN 1 THEN format('Störungsbeseitigung %s: %s [SEED-BD]', v_asset_label, v_problem_name)
        ELSE        format('Instandsetzung %s nach %s [SEED-BD]', v_asset_label, v_problem_name)
      END,
      200
    );

    v_instruction := left(format(
'Breakdown-Meldung aus Produktion für Anlage %s.
Symptom: %s. Vermutete Ursache laut Betreiber: %s.

Durchzuführende Arbeiten:
1) Anlage sicher abstellen und gegen Wiedereinschalten sichern (LOTO).
2) Spannungs- und Medienfreiheit prüfen, Arbeitsbereich absperren.
3) Fehlerbild aufnehmen und Ursache "%s" durch Sicht- bzw. Messprüfung verifizieren.
4) Maßnahme durchführen: %s. Ersatzteile gemäß Stückliste / Lager einsetzen.
5) Funktionstest, Probelauf und Übergabe an Produktion dokumentieren.

Priorität: hoch (Produktionsausfall). Persönliche Schutzausrüstung gemäß GA der Anlage %s.',
      v_asset_label,
      v_problem_name,
      v_cause_name,
      v_cause_name,
      v_remedy_name,
      v_asset_label
    ), 2000);

    v_feedback := left(format(
'Anlage %s auf Breakdown-Meldung "%s" angefahren.
LOTO durchgeführt, Spannungs- und Medienfreiheit bestätigt, Arbeitsbereich abgesperrt.
Fehlerbild aufgenommen, Ursache "%s" durch Sicht- und Messprüfung verifiziert.
Maßnahme umgesetzt: %s. Anschließend Funktionstest und Probelauf erfolgreich, Anlage an Produktion übergeben und Auftrag abgeschlossen.
Arbeitszeit %s h (Anfahrt, Diagnose, Instandsetzung, Funktionstest, Dokumentation).',
      v_asset_label,
      v_problem_name,
      v_cause_name,
      v_remedy_name,
      v_hours::text
    ), 10000);

    INSERT INTO work_orders (
      site_id, wo_key, short_text, asset_id, costcenter_id, instruction_text,
      plan_start, plan_end, work_type_id, status,
      planned_duration, category_id, workgroup_id,
      started_by_employee_id, continued_by_employee_id,
      done_at, done_by_employee_id,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      target_site_id, nextval('work_order_wo_key_seq'),
      v_short_text, v_asset_id, v_cc_id, v_instruction,
      v_plan_start, v_plan_end, bd_type_id, 'done',
      v_duration, v_cat_id, v_wg_id,
      v_emp_id, v_emp_id,
      v_done_at, v_emp_id,
      actor_user_id, actor_user_id, v_plan_start, v_done_at
    )
    RETURNING id INTO v_wo_id;

    INSERT INTO work_order_employees (work_order_id, employee_id, created_at)
    VALUES (v_wo_id, v_emp_id, v_plan_start)
    ON CONFLICT DO NOTHING;

    IF v_extra_emp_id IS NOT NULL THEN
      INSERT INTO work_order_employees (work_order_id, employee_id, created_at)
      VALUES (v_wo_id, v_extra_emp_id, v_plan_start)
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO transactions (
      work_order_id, type, employee_id, created_by_user_id, hours, feedback_text,
      pcr_problem_id, pcr_cause_id, pcr_remedy_id, created_at
    ) VALUES (
      v_wo_id, 'INT', v_emp_id, actor_user_id, v_hours, v_feedback,
      v_problem_id, v_cause_id, v_remedy_id, v_done_at
    );

    IF v_extra_emp_id IS NOT NULL THEN
      v_extra_hours := round((0.25 + random() * 2)::numeric, 2);
      INSERT INTO transactions (
        work_order_id, type, employee_id, created_by_user_id, hours, feedback_text,
        pcr_problem_id, pcr_cause_id, pcr_remedy_id, created_at
      ) VALUES (
        v_wo_id, 'INT', v_extra_emp_id, actor_user_id, v_extra_hours,
        left(format(
'Assistenz bei Instandsetzung von %s zur Störung "%s".
Ersatzteile aus Lager bereitgestellt, zweite Hand bei Maßnahme "%s", gemeinsam Funktionstest und Probelauf durchgeführt.
Arbeitszeit %s h (Assistenz, Ersatzteilhandling, Probelauf).',
          v_asset_label, v_problem_name, v_remedy_name, v_extra_hours::text
        ), 10000),
        v_problem_id, v_cause_id, v_remedy_id, v_done_at
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'BD mass seed completed for site %.', target_site_id;
END $$;
