CREATE TABLE admin_login_attempts (
  fingerprint_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_totp_uses (
  counter INTEGER PRIMARY KEY,
  used_at TEXT NOT NULL
);

CREATE INDEX idx_admin_login_attempts_blocked ON admin_login_attempts(blocked_until, updated_at);
