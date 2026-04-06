ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_employee_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_employee_id_fkey
      FOREIGN KEY (employee_id)
      REFERENCES employees(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_employee_id_not_null
  ON users (employee_id)
  WHERE employee_id IS NOT NULL;
