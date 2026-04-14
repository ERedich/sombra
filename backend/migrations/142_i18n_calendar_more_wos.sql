-- Calendar: summary when more work orders exist than shown in a day cell.

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'calendar.more_wos', '+{{count}} more work order(s)'),
  ('de', 'calendar.more_wos', '+{{count}} weitere Arbeitsaufträge')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
