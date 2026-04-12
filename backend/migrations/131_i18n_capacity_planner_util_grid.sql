-- Capacity Planner: utilization grid copy (planned vs total, color legend).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'capacity_planner.panel_capacity', 'Employee utilization'),
  ('de', 'capacity_planner.panel_capacity', 'Mitarbeiterauslastung'),

  ('en', 'capacity_planner.spc_hint', 'Shows planned hours (from capacity assignments) vs maximum hours from assigned shifts times SPC ({{pct}}%). Values are calculated when you load this view. Green: under 50% of capacity. Yellow: 50% up to but not including 100%. Red: 100% or more.'),
  ('de', 'capacity_planner.spc_hint', 'Zeigt geplante Stunden (aus Kapazitätszuweisungen) im Verhältnis zur Höchststunde aus zugewiesenen Schichten mal SPC ({{pct}} %). Werte werden beim Laden berechnet. Grün: unter 50 % der Kapazität. Gelb: 50 % bis unter 100 %. Rot: 100 % oder mehr.'),

  ('en', 'capacity_planner.cell_planned_total', '{{planned}} / {{total}} h'),
  ('de', 'capacity_planner.cell_planned_total', '{{planned}} / {{total}} h')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
