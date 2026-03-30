CREATE SEQUENCE IF NOT EXISTS work_order_wo_key_seq
  AS INTEGER
  START WITH 1000000
  INCREMENT BY 1
  MINVALUE 1000000
  MAXVALUE 9999999
  NO CYCLE;

CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  wo_key INTEGER NOT NULL,
  short_text VARCHAR(200) NOT NULL,
  asset_id UUID NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  costcenter_id UUID REFERENCES costcenters (id) ON DELETE SET NULL,
  instruction_text TEXT NOT NULL,
  plan_start TIMESTAMPTZ,
  plan_end TIMESTAMPTZ,
  worktime NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN (
      'open',
      'assigned',
      'started',
      'on_hold',
      'done',
      'closed'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT work_orders_wo_key_unique UNIQUE (wo_key),
  CONSTRAINT work_orders_wo_key_range CHECK (wo_key >= 1000000 AND wo_key <= 9999999),
  CONSTRAINT work_orders_instruction_len CHECK (char_length(instruction_text) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_work_orders_site_id ON work_orders (site_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_id ON work_orders (asset_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_costcenter_id ON work_orders (costcenter_id);
