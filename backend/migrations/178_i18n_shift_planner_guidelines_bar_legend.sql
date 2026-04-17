-- Shift planner Guidelines → Visualization: bar legend (shared pattern with month scheduler WO types).

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'shift_planner.modal_guidelines_legend_bars_title', 'Bar legend'),
('en', 'shift_planner.modal_guidelines_legend_bars_body', 'Small squares use the same “visualization bar” styling as assignment blocks: a soft fill and border mixed from an accent colour. The toolbar legend above lists presence states; the month scheduler uses the same pattern for work order types.'),
('en', 'shift_planner.modal_guidelines_legend_bars_example_title', 'Example'),
('en', 'shift_planner.modal_guidelines_legend_demo_scheduled', 'Scheduled'),
('en', 'shift_planner.modal_guidelines_legend_demo_present', 'Present'),

('de', 'shift_planner.modal_guidelines_legend_bars_title', 'Balken-Legende'),
('de', 'shift_planner.modal_guidelines_legend_bars_body', 'Die kleinen Quadrate nutzen dieselbe „Visualisierungs-Balken“-Optik wie Zuweisungsblöcke: weiche Fläche und Rand gemischt aus einer Akzentfarbe. Die Legende in der Toolbar zeigt Anwesenheitsstatus; der Monatskalender nutzt dasselbe Muster für Arbeitsauftrags-Typen.'),
('de', 'shift_planner.modal_guidelines_legend_bars_example_title', 'Beispiel'),
('de', 'shift_planner.modal_guidelines_legend_demo_scheduled', 'Geplant'),
('de', 'shift_planner.modal_guidelines_legend_demo_present', 'Anwesend')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
