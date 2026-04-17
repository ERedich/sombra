/** Shared SELECT for work order list/detail joins (sites, assets, types, …). */
export const WORK_ORDERS_LIST_SQL = `
SELECT w.id, w.site_id, w.wo_key, w.short_text, w.asset_id, w.costcenter_id,
       w.instruction_text, w.plan_start, w.plan_end, w.work_type_id, w.status,
       w.hold_reason,
       w.work_plan_id, w.work_plan_key, w.planned_duration, w.workgroup_id,
       w.created_at, w.updated_at, w.created_by, w.updated_by,
       st.key AS site_key, st.name AS site_name, st.colour AS site_colour,
       a.key AS asset_key, a.name AS asset_name,
       cc.key AS costcenter_key, cc.name AS costcenter_name,
       cb.login_name AS created_by_login_name,
       ub.login_name AS updated_by_login_name,
       wp.interval_count AS work_plan_interval_count,
       wp.interval_time_type AS work_plan_interval_time_type,
       wp.next_due_at AS work_plan_next_due_at,
       wt.key AS work_type_key, wt.name AS work_type_name, wt.colour AS work_type_colour,
       cat.key AS category_key, cat.name AS category_name,
       wg.key AS workgroup_key, wg.name AS workgroup_name,
       false AS has_material_assignment,
       EXISTS(
         SELECT 1
         FROM work_order_employees woe
         WHERE woe.work_order_id = w.id
       ) AS has_employee_assignment,
       COALESCE(
         (
           SELECT array_agg(woe.employee_id::text ORDER BY woe.employee_id::text)
           FROM work_order_employees woe
           WHERE woe.work_order_id = w.id
         ),
         ARRAY[]::text[]
       ) AS assigned_employee_ids,
       (SELECT COUNT(*)::int FROM work_instructions wi WHERE wi.work_order_id = w.id)
         AS work_instruction_count,
       (SELECT COUNT(*)::int FROM work_instructions wi
         WHERE wi.work_order_id = w.id AND wi.done = true)
         AS work_instruction_done_count
FROM work_orders w
INNER JOIN sites st ON st.id = w.site_id
INNER JOIN assets a ON a.id = w.asset_id
INNER JOIN work_types wt ON wt.id = w.work_type_id
INNER JOIN workgroups wg ON wg.id = w.workgroup_id
LEFT JOIN categories cat ON cat.id = w.category_id
LEFT JOIN costcenters cc ON cc.id = w.costcenter_id
LEFT JOIN users cb ON cb.id = w.created_by
LEFT JOIN users ub ON ub.id = w.updated_by
LEFT JOIN work_plans wp ON wp.id = w.work_plan_id
`
