-- AI / voice assist UI (EN + DE). Idempotent.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'ai.voice_title', 'Voice & AI assist'),
('en', 'ai.voice_hint', 'Speak or type a description, then apply AI to fill the form. Review every field before saving — drafts are not auto-submitted.'),
('en', 'ai.transcript_label', 'Transcript'),
('en', 'ai.listen', 'Listen'),
('en', 'ai.stop', 'Stop'),
('en', 'ai.apply_suggest', 'Apply AI draft'),
('en', 'ai.stt_unsupported', 'Speech recognition is not available in this browser. Type your transcript instead.'),
('en', 'ai.err_empty_transcript', 'Enter or dictate a transcript first.'),
('en', 'ai.suggest_failed', 'AI suggestion failed.'),
('en', 'ai.unresolved_prefix', 'Please confirm in the form'),
('de', 'ai.voice_title', 'Sprache & KI-Hilfe'),
('de', 'ai.voice_hint', 'Sprechen oder beschreiben Sie den Text, dann KI-Entwurf anwenden. Alle Felder vor dem Speichern prüfen — kein automatisches Speichern.'),
('de', 'ai.transcript_label', 'Transkript'),
('de', 'ai.listen', 'Zuhören'),
('de', 'ai.stop', 'Stopp'),
('de', 'ai.apply_suggest', 'KI-Entwurf anwenden'),
('de', 'ai.stt_unsupported', 'Spracherkennung in diesem Browser nicht verfügbar. Bitte Text eingeben.'),
('de', 'ai.err_empty_transcript', 'Zuerst ein Transkript eingeben oder diktieren.'),
('de', 'ai.suggest_failed', 'KI-Vorschlag fehlgeschlagen.'),
('de', 'ai.unresolved_prefix', 'Bitte im Formular bestätigen')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
