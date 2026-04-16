-- Week Gantt: tooltip when planned start (local date) is outside the visible week — drag move disabled.

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  (
    'en',
    'capacity_planner.week_timeline_wo_locked_tooltip',
    'Planned start is outside this week — navigate to the week that contains the start date to move.'
  ),
  (
    'de',
    'capacity_planner.week_timeline_wo_locked_tooltip',
    'Planbeginn liegt außerhalb dieser Woche — zur Kalenderwoche mit dem Planbeginn wechseln, um zu verschieben.'
  )
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
