CREATE TABLE IF NOT EXISTS site_notification_email_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  event_kind TEXT NOT NULL,
  condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  recipient_user_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  cooldown_seconds INT NOT NULL DEFAULT 3600,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_notification_email_rules_event_kind_nonempty
    CHECK (char_length(trim(event_kind)) > 0),
  CONSTRAINT site_notification_email_rules_cooldown_nonneg
    CHECK (cooldown_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_site_notification_email_rules_site_enabled
  ON site_notification_email_rules (site_id)
  WHERE enabled;

CREATE TABLE IF NOT EXISTS site_notification_email_rule_fires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES site_notification_email_rules(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_notification_email_rule_fires_rule_wo_fired
  ON site_notification_email_rule_fires (rule_id, work_order_id, fired_at DESC);
