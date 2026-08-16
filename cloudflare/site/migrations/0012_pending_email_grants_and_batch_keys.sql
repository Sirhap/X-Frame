-- Apply during the scheduled D1 maintenance window after taking a backup.
-- Pending grants are intentionally separate from licenses: a license always belongs
-- to a verified account, while a pending grant has only a normalized email target.
CREATE TABLE pending_email_grants (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days >= 1),
  expires_at TEXT NOT NULL,
  admin_note TEXT,
  granted_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pending_email_grants_email ON pending_email_grants(email, created_at DESC);

CREATE TABLE admin_batch_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_admin_batch_idempotency_expiry ON admin_batch_idempotency(expires_at);
