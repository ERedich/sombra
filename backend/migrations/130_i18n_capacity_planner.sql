-- Capacity Planner (maintenance) UI strings (en + de).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'nav.capacity_planner', 'Capacity Planner'),
  ('de', 'nav.capacity_planner', 'Kapazitätsplaner'),

  ('en', 'capacity_planner.title', 'Capacity Planner'),
  ('de', 'capacity_planner.title', 'Kapazitätsplaner'),

  ('en', 'capacity_planner.subtitle', 'Plan work orders on a timeline and assign planned hours to employees within shift planning capacity (SPC).'),
  ('de', 'capacity_planner.subtitle', 'Planen Sie Arbeitsaufträge auf einer Zeitachse und verteilen Sie geplante Stunden auf Mitarbeitende innerhalb der Schichtplanungskapazität (SPC).'),

  ('en', 'capacity_planner.date_from', 'From'),
  ('de', 'capacity_planner.date_from', 'Von'),

  ('en', 'capacity_planner.date_to', 'To'),
  ('de', 'capacity_planner.date_to', 'Bis'),

  ('en', 'capacity_planner.reload', 'Reload'),
  ('de', 'capacity_planner.reload', 'Aktualisieren'),

  ('en', 'capacity_planner.range_invalid', 'The start date must be on or before the end date.'),
  ('de', 'capacity_planner.range_invalid', 'Das Startdatum muss vor oder am Enddatum liegen.'),

  ('en', 'capacity_planner.load_fail', 'Could not load capacity planner data.'),
  ('de', 'capacity_planner.load_fail', 'Kapazitätsplaner-Daten konnten nicht geladen werden.'),

  ('en', 'capacity_planner.panel_gantt', 'Planned work orders'),
  ('de', 'capacity_planner.panel_gantt', 'Geplante Arbeitsaufträge'),

  ('en', 'capacity_planner.panel_capacity', 'Employee capacity by shift'),
  ('de', 'capacity_planner.panel_capacity', 'Mitarbeiterkapazität nach Schicht'),

  ('en', 'capacity_planner.col_work_order', 'Work order'),
  ('de', 'capacity_planner.col_work_order', 'Arbeitsauftrag'),

  ('en', 'capacity_planner.col_employee', 'Employee'),
  ('de', 'capacity_planner.col_employee', 'Mitarbeiter'),

  ('en', 'capacity_planner.empty_gantt', 'No planned work orders overlap this date range.'),
  ('de', 'capacity_planner.empty_gantt', 'Keine geplanten Arbeitsaufträge in diesem Zeitraum.'),

  ('en', 'capacity_planner.empty_capacity', 'No shift assignments in this range. Use Shift Planner to schedule employees.'),
  ('de', 'capacity_planner.empty_capacity', 'Keine Schichtzuweisungen in diesem Zeitraum. Planen Sie im Schichtplaner.'),

  ('en', 'capacity_planner.spc_hint', 'Capacity per cell = shift length on that day × {{pct}}% (SPC). Multiple shifts on the same day add up.'),
  ('de', 'capacity_planner.spc_hint', 'Kapazität pro Zelle = Schichtlänge an diesem Tag × {{pct}} % (SPC). Mehrere Schichten am selben Tag summieren sich.'),

  ('en', 'capacity_planner.cell_cap', 'Cap {{cap}} h · Used {{used}} h · Free {{rem}} h'),
  ('de', 'capacity_planner.cell_cap', 'Kap. {{cap}} h · Belegt {{used}} h · Frei {{rem}} h'),

  ('en', 'capacity_planner.overnight', 'overnight'),
  ('de', 'capacity_planner.overnight', 'Über Mitternacht'),

  ('en', 'capacity_planner.wo_bar_tooltip', 'Drag the bar horizontally to reschedule (not before now). Drag the left handle onto a free capacity cell to assign.'),
  ('de', 'capacity_planner.wo_bar_tooltip', 'Balken ziehen zum Verschieben (nicht vor jetzt). Linken Griff auf eine freie Kapazitätszelle ziehen zum Zuweisen.'),

  ('en', 'capacity_planner.drag_assign_aria', 'Drag to assign to employee capacity'),
  ('de', 'capacity_planner.drag_assign_aria', 'Ziehen, um der Mitarbeiterkapazität zuzuweisen'),

  ('en', 'capacity_planner.no_past_plan', 'Planned start cannot be moved before the current time.'),
  ('de', 'capacity_planner.no_past_plan', 'Geplanter Start darf nicht vor die aktuelle Zeit gelegt werden.'),

  ('en', 'capacity_planner.modal_title', 'Capacity Planner Details'),
  ('de', 'capacity_planner.modal_title', 'Kapazitätsplaner — Details'),

  ('en', 'capacity_planner.modal_wo_section', 'Work order'),
  ('de', 'capacity_planner.modal_wo_section', 'Arbeitsauftrag'),

  ('en', 'capacity_planner.modal_shift_section', 'Shift'),
  ('de', 'capacity_planner.modal_shift_section', 'Schicht'),

  ('en', 'capacity_planner.modal_wo_key', 'Key'),
  ('de', 'capacity_planner.modal_wo_key', 'Nr.'),

  ('en', 'capacity_planner.modal_wo_text', 'Description'),
  ('de', 'capacity_planner.modal_wo_text', 'Kurztext'),

  ('en', 'capacity_planner.modal_wo_status', 'Status'),
  ('de', 'capacity_planner.modal_wo_status', 'Status'),

  ('en', 'capacity_planner.modal_wo_plan', 'Planned'),
  ('de', 'capacity_planner.modal_wo_plan', 'Geplant'),

  ('en', 'capacity_planner.modal_wo_duration', 'Duration'),
  ('de', 'capacity_planner.modal_wo_duration', 'Dauer'),

  ('en', 'capacity_planner.modal_employee', 'Employee'),
  ('de', 'capacity_planner.modal_employee', 'Mitarbeiter'),

  ('en', 'capacity_planner.modal_date', 'Date'),
  ('de', 'capacity_planner.modal_date', 'Datum'),

  ('en', 'capacity_planner.modal_planned_hours', 'Planned hours (SPC bucket for this day)'),
  ('de', 'capacity_planner.modal_planned_hours', 'Geplante Stunden (SPC-Anteil an diesem Tag)'),

  ('en', 'capacity_planner.modal_hours_max', 'Maximum for this edit: {{max}} h (capacity and work order duration).'),
  ('de', 'capacity_planner.modal_hours_max', 'Maximum für diese Eingabe: {{max}} h (Kapazität und Auftragsdauer).'),

  ('en', 'capacity_planner.modal_clear', 'Clear allocation'),
  ('de', 'capacity_planner.modal_clear', 'Zuweisung löschen'),

  ('en', 'capacity_planner.toast_saved', 'Allocation saved.'),
  ('de', 'capacity_planner.toast_saved', 'Zuweisung gespeichert.'),

  ('en', 'capacity_planner.toast_cleared', 'Allocation removed.'),
  ('de', 'capacity_planner.toast_cleared', 'Zuweisung entfernt.'),

  ('en', 'capacity_planner.save_fail', 'Could not save allocation.'),
  ('de', 'capacity_planner.save_fail', 'Zuweisung konnte nicht gespeichert werden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
