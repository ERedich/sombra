-- Read-only Audit-Felder für "Erledigt": wann und durch welchen Mitarbeiter.
-- Die Felder werden vom Feedback-Handler gesetzt, sobald der MA die Erledigt-Checkbox
-- aktiviert und den Auftrag auf Status "done" überführt.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS done_by_employee_id UUID
    REFERENCES employees (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_done_by_employee_id
  ON work_orders (done_by_employee_id);

-- Best-effort Backfill: für bereits abgeschlossene WOs done_at mit updated_at befüllen,
-- done_by_employee_id bleibt NULL (Historie unbekannt).
UPDATE work_orders
SET done_at = updated_at
WHERE status = 'done' AND done_at IS NULL;
