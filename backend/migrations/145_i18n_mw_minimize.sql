-- Minimize / restore for CRUD modal windows (en + de).
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'common.minimize', 'Minimize'),
  ('de', 'common.minimize', 'Minimieren'),
  ('en', 'common.restore', 'Restore'),
  ('de', 'common.restore', 'Wiederherstellen'),
  ('en', 'mw.minimize_aria', 'Minimize dialog'),
  ('de', 'mw.minimize_aria', 'Dialog minimieren'),
  ('en', 'mw.restore_aria', 'Restore dialog'),
  ('de', 'mw.restore_aria', 'Dialog wiederherstellen'),
  ('en', 'mw.dock_aria', 'Minimized dialog'),
  ('de', 'mw.dock_aria', 'Minimierter Dialog')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
