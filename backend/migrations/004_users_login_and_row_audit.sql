-- Users: replace key with login_name (idempotent for repeated migrate runs)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'key'
  ) THEN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_name TEXT;
    UPDATE users SET login_name = COALESCE(NULLIF(TRIM(login_name), ''), key);
    ALTER TABLE users ALTER COLUMN login_name SET NOT NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_login_name'
    ) THEN
      CREATE UNIQUE INDEX idx_users_login_name ON users (login_name);
    END IF;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_key_key;
    ALTER TABLE users DROP COLUMN key;
  END IF;
END $$;

-- Ensure unique index exists if login_name column was created outside the DO block (defensive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_name ON users (login_name);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users (id) ON DELETE SET NULL;
