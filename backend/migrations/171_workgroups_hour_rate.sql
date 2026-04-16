-- Hourly rate + currency (CURR) per workgroup.

ALTER TABLE workgroups
  ADD COLUMN IF NOT EXISTS hour_rate NUMERIC(14, 4) NULL,
  ADD COLUMN IF NOT EXISTS hour_rate_currency VARCHAR(3) NULL;

ALTER TABLE workgroups DROP CONSTRAINT IF EXISTS workgroups_hour_rate_currency_pair;

ALTER TABLE workgroups
  ADD CONSTRAINT workgroups_hour_rate_currency_pair CHECK (
    (hour_rate IS NULL AND hour_rate_currency IS NULL)
    OR (
      hour_rate IS NOT NULL
      AND hour_rate_currency IS NOT NULL
      AND hour_rate_currency ~ '^[A-Za-z]{3}$'
    )
  );

INSERT INTO ui_translations (locale, msg_key, value) VALUES
('en', 'workgroups.field_hour_rate', 'Hour rate'),
('en', 'workgroups.field_hour_rate_currency', 'Currency'),
('en', 'workgroups.col_hour_rate', 'Hour rate'),
('en', 'workgroups.err_hour_rate_currency', 'Select a currency from app parameters (CURR) when an hour rate is set.'),
('en', 'workgroups.err_hour_rate_currency_invalid', 'Currency must be one of the codes allowed in app parameters (CURR).'),
('en', 'workgroups.err_hour_rate_invalid', 'Hour rate must be a valid non-negative number.'),
('de', 'workgroups.field_hour_rate', 'Stundensatz'),
('de', 'workgroups.field_hour_rate_currency', 'Währung'),
('de', 'workgroups.col_hour_rate', 'Stundensatz'),
('de', 'workgroups.err_hour_rate_currency', 'Wählen Sie eine Währung aus den App-Parametern (CURR), wenn ein Stundensatz gesetzt ist.'),
('de', 'workgroups.err_hour_rate_currency_invalid', 'Die Währung muss einem in den App-Parametern (CURR) erlaubten Code entsprechen.'),
('de', 'workgroups.err_hour_rate_invalid', 'Der Stundensatz muss eine gültige nicht negative Zahl sein.')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
