# Cloudflare site deployment

The production workbench uses D1-backed automatic trials and configurable multi-device licenses. A
browser creates a non-extractable ECDSA P-256 private key in IndexedDB, while D1 stores only the
public key, normalized activation-code hash, expiry configuration, and secret-keyed risk hashes.

## Create the D1 database

Create the database once, copy the returned `database_id` into the `LICENSE_DB` entry in
`wrangler.jsonc`, then apply migrations:

```bash
wrangler d1 create xsxb-frame-tuner-licenses
wrangler d1 migrations apply xsxb-frame-tuner-licenses --remote
```

The first migration creates `licenses` and `license_devices`. Migration `0004` upgrades existing
single-device records without changing their limit, then adds automatic-trial claims. Do not run
remote migrations without reviewing the target Cloudflare account and taking an appropriate backup.

## Automatic three-day trial

The workbench starts a three-day trial when a browser first opens the hosted application. No code is
required. Authorization uses the browser's non-extractable P-256 key. A bounded combination of browser,
hardware, locale, display, WebGL, and User-Agent Client Hints is sent only to the Worker, normalized,
and immediately HMAC-hashed with `XSXB_ACTIVATION_SECRET`; raw fingerprint values and raw IP addresses
are not persisted.

The private key is the authorization credential. The fingerprint is only a duplicate-trial risk
signal after browser storage is cleared. Browser fingerprints can change or be spoofed, so they cannot
prove a person's identity and must not replace signature verification.

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

- `duration_days`: any positive whole-number duration that produces an expiry before year 9999;
  defaults to `3`. Permanent licenses keep a valid
  fallback duration and store `expires_at` as year 9999, so no schema exception is required.
- `redeem_by`: optional last time an unused code may be redeemed, as an ISO-8601 timestamp.
- `expires_at`: optional fixed license expiry; when absent it is calculated from `duration_days`.
- `revoked_at`: setting an ISO-8601 timestamp immediately revokes the license.
- `max_devices`: a positive whole-number active-device limit, or `NULL` for unlimited devices.
  Existing codes retain their configured limit after migration. All devices share the license's
  first-activation and expiry timestamps.

Activation codes are case-insensitive after trimming leading and trailing whitespace. Administrators
may use Unicode text, internal spaces, and symbols in any format. A 512-character transport limit
protects bounded Worker requests but does not impose a prefix or pattern.

The same browser key reuses its existing slot. A new key occupies a slot atomically only while the
active-device count is below `max_devices`. Revoked devices stop consuming active capacity; the
administrator can restore them or delete the binding to reset the slot.

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
verified administrator can view and copy codes. Migration `0004_multi_device_trials.sql` adds
automatic trials, configurable device limits, and per-device administration. Review the target
account and back up the database before applying migrations remotely:

```bash
wrangler d1 migrations apply xsxb-frame-tuner-licenses --remote
```

The console creates standard codes with a custom finite or permanent activation duration, a finite or
unlimited device policy, and an unused-code redemption deadline that defaults to year 9999 (displayed
as permanent). The workbench license manager lets users enter or replace a code and inspect the active
expiry. The administrator console groups device IDs, names, locations, first-binding and last-seen
times under the exact code they use, with per-device revocation, restoration, and slot reset. D1 stores the
normalized SHA-256 hash for redemption lookup and an AES-GCM authenticated ciphertext for
administrator display. The
encryption key is domain-separated from the persistent `XSXB_ACTIVATION_SECRET`; rotating that secret
makes previously encrypted display values unreadable. Codes created before migration `0003` continue
to work but cannot have their plaintext recovered. Five failed login attempts within ten minutes
block that client for fifteen minutes.

## Validate and deploy

```bash
npm run check:cloudflare
wrangler deploy
```

Migration `0005_flexible_licenses.sql` removes the old 3650-day and 100-device schema ceilings and
uses `NULL` as the explicit unlimited-device value. Back up D1 before applying it remotely.

The validation command builds the protected workbench, audits generated artifacts, runs Worker and
browser-identity tests, validates generated Worker types, and performs a deployment dry run. It does
not publish the Worker, create a remote database, apply remote migrations, or change secrets.
