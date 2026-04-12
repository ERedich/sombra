INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'ai.stt_browser_unavailable', 'Speech recognition is not available in this browser. Use Chrome or Edge (or Safari on Apple devices), or type the transcript below. Secure HTTPS or localhost is required in some browsers.'),
('de', 'ai.stt_browser_unavailable', 'Spracherkennung ist in diesem Browser nicht verfügbar. Nutzen Sie Chrome oder Edge (oder Safari auf Apple-Geräten), oder geben Sie das Transkript unten ein. Manche Browser verlangen HTTPS oder localhost.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
