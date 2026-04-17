ALTER TABLE site_notification_email_rules
  ADD COLUMN IF NOT EXISTS email_subject TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_body TEXT NULL;

INSERT INTO ui_translations (locale, msg_key, value) VALUES
  ('en', 'ner.mail_subject', 'Email subject'),
  ('de', 'ner.mail_subject', 'E-Mail-Betreff'),
  ('en', 'ner.mail_body', 'Email body'),
  ('de', 'ner.mail_body', 'E-Mail-Text'),
  ('en', 'ner.mail_placeholders',
   'Optional. Placeholders: {wo_key}, {message}, {work_order_id}, {kind}, {rule_name}, {payload_json}. Leave empty for default subject and body.'),
  ('de', 'ner.mail_placeholders',
   'Optional. Platzhalter: {wo_key}, {message}, {work_order_id}, {kind}, {rule_name}, {payload_json}. Leer lassen für Standard-Betreff und -Text.')
ON CONFLICT (locale, msg_key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
