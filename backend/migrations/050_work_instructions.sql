CREATE TABLE IF NOT EXISTS work_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders (id) ON DELETE CASCADE,
  work_plan_id UUID REFERENCES work_plans (id) ON DELETE CASCADE,
  sort_nr INTEGER NOT NULL,
  instruction_text VARCHAR(200) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT work_instructions_parent_xor CHECK (
    (work_order_id IS NOT NULL AND work_plan_id IS NULL)
    OR (work_order_id IS NULL AND work_plan_id IS NOT NULL)
  ),
  CONSTRAINT work_instructions_text_len CHECK (char_length(instruction_text) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_work_instructions_work_order_id
  ON work_instructions (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_instructions_work_plan_id
  ON work_instructions (work_plan_id);
