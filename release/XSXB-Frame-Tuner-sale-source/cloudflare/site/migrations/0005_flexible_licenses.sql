PRAGMA defer_foreign_keys = ON;

CREATE TABLE licenses_v5 (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_ciphertext TEXT,
  source TEXT NOT NULL DEFAULT 'code' CHECK (source IN ('code', 'automatic_trial')),
  plan TEXT NOT NULL DEFAULT 'trial',
  duration_days INTEGER NOT NULL DEFAULT 3 CHECK (duration_days >= 1),
  max_devices INTEGER CHECK (max_devices IS NULL OR max_devices >= 1),
  redeem_by TEXT,
  first_activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

INSERT INTO licenses_v5
  (id, code_hash, code_ciphertext, source, plan, duration_days, max_devices,
   redeem_by, first_activated_at, expires_at, revoked_at)
SELECT id, code_hash, code_ciphertext, source, plan, duration_days, max_devices,
       redeem_by, first_activated_at, expires_at, revoked_at
  FROM licenses;

CREATE TABLE license_devices_v5 (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  public_key_hash TEXT NOT NULL,
  fingerprint_hash TEXT,
  device_name TEXT,
  first_ip_hash TEXT,
  last_ip_hash TEXT,
  first_country TEXT,
  last_country TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (license_id, public_key_hash),
  FOREIGN KEY (license_id) REFERENCES licenses_v5(id) ON DELETE CASCADE
);

INSERT INTO license_devices_v5
  (id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
   first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at, revoked_at)
SELECT id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
       first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at, revoked_at
  FROM license_devices;

CREATE TABLE automatic_trial_claims_v5 (
  id TEXT PRIMARY KEY,
  fingerprint_hash TEXT NOT NULL UNIQUE,
  public_key_hash TEXT NOT NULL UNIQUE,
  hardware_hash TEXT NOT NULL,
  display_hash TEXT NOT NULL,
  license_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL UNIQUE,
  first_ip_hash TEXT,
  last_ip_hash TEXT,
  first_country TEXT,
  last_country TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (license_id) REFERENCES licenses_v5(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES license_devices_v5(id) ON DELETE CASCADE
);

INSERT INTO automatic_trial_claims_v5
  (id, fingerprint_hash, public_key_hash, hardware_hash, display_hash, license_id, device_id,
   first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
SELECT id, fingerprint_hash, public_key_hash, hardware_hash, display_hash, license_id, device_id,
       first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at
  FROM automatic_trial_claims;

DROP TABLE automatic_trial_claims;
DROP TABLE license_devices;
DROP TABLE licenses;
ALTER TABLE licenses_v5 RENAME TO licenses;
ALTER TABLE license_devices_v5 RENAME TO license_devices;
ALTER TABLE automatic_trial_claims_v5 RENAME TO automatic_trial_claims;

CREATE INDEX idx_licenses_status ON licenses(source, revoked_at, redeem_by, expires_at);
CREATE INDEX idx_license_devices_status
  ON license_devices(license_id, revoked_at, last_seen_at);
CREATE INDEX idx_license_devices_public_key
  ON license_devices(public_key_hash, revoked_at);
CREATE INDEX idx_automatic_trial_hardware
  ON automatic_trial_claims(hardware_hash, last_seen_at);
CREATE INDEX idx_automatic_trial_ip
  ON automatic_trial_claims(last_ip_hash, last_seen_at);
