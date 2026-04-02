-- Navigation: Home label + grouped section titles + empty submenu hint
INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'nav.home', 'Home'),
  ('en', 'nav.section_user_management', 'User Management'),
  ('en', 'nav.section_settings', 'Settings'),
  ('en', 'nav.section_administration', 'Administration'),
  ('en', 'nav.section_basic_data', 'Basic Data'),
  ('en', 'nav.section_maintenance', 'Maintenance'),
  ('en', 'nav.section_service', 'Service'),
  ('en', 'nav.section_purchase', 'Purchase'),
  ('en', 'nav.section_material', 'Material'),
  ('en', 'shell.nav_section_empty', 'No items yet.'),
  ('de', 'nav.home', 'Startseite'),
  ('de', 'nav.section_user_management', 'Benutzerverwaltung'),
  ('de', 'nav.section_settings', 'Einstellungen'),
  ('de', 'nav.section_administration', 'Administration'),
  ('de', 'nav.section_basic_data', 'Stammdaten'),
  ('de', 'nav.section_maintenance', 'Instandhaltung'),
  ('de', 'nav.section_service', 'Service'),
  ('de', 'nav.section_purchase', 'Einkauf'),
  ('de', 'nav.section_material', 'Material'),
  ('de', 'shell.nav_section_empty', 'Noch keine Einträge.')
ON CONFLICT (locale, msg_key) DO NOTHING;
