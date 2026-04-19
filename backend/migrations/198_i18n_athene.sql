-- Athene assistant naming + modal strings (EN + DE). Idempotent.
-- Athene talks to the pgvector work_order_embeddings index via
-- POST /api/ai/similar-work-orders and renders ranked matches.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'nav.athene', 'Athene'),
('en', 'shell.athene_aria', 'Open Athene'),
('en', 'athene.title', 'Athene'),
('en', 'athene.agent_title', 'Athene — Vector Search'),
('en', 'athene.label_athene', 'Athene'),
('en', 'athene.subtitle', 'Describe what you are looking for. Athene searches the work-order vector index and returns the closest matches.'),
('en', 'athene.placeholder', 'e.g. "conveyor belt motor replacement"'),
('en', 'athene.search', 'Search'),
('en', 'athene.searching', 'Searching'),
('en', 'athene.status_label', 'Status'),
('en', 'athene.score_tooltip', 'Cosine similarity (100% = identical text)'),
('en', 'athene.matches_summary', 'Top {{count}} matches from the work-order index.'),
('en', 'athene.no_matches', 'No similar work orders found in the vector index.'),
('en', 'athene.response_ready_title', 'Athene reply ready'),
('en', 'athene.response_ready_detail', 'Open Athene to see the matches.'),
('de', 'nav.athene', 'Athene'),
('de', 'shell.athene_aria', 'Athene öffnen'),
('de', 'athene.title', 'Athene'),
('de', 'athene.agent_title', 'Athene — Vektor-Suche'),
('de', 'athene.label_athene', 'Athene'),
('de', 'athene.subtitle', 'Beschreiben Sie, wonach Sie suchen. Athene durchsucht den Vektor-Index der Arbeitsaufträge und liefert die ähnlichsten Treffer.'),
('de', 'athene.placeholder', 'z. B. "Motor am Förderband tauschen"'),
('de', 'athene.search', 'Suchen'),
('de', 'athene.searching', 'Suche läuft'),
('de', 'athene.status_label', 'Status'),
('de', 'athene.score_tooltip', 'Kosinus-Ähnlichkeit (100 % = identischer Text)'),
('de', 'athene.matches_summary', 'Top {{count}} Treffer aus dem Arbeitsauftrags-Index.'),
('de', 'athene.no_matches', 'Keine ähnlichen Arbeitsaufträge im Vektor-Index gefunden.'),
('de', 'athene.response_ready_title', 'Athene-Antwort bereit'),
('de', 'athene.response_ready_detail', 'Öffnen Sie Athene, um die Treffer zu sehen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
