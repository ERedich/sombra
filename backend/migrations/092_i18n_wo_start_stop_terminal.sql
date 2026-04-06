INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'wo.start_stop_disabled_terminal', 'Start and stop are not available for done or closed work orders.'),
  ('de', 'wo.start_stop_disabled_terminal', 'Start und Stopp sind bei erledigten oder geschlossenen Aufträgen nicht verfügbar.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
