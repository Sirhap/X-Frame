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

- `duration_days`: days after first activation; defaults to `3`. Permanent licenses keep a valid
  fallback duration and store `expires_at` as year 9999, so no schema exception is required.
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

## Administrator activation-code console

The public landing page exposes an **Activation code management** link in its top-right corner. It
opens the dedicated `/admin/licenses` page instead of a floating dialog. The workbench routes do not
include this control. Administrator access uses a configurable username,
a six-digit TOTP from Google Authenticator, and a 15-minute HttpOnly session. Google Authenticator uses a fixed 30-second
period, and the Worker accepts only the current window. An expired or successfully used counter cannot
be replayed.

Set the Base32 TOTP seed only as a Worker secret. Add the same setup key to Google Authenticator:

```bash
wrangler secret put XSXB_ADMIN_TOTP_SECRET
```

Set the non-secret administrator username as a Worker variable. It defaults to `admin` when omitted
and accepts 1-64 ASCII letters, digits, dots, underscores, or hyphens:

```toml
[vars]
XSXB_ADMIN_USERNAME = "sirhao"
```

For local Wrangler development, copy `.dev.vars.example` to `.dev.vars`. Both files containing real
secrets are ignored by Git. The administrator console fails closed unless all four requirements are
present: `LICENSE_DB`, a persistent `XSXB_ACTIVATION_SECRET` of at least 32 characters, and a valid
Base32 `XSXB_ADMIN_TOTP_SECRET` containing at least 80 bits, plus a valid configured or default
administrator username.

Migration `0002_admin_activation_codes.sql` adds bounded login-attempt state and one-time TOTP replay
records. Migration `0003_encrypt_activation_codes.sql` adds authenticated ciphertext storage so a
verified administrator can view and copy codes. Review the target account and back up the database
before applying migrations remotely:

```bash
wrangler d1 migrations apply xsxb-frame-tuner-licenses --remote
```

The console creates standard codes with a finite or permanent activation duration and an unused-code
redemption deadline that defaults to year 9999 (displayed as permanent). D1 stores the normalized SHA-256 hash
for redemption lookup and an AES-GCM authenticated ciphertext for administrator display. The
encryption key is domain-separated from the persistent `XSXB_ACTIVATION_SECRET`; rotating that secret
makes previously encrypted display values unreadable. Codes created before migration `0003` continue
to work but cannot have their plaintext recovered. Five failed login attempts within ten minutes
block that client for fifteen minutes.

## Validate and deploy

```bash
npm run check:cloudflare
wrangler deploy
```

The validation command builds the protected workbench, audits generated artifacts, runs Worker and
browser-identity tests, validates generated Worker types, and performs a deployment dry run. It does
not publish the Worker, create a remote database, apply remote migrations, or change secrets.
