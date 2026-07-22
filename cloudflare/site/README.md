# Cloudflare site deployment

The production workbench uses a D1-backed single-browser license. A browser creates a
non-extractable ECDSA P-256 private key in IndexedDB, while D1 stores only the public key, normalized
activation-code hash, expiry configuration, and hashed IP risk signals.

## Create the D1 database

Create the database once, copy the returned `database_id` into the `LICENSE_DB` entry in
`wrangler.jsonc`, then apply migrations:

```bash
wrangler d1 create xsxb-frame-tuner-licenses
wrangler d1 migrations apply xsxb-frame-tuner-licenses --remote
```

The first migration creates `licenses` and `license_devices`. Do not run remote migrations without
reviewing the target Cloudflare account and taking an appropriate backup.

## Configure trial licenses

Activation codes are trimmed, uppercased, and SHA-256 hashed before lookup. Store only the hash in
D1. On macOS, generate it with:

```bash
printf %s 'XSXB-TRIAL-example' | tr '[:lower:]' '[:upper:]' | shasum -a 256
```

Insert the generated hash and an opaque license ID. The default trial begins on first activation and
lasts 3 days:

```sql
INSERT INTO licenses (id, code_hash)
VALUES ('license-opaque-id', '64-character-sha256-hash');
```

Each code can be configured independently:

- `duration_days`: days after first activation; defaults to `3`.
- `redeem_by`: optional last time an unused code may be redeemed, as an ISO-8601 timestamp.
- `expires_at`: optional fixed license expiry; when absent it is calculated from `duration_days`.
- `revoked_at`: setting an ISO-8601 timestamp immediately revokes the license.

`license_devices.license_id` is unique, so the first version permits one browser device per code.
Clearing browser storage removes its private key; device reset is intentionally deferred to a later
admin flow.

## Required Worker secret

```bash
wrangler secret put XSXB_ACTIVATION_SECRET
```

Use a persistent random value of at least 32 characters. It signs challenges, 24-hour HttpOnly
cookies, and IP hashes. Rotating it invalidates existing cookies and challenges, but the stored device
keys remain usable after the browser performs a new challenge.

## Validate and deploy

```bash
npm run check:cloudflare
wrangler deploy
```

The validation command builds the protected workbench, audits generated artifacts, runs Worker and
browser-identity tests, validates generated Worker types, and performs a deployment dry run. It does
not publish the Worker, create a remote database, apply remote migrations, or change secrets.
