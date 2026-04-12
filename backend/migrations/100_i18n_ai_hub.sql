-- AI hub page + shell icon (EN + DE). Idempotent.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'shell.ai_hub_aria', 'Open AI assistant'),
('en', 'nav.ai', 'AI assistant'),
('en', 'ai.hub_title', 'AI assistant'),
('en', 'ai.hub_subtitle', 'Turn speech or text into structured drafts. Review results, then create work orders or assets from the main apps — nothing is saved from this page alone.'),
('en', 'ai.hub_no_site', 'Set a working site (sign in or pick a site) to load reference data for AI suggestions.'),
('en', 'ai.hub_not_configured', 'The server has no OpenAI API key configured. AI suggestions are unavailable until OPENAI_API_KEY is set.'),
('en', 'ai.hub_tab_wo', 'Work order draft'),
('en', 'ai.hub_tab_asset', 'Asset draft'),
('en', 'ai.hub_validated_draft', 'Validated draft'),
('en', 'ai.hub_copy_json', 'Copy JSON'),
('en', 'ai.hub_copied', 'Copied to clipboard.'),
('en', 'ai.hub_copy_failed', 'Could not copy to clipboard.'),
('de', 'shell.ai_hub_aria', 'KI-Assistent öffnen'),
('de', 'nav.ai', 'KI-Assistent'),
('de', 'ai.hub_title', 'KI-Assistent'),
('de', 'ai.hub_subtitle', 'Sprache oder Text in strukturierte Entwürfe umwandeln. Ergebnisse prüfen, dann Arbeitsaufträge oder Objekte in den Hauptapps anlegen — diese Seite speichert nichts.'),
('de', 'ai.hub_no_site', 'Arbeitsstandort wählen (Anmeldung oder Standort), damit Referenzdaten für KI-Vorschläge geladen werden.'),
('de', 'ai.hub_not_configured', 'Auf dem Server ist kein OpenAI-API-Schlüssel gesetzt. KI-Vorschläge sind erst nach OPENAI_API_KEY verfügbar.'),
('de', 'ai.hub_tab_wo', 'Störungs-Entwurf'),
('de', 'ai.hub_tab_asset', 'Objekt-Entwurf'),
('de', 'ai.hub_validated_draft', 'Geprüfter Entwurf'),
('de', 'ai.hub_copy_json', 'JSON kopieren'),
('de', 'ai.hub_copied', 'In die Zwischenablage kopiert.'),
('de', 'ai.hub_copy_failed', 'Kopieren in die Zwischenablage fehlgeschlagen.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
