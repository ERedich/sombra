ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS rolled_out_from_wo_id UUID REFERENCES work_orders (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_work_orders_rolled_out_from
  ON work_orders (rolled_out_from_wo_id)
  WHERE rolled_out_from_wo_id IS NOT NULL;
