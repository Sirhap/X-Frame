PRAGMA defer_foreign_keys = ON;

DROP TABLE automatic_trial_browser_bindings;
DROP TABLE automatic_trial_claims;
DROP TABLE license_devices;

CREATE TABLE licenses_email_only (
  id TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE,
  code_ciphertext TEXT,
  source TEXT NOT NULL CHECK (source IN ('code', 'email_trial')),
  plan TEXT NOT NULL DEFAULT 'trial',
  duration_days INTEGER NOT NULL DEFAULT 3 CHECK (duration_days >= 1),
  max_devices INTEGER,
  redeem_by TEXT,
  first_activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
);

INSERT INTO licenses_email_only
  (id, code_hash, code_ciphertext, source, plan, duration_days, max_devices, redeem_by,
   first_activated_at, expires_at, revoked_at, account_id)
SELECT id, code_hash, code_ciphertext, 'code', plan, duration_days, max_devices, redeem_by,
       first_activated_at, expires_at, revoked_at, account_id
  FROM licenses
 WHERE source = 'code';

DROP TABLE licenses;
ALTER TABLE licenses_email_only RENAME TO licenses;

CREATE INDEX idx_licenses_status ON licenses(source, revoked_at, redeem_by, expires_at);
CREATE INDEX idx_licenses_account ON licenses(account_id, revoked_at, expires_at);
CREATE UNIQUE INDEX idx_email_trial_per_account
  ON licenses(account_id) WHERE source = 'email_trial';
