ALTER TABLE accounts ADD COLUMN password_hash TEXT;
ALTER TABLE accounts ADD COLUMN password_salt TEXT;
ALTER TABLE accounts ADD COLUMN password_iterations INTEGER;
ALTER TABLE accounts ADD COLUMN password_set_at TEXT;

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('email_registration', 'email_password_setup', 'email_login')),
  email TEXT NOT NULL,
  account_id TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  code_hash TEXT NOT NULL,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_auth_challenges_email_created
  ON auth_challenges(email, created_at DESC);
CREATE INDEX idx_auth_challenges_ip_created
  ON auth_challenges(ip_hash, created_at DESC);
