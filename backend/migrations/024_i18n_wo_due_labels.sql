-- DE: "Aktuelle Fälligkeit" → "Fälligkeit"; clarify next-due preview hint (EN + DE)

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('de', 'wo.label_current_due', 'Fälligkeit')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wo.next_due_computed', 'Preview from current settings (one interval after last due or due date; matches saved values).'),
('de', 'wo.next_due_computed', 'Vorschau aus den aktuellen Einstellungen (ein Intervall nach letzter Fälligkeit bzw. Fälligkeit; entspricht dem Speichern).')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
