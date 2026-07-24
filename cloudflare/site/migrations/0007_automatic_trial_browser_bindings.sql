PRAGMA foreign_keys = ON;

CREATE TABLE automatic_trial_browser_bindings (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  public_key_hash TEXT NOT NULL UNIQUE,
  device_name TEXT,
  first_ip_hash TEXT,
  last_ip_hash TEXT,
  first_country TEXT,
  last_country TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (claim_id) REFERENCES automatic_trial_claims(id) ON DELETE CASCADE
);

CREATE INDEX idx_automatic_trial_browser_bindings_claim
  ON automatic_trial_browser_bindings(claim_id, revoked_at, last_seen_at);
