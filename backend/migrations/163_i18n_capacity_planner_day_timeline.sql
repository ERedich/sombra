-- Capacity planner: UTC day timeline dialog (Gantt header).

INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'capacity_planner.day_timeline_title', 'Day timeline (UTC) — {{date}}'),
  ('de', 'capacity_planner.day_timeline_title', 'Tageszeitachse (UTC) — {{date}}'),

  ('en', 'capacity_planner.day_timeline_utc_hint', 'Axis: 24 hours UTC. Drag a work order to snap its planned start to an hour on this day (duration unchanged).'),
  ('de', 'capacity_planner.day_timeline_utc_hint', 'Achse: 24 Stunden UTC. Ziehen Sie einen Arbeitsauftrag, um den Planstart auf eine volle Stunde an diesem Tag zu legen (Dauer unverändert).'),

  ('en', 'capacity_planner.day_timeline_open_aria', 'Open UTC day timeline for {{date}}'),
  ('de', 'capacity_planner.day_timeline_open_aria', 'UTC-Tageszeitachse öffnen für {{date}}'),

  ('en', 'capacity_planner.day_timeline_wo_locked_tooltip', 'Planned duration over 24 hours — move on the week timeline only.'),
  ('de', 'capacity_planner.day_timeline_wo_locked_tooltip', 'Geplante Dauer über 24 Stunden — Verschieben nur auf der Wochen-Zeitachse.'),

  ('en', 'capacity_planner.day_timeline_wo_move_tooltip', 'Drag onto the hour grid to set planned start (UTC, full hours).'),
  ('de', 'capacity_planner.day_timeline_wo_move_tooltip', 'Auf das Stundenraster ziehen, um den Planstart zu setzen (UTC, volle Stunden).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
