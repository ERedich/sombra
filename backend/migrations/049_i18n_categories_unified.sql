INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'categories.subtitle_admin', 'Manage categories for all sites.'),
('en', 'categories.subtitle_default', 'Categories for sites you can access. New rows use your working site.'),
('de', 'categories.subtitle_admin', 'Kategorien für alle Standorte verwalten.'),
('de', 'categories.subtitle_default', 'Kategorien für zugängliche Standorte. Neue Zeilen für Ihren Arbeitsstandort.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
