-- Shift planner: planning cell modal + roll out tab (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.tab_rollout', 'Roll out'),
  ('de', 'shift_planner.tab_rollout', 'Ausrollen'),
  ('en', 'shift_planner.rollout_hint', 'The pattern is taken from assignments in the current From/To range (toolbar). Set that range on View or Planning, load data, then choose target dates below. Only shift–weekday combinations that already have assignments in the template are applied.'),
  ('de', 'shift_planner.rollout_hint', 'Das Muster wird aus den Zuweisungen im aktuellen Von/Bis-Zeitraum (Toolbar) gebildet. Zeitraum in Ansicht oder Planung wählen, laden, dann Zieldaten unten setzen. Es werden nur Schicht–Wochentag-Kombinationen übernommen, die im Muster bereits Zuweisungen haben.'),
  ('en', 'shift_planner.rollout_template_range', 'Template range'),
  ('de', 'shift_planner.rollout_template_range', 'Musterzeitraum'),
  ('en', 'shift_planner.rollout_pattern_rules', '{{count}} shift–weekday rules in template'),
  ('de', 'shift_planner.rollout_pattern_rules', '{{count}} Schicht–Wochentag-Regeln im Muster'),
  ('en', 'shift_planner.rollout_weekdays', 'Apply on weekdays'),
  ('de', 'shift_planner.rollout_weekdays', 'An Wochentagen anwenden'),
  ('en', 'shift_planner.rollout_target_from', 'Apply from'),
  ('de', 'shift_planner.rollout_target_from', 'Anwenden von'),
  ('en', 'shift_planner.rollout_target_to', 'Apply to'),
  ('de', 'shift_planner.rollout_target_to', 'Anwenden bis'),
  ('en', 'shift_planner.rollout_apply', 'Apply roll out'),
  ('de', 'shift_planner.rollout_apply', 'Ausrollen anwenden'),
  ('en', 'shift_planner.rollout_need_dates', 'Choose apply-from and apply-to dates.'),
  ('de', 'shift_planner.rollout_need_dates', 'Bitte „Anwenden von“ und „Anwenden bis“ wählen.'),
  ('en', 'shift_planner.rollout_no_pattern', 'No assignments in the template range to roll out. Load a range that includes planned shifts first.'),
  ('de', 'shift_planner.rollout_no_pattern', 'Im Musterzeitraum gibt es keine Zuweisungen. Zuerst einen Zeitraum mit Planung laden.'),
  ('en', 'shift_planner.rollout_done', 'Roll out finished: {{created}} created, {{skipped}} skipped (already assigned).'),
  ('de', 'shift_planner.rollout_done', 'Ausrollen abgeschlossen: {{created}} neu, {{skipped}} übersprungen (bereits zugewiesen).'),
  ('en', 'shift_planner.rollout_partial_errors', 'Some operations failed: {{detail}}'),
  ('de', 'shift_planner.rollout_partial_errors', 'Einige Vorgänge sind fehlgeschlagen: {{detail}}'),
  ('en', 'shift_planner.cell_add', 'Add'),
  ('de', 'shift_planner.cell_add', 'Hinzufügen'),
  ('en', 'shift_planner.cell_manage', 'Manage'),
  ('de', 'shift_planner.cell_manage', 'Bearbeiten'),
  ('en', 'shift_planner.assigned_count', '{{count}} assigned'),
  ('de', 'shift_planner.assigned_count', '{{count}} zugewiesen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
