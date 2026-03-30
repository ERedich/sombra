INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.field_wo_type', 'WO type'),
('en', 'wo.type_option_bd', 'BD — Breakdown'),
('en', 'wo.type_option_pm', 'PM — Preventive Maintenance'),
('en', 'wo.type_option_cm', 'CM — Corrective Maintenance'),
('de', 'wo.field_wo_type', 'AA-Typ'),
('de', 'wo.type_option_bd', 'BD — Störung'),
('de', 'wo.type_option_pm', 'PM — Vorbeugende Instandhaltung'),
('de', 'wo.type_option_cm', 'CM — Korrektive Instandhaltung')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
