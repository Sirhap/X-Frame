PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pro_override TEXT NOT NULL DEFAULT 'inherit'
    CHECK (pro_override IN ('inherit', 'enabled', 'disabled')),
  pro_expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE email_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose = 'login'),
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT
);

CREATE TABLE account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE authorization_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO authorization_settings (key, value, updated_at)
VALUES ('default_pro_enabled', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE authorization_audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('account', 'admin', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE licenses ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_email_verification_codes_lookup
  ON email_verification_codes(email, created_at DESC);
CREATE INDEX idx_email_verification_codes_ip
  ON email_verification_codes(ip_hash, created_at DESC);
CREATE INDEX idx_account_sessions_account
  ON account_sessions(account_id, revoked_at, expires_at);
CREATE INDEX idx_licenses_account
  ON licenses(account_id, revoked_at, expires_at);
CREATE INDEX idx_authorization_audit_target
  ON authorization_audit_log(target_type, target_id, created_at DESC);
