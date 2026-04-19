-- Athene i18n updates for the RAG pipeline: reason label, revised subtitle and
-- searching/loading copy to match the new "GPT answers over pgvector" behavior.
-- Idempotent: uses ON CONFLICT to update values for existing keys from 198.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'athene.reason_label', 'Why'),
('en', 'athene.subtitle', 'Ask in plain language. Athene searches the work-order vector index and uses GPT to reason over the matches and answer you directly.'),
('en', 'athene.searching', 'Thinking'),
('en', 'athene.placeholder', 'e.g. "top 5 breakdowns this month" or "what failed on pump P-12?"'),
('en', 'athene.matches_summary', '{{count}} relevant work orders.'),
('en', 'athene.no_matches', 'No relevant work orders found.'),
('de', 'athene.reason_label', 'Warum'),
('de', 'athene.subtitle', 'Fragen Sie in natürlicher Sprache. Athene durchsucht den Vektor-Index der Arbeitsaufträge und nutzt GPT, um die Treffer zu bewerten und Ihnen direkt zu antworten.'),
('de', 'athene.searching', 'Denke nach'),
('de', 'athene.placeholder', 'z. B. "Top 5 Störungen diesen Monat" oder "Was ist an Pumpe P-12 kaputtgegangen?"'),
('de', 'athene.matches_summary', '{{count}} relevante Arbeitsaufträge.'),
('de', 'athene.no_matches', 'Keine relevanten Arbeitsaufträge gefunden.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
