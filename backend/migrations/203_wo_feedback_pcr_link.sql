-- Verknüpfung einer Rückmeldung (transactions-Zeile) mit dem PCR-Tripel.
-- Werte werden nur gesetzt, wenn der Auftrag vom Typ BD (Breakdown) ist und der
-- Mitarbeiter die kaskadierenden Dropdowns ausgefüllt hat. Optional, darum nullable.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pcr_problem_id UUID
    REFERENCES pcr_problems (id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pcr_cause_id UUID
    REFERENCES pcr_causes (id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pcr_remedy_id UUID
    REFERENCES pcr_remedies (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_pcr_problem_id ON transactions (pcr_problem_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pcr_cause_id   ON transactions (pcr_cause_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pcr_remedy_id  ON transactions (pcr_remedy_id);
