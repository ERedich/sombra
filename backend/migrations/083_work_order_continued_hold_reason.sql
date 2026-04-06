-- Add status `continued` (resume from on hold) and optional hold reason text.
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;

ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check CHECK (
  status IN (
    'open',
    'assigned',
    'started',
    'continued',
    'on_hold',
    'done',
    'closed'
  )
);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS hold_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_orders_hold_reason_len'
  ) THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_hold_reason_len CHECK (
      hold_reason IS NULL OR char_length(hold_reason) <= 2000
    );
  END IF;
END $$;
