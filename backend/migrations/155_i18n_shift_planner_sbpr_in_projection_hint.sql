-- Mention SBPR in shift planner “custom times disabled” hint (Planning modal).
UPDATE ui_translations
SET value = 'Custom times are disabled while shift blocks are aligned with shift definitions. Turn this off under App parameters → Shifts (code SBPR, shift bound projection).'
WHERE locale = 'en' AND msg_key = 'shift_planner.modal_times_projection_hint';

UPDATE ui_translations
SET value = 'Eigene Zeiten sind deaktiviert, solange Schichtblöcke an die Schichtdefinition gebunden sind. Abschalten unter App-Parameter → Schichten (Kürzel SBPR, Schichtblöcke an Definition ausrichten).'
WHERE locale = 'de' AND msg_key = 'shift_planner.modal_times_projection_hint';
