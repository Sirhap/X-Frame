CREATE UNIQUE INDEX idx_automatic_trial_device_signature
  ON automatic_trial_claims(hardware_hash, display_hash);
