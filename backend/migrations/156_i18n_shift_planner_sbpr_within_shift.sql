-- SBPR: allow narrowing times inside shift; new validation + detailed hint.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_times_sbpr_contain', 'With SBPR on, start and end must stay within the shift definition (not before the shift start or after the shift end).'),
  ('de', 'shift_planner.modal_times_sbpr_contain', 'Mit SBPR müssen Beginn und Ende innerhalb der Schichtdefinition bleiben (nicht vor Schichtbeginn oder nach Schichtende).'),
  ('en', 'shift_planner.detailed_sbpr_hint', 'Blocks stay aligned to shift definitions (SBPR). Narrow start/end inside the shift window in Planning → cell modal. Drag along the timeline is available when SBPR is off.'),
  ('de', 'shift_planner.detailed_sbpr_hint', 'Blöcke folgen der Schichtdefinition (SBPR). Beginn/Ende innerhalb der Schicht im Planungs-Modal (Zelle) anpassen. Ziehen auf der Zeitachse ist bei ausgeschaltetem SBPR möglich.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

UPDATE ui_translations
SET value = 'SBPR keeps blocks aligned to the shift, but you can still set start/end within the shift hours here (late arrival / early leave inside the window). Turn SBPR off under App parameters → Shifts for wider edits or timeline drag in Detailed.'
WHERE locale = 'en' AND msg_key = 'shift_planner.modal_times_projection_hint';

UPDATE ui_translations
SET value = 'SBPR richtet Blöcke an der Schicht aus; Sie können hier dennoch Beginn und Ende innerhalb der Schichtzeiten setzen (später kommen / früher gehen innerhalb des Fensters). SBPR unter App-Parameter → Schichten aus für freiere Bearbeitung oder Ziehen in der Detailansicht.'
WHERE locale = 'de' AND msg_key = 'shift_planner.modal_times_projection_hint';
