/**
 * Shared SELECT + FROM for the work orders list/detail APIs.
 *
 * `WORK_ORDER_JOINS_SQL` contains only the `FROM ... JOIN ...` portion and is
 * reused by count queries for paginated lists so WHERE clauses stay in sync
 * with the full `WORK_ORDERS_LIST_SQL` SELECT.
 */

export const WORK_ORDER_JOINS_SQL = `
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
LEFT JOIN employees sbe ON sbe.id = w.started_by_employee_id
LEFT JOIN employees cbe ON cbe.id = w.continued_by_employee_id
LEFT JOIN employees dbe ON dbe.id = w.done_by_employee_id
`

export const WORK_ORDERS_LIST_SQL = `
SELECT w.id, w.site_id, w.wo_key, w.short_text, w.asset_id, w.costcenter_id,
       w.instruction_text, w.plan_start, w.plan_end, w.work_type_id, w.status,
       w.hold_reason,
       w.work_plan_id, w.work_plan_key, w.planned_duration, w.workgroup_id,
       w.started_by_employee_id, w.continued_by_employee_id,
       w.done_at, w.done_by_employee_id,
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
       sbe.key AS started_by_employee_key, sbe.name AS started_by_employee_name,
       cbe.key AS continued_by_employee_key, cbe.name AS continued_by_employee_name,
       dbe.key AS done_by_employee_key, dbe.name AS done_by_employee_name,
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
${WORK_ORDER_JOINS_SQL}
`
