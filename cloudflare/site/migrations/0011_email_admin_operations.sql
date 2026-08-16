PRAGMA defer_foreign_keys = ON;

ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'deleted'));
ALTER TABLE accounts ADD COLUMN suspended_at TEXT;
ALTER TABLE accounts ADD COLUMN suspension_reason TEXT;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

CREATE TABLE licenses_admin_operations (
  id TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE,
  code_ciphertext TEXT,
  source TEXT NOT NULL CHECK (source IN ('code', 'email_trial', 'admin_grant')),
  plan TEXT NOT NULL DEFAULT 'trial',
  duration_days INTEGER NOT NULL DEFAULT 3 CHECK (duration_days >= 1),
  max_devices INTEGER,
  redeem_by TEXT,
  first_activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  admin_note TEXT,
  granted_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
);

INSERT INTO licenses_admin_operations
  (id, code_hash, code_ciphertext, source, plan, duration_days, max_devices, redeem_by,
   first_activated_at, expires_at, revoked_at, account_id)
SELECT id, code_hash, code_ciphertext, source, plan, duration_days, max_devices, redeem_by,
       first_activated_at, expires_at, revoked_at, account_id
  FROM licenses;

DROP TABLE licenses;
ALTER TABLE licenses_admin_operations RENAME TO licenses;

CREATE INDEX idx_licenses_status ON licenses(source, revoked_at, redeem_by, expires_at);
CREATE INDEX idx_licenses_account ON licenses(account_id, revoked_at, expires_at);
CREATE INDEX idx_licenses_account_source_expiry ON licenses(account_id, source, revoked_at, expires_at);
CREATE UNIQUE INDEX idx_email_trial_per_account ON licenses(account_id) WHERE source = 'email_trial';
CREATE INDEX idx_accounts_status_login ON accounts(status, last_login_at DESC);
CREATE INDEX idx_audit_log_created_at ON authorization_audit_log(created_at DESC);
