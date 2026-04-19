-- Kira: confirm / success strings for WO Start and Hold confirmables from copilot.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_wo_start', 'Start WO {{wo_key}} ({{short_text}})'),
('de', 'copilot.confirm_wo_start', 'AA {{wo_key}} ({{short_text}}) starten'),
('en', 'copilot.confirm_wo_start_btn', 'Start work order'),
('de', 'copilot.confirm_wo_start_btn', 'Auftrag starten'),
('en', 'copilot.wo_start_applied', 'Work order started.'),
('de', 'copilot.wo_start_applied', 'Auftrag gestartet.'),
('en', 'copilot.wo_start_current_label', 'Current status'),
('de', 'copilot.wo_start_current_label', 'Aktueller Status'),
('en', 'copilot.wo_start_next_label', 'Next status'),
('de', 'copilot.wo_start_next_label', 'Nächster Status'),
('en', 'copilot.wo_start_next_started', 'Started'),
('de', 'copilot.wo_start_next_started', 'Gestartet'),
('en', 'copilot.wo_start_next_continued', 'Continued'),
('de', 'copilot.wo_start_next_continued', 'Fortgesetzt'),
('en', 'copilot.confirm_wo_hold', 'Put WO {{wo_key}} ({{short_text}}) on hold'),
('de', 'copilot.confirm_wo_hold', 'AA {{wo_key}} ({{short_text}}) auf Wartung setzen'),
('en', 'copilot.confirm_wo_hold_btn', 'Put on hold'),
('de', 'copilot.confirm_wo_hold_btn', 'Auf Wartung setzen'),
('en', 'copilot.wo_hold_applied', 'Work order put on hold.'),
('de', 'copilot.wo_hold_applied', 'Auftrag auf Wartung gesetzt.'),
('en', 'copilot.wo_hold_reason_label', 'Reason'),
('de', 'copilot.wo_hold_reason_label', 'Grund')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
