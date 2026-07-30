PRAGMA foreign_keys = ON;

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial',
  duration_days INTEGER NOT NULL DEFAULT 3 CHECK (duration_days BETWEEN 1 AND 3650),
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices = 1),
  redeem_by TEXT,
  first_activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE license_devices (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
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
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE INDEX idx_licenses_status ON licenses(revoked_at, redeem_by, expires_at);
CREATE INDEX idx_license_devices_status ON license_devices(license_id, revoked_at, last_seen_at);
