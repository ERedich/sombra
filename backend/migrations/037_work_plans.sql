CREATE TABLE IF NOT EXISTS work_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  plan_key VARCHAR(200) NOT NULL,
  short_text VARCHAR(200) NOT NULL,
  asset_id UUID NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  costcenter_id UUID REFERENCES costcenters (id) ON DELETE SET NULL,
  instruction_text TEXT NOT NULL,
  worktime NUMERIC(12, 2) NOT NULL,
  interval_count INTEGER NOT NULL,
  interval_time_type TEXT NOT NULL CHECK (
    interval_time_type IN ('day', 'week', 'month', 'year')
  ),
  due_date TIMESTAMPTZ NOT NULL,
  next_due_at TIMESTAMPTZ NOT NULL,
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  duration_hours NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT work_plans_site_plan_key UNIQUE (site_id, plan_key),
  CONSTRAINT work_plans_interval_count_check CHECK (interval_count >= 1),
  CONSTRAINT work_plans_lead_time_check CHECK (lead_time_days >= 0),
  CONSTRAINT work_plans_duration_hours_check CHECK (duration_hours >= 0),
  CONSTRAINT work_plans_instruction_len CHECK (char_length(instruction_text) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_work_plans_site_id ON work_plans (site_id);
CREATE INDEX IF NOT EXISTS idx_work_plans_next_due ON work_plans (next_due_at);
