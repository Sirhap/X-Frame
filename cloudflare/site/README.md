# Cloudflare site deployment

The hosted workbench uses D1-backed email accounts, seven-day browser sessions, and account-bound
Pro entitlements. Any valid email may register with a six-digit verification code delivered by
Resend. Activation codes remain available and bind to the verified email on first redemption.

## Database migration

Create the D1 database once, configure its ID in `wrangler.jsonc`, and apply migrations only after
reviewing the target account and taking a backup:

```bash
wrangler d1 create xsxb-frame-tuner-licenses
wrangler d1 migrations apply xsxb-frame-tuner-licenses --remote
```

Migration `0008_email_accounts.sql` adds accounts, hashed verification codes, hashed session tokens,
authorization settings, audit records, and the activation-code-to-account binding. Older device and
trial tables remain during the compatibility window but are not used by the current workbench.

## Email authentication

Configure the persistent account hashing secret and Resend credentials:

```bash
wrangler secret put XSXB_ACTIVATION_SECRET
wrangler secret put RESEND_API_KEY
```

`XSXB_ACTIVATION_SECRET` must contain at least 32 characters. Configure the verified Resend sender as
a non-secret Worker variable:

```jsonc
{
  "vars": {
    "XSXB_EMAIL_FROM": "X-Frame <login@example.com>",
  },
}
```

Verification codes contain six digits, expire after ten minutes, allow five attempts, and cannot be
resent to the same email within 60 seconds. The Worker limits sends per email and hashed client IP.
Only code hashes and IP HMACs are stored. Successful verification creates an HttpOnly, Secure,
SameSite=Strict session lasting seven days. A new browser, logout, cleared cookies, revoked session,
or expired session requires another email code.

Email normalization trims surrounding whitespace and lowercases the address. Provider-specific
aliases such as Gmail dots and `+tag` suffixes are intentionally preserved.

## Pro entitlements and activation codes

Effective Pro access is evaluated on every protected request in this order:

1. A disabled or revoked account is denied.
2. An unexpired administrator `enabled` override is accepted.
3. Any active account-bound activation code is accepted.
4. An `inherit` account uses the global `default_pro_enabled` setting.

The migration initializes the global default to `true`, preserving the current all-features-open
product policy. Administrators may change the global default or override an individual account.
An authenticated administrator also receives a separate four-hour workbench cookie and always has
Pro access. Administrator and email-account cookies remain independent, so signing out of one does
not revoke the other.

Activation codes remain case-insensitive after trimming and uppercasing. Existing permanent/finite
duration, redemption deadline, revocation, restoration, encrypted display, and plaintext hashing
rules remain unchanged. First redemption atomically binds an unused code to the authenticated
account and starts its validity period. A code bound to another account cannot be redeemed. Multiple
codes may bind to one account; any active code grants Pro. Device count columns are retained only for
schema compatibility and are not checked by email-account authorization.

## Administrator console

The `/admin/licenses` console requires the configured username, an administrator password, and
Google Authenticator TOTP. Set the password and Base32 seed only as Worker secrets:

```bash
wrangler secret put XSXB_ADMIN_TOTP_SECRET
wrangler secret put PASSWORD
```

The Worker serves the login surface at `/admin/login` and checks the signed administrator
workbench cookie before serving `/admin/licenses`. Unauthenticated requests are redirected to the
login route, direct `/admin.html` requests are rejected, and every `/api/admin/*` operation retains
its own server-side session authorization.

`XSXB_ADMIN_USERNAME` defaults to `admin`. `XSXB_ADMIN_SESSION_MINUTES` accepts 15 through 1440 and
defaults to 240. The console can search email accounts, set account Pro overrides, force all account
sessions to log out, change the global default, inspect activation-code email bindings, and manage
activation-code duration/revocation. Authorization mutations are written to
`authorization_audit_log`.

For local Wrangler development, copy `.dev.vars.example` to `.dev.vars`. Files containing real
secrets are ignored by Git.

## Validate and deploy

```bash
# Validate without uploading or applying remote migrations.
npm run deploy:cloudflare:dry-run

# Deploy only from a reviewed, committed worktree.
npm run deploy:cloudflare
```

The deployment script builds protected assets, audits output, checks Worker types, and refuses a
dirty tree by default. It does not automatically apply D1 migrations or create Resend configuration.
