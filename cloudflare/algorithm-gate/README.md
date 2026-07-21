# Cloudflare Algorithm Artifact Gate

This optional gate limits bulk downloads of versioned WASM. It does not encrypt the algorithm, upload user media, or change local algorithm correctness. The static deployment mode remains the default in `deployment-modes.example.json`.

## Architecture

1. The browser obtains a single-use Turnstile token for action `algorithm-artifact-session`.
2. `Authorization Worker` checks the exact Origin, native rate limit, active/revoked version, optional entitlement, Turnstile hostname/action, and then returns a signed session lasting 60–900 seconds.
3. `Artifact Worker` checks the exact Origin, artifact rate limit, signature, audience, expiry, version, and session/version revocation.
4. The Artifact Worker reads a fixed versioned key from a private R2 binding and returns `object.body` directly as `application/wasm`.

Neither Worker logs request bodies, credentials, R2 keys, filenames, image metadata, masks, pixels, or media hashes. Invocation logs and traces are disabled in the checked-in configurations so platform request capture cannot widen that policy accidentally; explicit application logs remain available but the implementation emits none. Error responses expose stable codes only. All authorization and artifact responses are `no-store`; the artifact response is also `private` and varies on `Origin, Authorization`.

## Runtime contract

`POST /v1/session` accepts at most 4 KiB of JSON:

```json
{
  "challengeToken": "single-use Turnstile response",
  "version": "release-identifier",
  "entitlementCredential": "optional opaque credential"
}
```

It returns `201` with `{ token, expiresAt, artifactUrl }`. The browser then calls `artifactUrl` with `Authorization: Bearer <token>`. Siteverify is never called from the browser and `TURNSTILE_SECRET` is never returned to it.

Entitlement records are optional. With `REQUIRE_ENTITLEMENT=true`, store them in `GATE_STATE` under `entitlement:<base64url-sha256(credential)>`:

```json
{ "active": true, "expiresAt": 1893456000, "versions": ["release-identifier"] }
```

Entitlement credentials must contain at least 32 characters of cryptographically random data.

Revocation keys contain the literal `1`:

- `revoked:version:<version>` revokes a release in both Workers.
- `revoked:session:<jti>` revokes one issued session in the Artifact Worker.
- `REVOKED_VERSIONS` provides an immediate configuration-level denylist.

KV revocation propagation follows KV consistency characteristics. For urgent global revocation, also update `REVOKED_VERSIONS` and deploy both Worker configurations. Short session TTL bounds exposure while KV changes propagate.

## Secret and resource setup (not executed by this implementation)

The checked-in configs contain resource placeholders and no secrets. Replace them only in a controlled environment. Create a private R2 bucket without `r2.dev` or a public custom domain, one shared KV namespace, and two native Rate Limiting namespaces.

Set secrets interactively for each Worker; never place them in `vars`, source, `.dev.vars`, shell history, or redirected files:

```text
npx wrangler secret put TURNSTILE_SECRET --config cloudflare/algorithm-gate/wrangler.authorization.jsonc
npx wrangler secret put SESSION_SIGNING_KEY --config cloudflare/algorithm-gate/wrangler.authorization.jsonc
npx wrangler secret put SESSION_SIGNING_KEY --config cloudflare/algorithm-gate/wrangler.artifact.jsonc
```

`SESSION_SIGNING_KEY` must be the same high-entropy value on both Workers and at least 32 characters. The Turnstile secret is bound only to the Authorization Worker. Configure the widget hostname allowlist to match `ALLOWED_ORIGINS`; its public site key belongs only in client/deployment configuration.

Before any deployment, generate binding types and validate a dry run with an explicitly installed Wrangler 4.x. No dependency or script was added to the root `package.json`:

```text
npx wrangler types --config cloudflare/algorithm-gate/wrangler.authorization.jsonc
npx wrangler types --config cloudflare/algorithm-gate/wrangler.artifact.jsonc
npx wrangler deploy --dry-run --config cloudflare/algorithm-gate/wrangler.authorization.jsonc
npx wrangler deploy --dry-run --config cloudflare/algorithm-gate/wrangler.artifact.jsonc
```

Suggested root script (add only after approving the Wrangler dependency):

```json
{
  "check:algorithm-gate": "node --test cloudflare/algorithm-gate/tests/*.test.mjs && prettier --check cloudflare/algorithm-gate"
}
```

## Static compatibility

Select `modes.static` to load the hashed WASM already described by `/asset-manifest.json`; no gate endpoint, challenge, secret, KV, or R2 binding is required. This preserves fully static hosting but gives up identity and download-count control. Select `modes.controlled` only when a private R2 artifact and both Workers are available. A gate outage must surface an explicit runtime loading error; it must never trigger a sensitive JavaScript fallback or produce a corrupted image.
