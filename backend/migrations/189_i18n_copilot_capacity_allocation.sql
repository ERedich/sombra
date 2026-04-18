-- Kira: confirm capacity allocation from copilot
INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'copilot.confirm_capacity_allocation', 'Apply capacity allocation for WO {{wo_key}} ({{short_text}})'),
('de', 'copilot.confirm_capacity_allocation', 'Kapazitätszuweisung für AA {{wo_key}} ({{short_text}}) anwenden'),
('en', 'copilot.confirm_capacity_allocation_btn', 'Apply allocation'),
('de', 'copilot.confirm_capacity_allocation_btn', 'Zuweisung anwenden'),
('en', 'copilot.capacity_allocation_applied', 'Capacity allocation updated.'),
('de', 'copilot.capacity_allocation_applied', 'Kapazitätszuweisung gespeichert.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
