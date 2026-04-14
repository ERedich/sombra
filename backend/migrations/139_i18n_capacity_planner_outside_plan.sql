-- Capacity Planner: cannot assign shift slot outside WO plan window (UTC days).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  (
    'en',
    'capacity_planner.drop_outside_plan',
    'That day is outside this work order''s planned period (plan start–end, UTC). Assign only on days the bar covers.'
  ),
  (
    'de',
    'capacity_planner.drop_outside_plan',
    'Dieser Tag liegt außerhalb des Planzeitraums dieses Auftrags (Planbeginn–ende, UTC). Zuweisen nur an Tagen, die der Balken abdeckt.'
  )
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
