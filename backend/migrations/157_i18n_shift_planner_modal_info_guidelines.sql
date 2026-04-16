-- Shift planner cell modal: info toggle + in-modal Guidelines (Info messages subsection).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'shift_planner.modal_info_toggle_show_aria', 'Show contextual info messages'),
  ('de', 'shift_planner.modal_info_toggle_show_aria', 'Kontext-Hinweise anzeigen'),
  ('en', 'shift_planner.modal_info_toggle_hide_aria', 'Hide contextual info messages'),
  ('de', 'shift_planner.modal_info_toggle_hide_aria', 'Kontext-Hinweise ausblenden'),
  ('en', 'shift_planner.modal_info_toggle_show_tooltip', 'Show info messages (projection and overnight hints)'),
  ('de', 'shift_planner.modal_info_toggle_show_tooltip', 'Infomeldungen anzeigen (Hinweise zu SBPR und Nachtschicht)'),
  ('en', 'shift_planner.modal_info_toggle_hide_tooltip', 'Hide info messages'),
  ('de', 'shift_planner.modal_info_toggle_hide_tooltip', 'Infomeldungen ausblenden'),
  ('en', 'shift_planner.modal_guidelines_title', 'Guidelines'),
  ('de', 'shift_planner.modal_guidelines_title', 'Richtlinien'),
  ('en', 'shift_planner.modal_guidelines_info_messages_title', 'Info messages'),
  ('de', 'shift_planner.modal_guidelines_info_messages_title', 'Infomeldungen'),
  ('en', 'shift_planner.modal_guidelines_info_messages_body', 'Blue info banners in the assignment time section are hidden by default so the form stays compact. Use the info icon in the dialog header (left of minimize) to show or hide them. When visible, they explain shift-block projection (SBPR) and overnight end-time behaviour for this modal.'),
  ('de', 'shift_planner.modal_guidelines_info_messages_body', 'Die blauen Infomeldungen im Bereich Schichtzeiten sind standardmäßig ausgeblendet, damit die Maske übersichtlich bleibt. Über das Info-Symbol in der Dialogkopfzeile (links neben Minimieren) blenden Sie sie ein oder aus. Wenn sichtbar, erläutern sie SBPR (Schichtblöcke an Definition) und das Ende bei Nachtschichten in diesem Dialog.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
