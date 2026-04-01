-- Plan-linked work orders must use PM work type (matches generator + UI rule).
UPDATE work_orders w
SET work_type_id = wt.id
FROM work_types wt
WHERE w.work_plan_id IS NOT NULL
  AND wt.site_id = w.site_id
  AND wt.key = 'PM'
  AND w.work_type_id <> wt.id;
