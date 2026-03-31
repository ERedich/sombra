INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'wp.cron_debug_label', 'WO generator (debug)'),
('en', 'wp.cron_debug_hint', 'Approximate countdown; server cron runs every 5 minutes.'),
('de', 'wp.cron_debug_label', 'AA-Generator (Debug)'),
('de', 'wp.cron_debug_hint', 'Ungefährer Countdown; Server-Cron alle 5 Minuten.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
