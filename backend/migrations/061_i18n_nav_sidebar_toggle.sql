INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'shell.nav_collapse', 'Collapse navigation'),
  ('en', 'shell.nav_expand', 'Expand navigation'),
  ('de', 'shell.nav_collapse', 'Navigation einklappen'),
  ('de', 'shell.nav_expand', 'Navigation ausklappen')
ON CONFLICT (locale, msg_key) DO NOTHING;
