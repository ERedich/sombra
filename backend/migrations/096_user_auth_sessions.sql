CREATE TABLE IF NOT EXISTS user_auth_sessions (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  jti TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (jti)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_sessions_user_expires
  ON user_auth_sessions (user_id, expires_at);
