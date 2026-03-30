-- Cleanup: reverse ui_translations rows added by migration 030_i18n_planning_tabs.sql
-- (Use after rolling back app code that depended on these keys.)
-- Safe to run multiple times.

DELETE FROM ui_translations
WHERE msg_key IN (
  'wo.tab_general',
  'wo.tab_planning',
  'wo.col_wo_type',
  'wo.generate_due_now',
  'wo.unit_day',
  'wo.unit_week',
  'wo.unit_month',
  'wo.unit_year',
  'wo.planning_child_copy'
);
