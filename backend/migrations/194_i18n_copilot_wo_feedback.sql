-- Kira: confirm / success strings for WO feedback (Rückmeldung / Zeiterfassung) from copilot.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_wo_feedback', 'Report feedback for WO {{wo_key}} ({{short_text}})'),
('de', 'copilot.confirm_wo_feedback', 'Rückmeldung für AA {{wo_key}} ({{short_text}}) erfassen'),
('en', 'copilot.confirm_wo_feedback_btn', 'Report feedback'),
('de', 'copilot.confirm_wo_feedback_btn', 'Rückmeldung buchen'),
('en', 'copilot.wo_feedback_applied', 'Feedback saved.'),
('de', 'copilot.wo_feedback_applied', 'Rückmeldung gespeichert.'),
('en', 'copilot.wo_feedback_hours_suffix', 'h'),
('de', 'copilot.wo_feedback_hours_suffix', 'h'),
('en', 'copilot.wo_feedback_total_label', 'Total'),
('de', 'copilot.wo_feedback_total_label', 'Gesamt'),
('en', 'copilot.wo_feedback_target_status_label', 'Target status'),
('de', 'copilot.wo_feedback_target_status_label', 'Zielstatus'),
('en', 'copilot.wo_feedback_target_status_done', 'Done (close work order)'),
('de', 'copilot.wo_feedback_target_status_done', 'Erledigt (Auftrag abschließen)'),
('en', 'copilot.wo_feedback_target_status_on_hold', 'On hold'),
('de', 'copilot.wo_feedback_target_status_on_hold', 'Wartend'),
('en', 'copilot.wo_feedback_hold_reason_label', 'Hold reason'),
('de', 'copilot.wo_feedback_hold_reason_label', 'Wartegrund')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
