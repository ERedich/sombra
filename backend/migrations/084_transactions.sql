-- Internal time / feedback ledger (type INT = internal time registration).
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type = 'INT'),
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  hours NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  feedback_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_feedback_len CHECK (char_length(feedback_text) <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_transactions_work_order_id ON transactions (work_order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_employee_id ON transactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);
