-- Month scheduler: WO work-type legend (replaces personal type chips).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'mcal.legend_wo_types_head', 'Work order types'),
('en', 'mcal.legend_wo_types_empty', 'No work orders for this site — nothing to show in the legend yet.'),

('de', 'mcal.legend_wo_types_head', 'Arbeitsauftrags-Typen'),
('de', 'mcal.legend_wo_types_empty', 'Keine Arbeitsaufträge für diese Stätte — die Legende ist noch leer.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
