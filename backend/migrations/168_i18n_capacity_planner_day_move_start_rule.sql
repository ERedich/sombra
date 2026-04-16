-- Day Gantt: lock tooltip when WO does not start on the focused day (tail-only segment).

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  (
    'en',
    'capacity_planner.day_timeline_wo_locked_tooltip',
    'Planned start is not on this day — move this work order on the week timeline.'
  ),
  (
    'de',
    'capacity_planner.day_timeline_wo_locked_tooltip',
    'Planbeginn liegt nicht an diesem Tag — Auftrag auf der Wochen-Zeitachse verschieben.'
  )
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
