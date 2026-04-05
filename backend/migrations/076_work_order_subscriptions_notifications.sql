CREATE TABLE IF NOT EXISTS work_order_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_order_subscriptions_work_order_user_unique UNIQUE (work_order_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_subscriptions_user
  ON work_order_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_work_order_subscriptions_work_order
  ON work_order_subscriptions (work_order_id);

CREATE TABLE IF NOT EXISTS work_order_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ NULL,
  CONSTRAINT work_order_notifications_kind_not_empty CHECK (char_length(trim(kind)) > 0),
  CONSTRAINT work_order_notifications_message_not_empty CHECK (char_length(trim(message)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_work_order_notifications_user_read_created
  ON work_order_notifications (user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_order_notifications_user_created
  ON work_order_notifications (user_id, created_at DESC);
