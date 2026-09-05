# NDLE archive proxy

This Worker serves indexed parquet archives to signed-in users. Clerk verifies
the account, then the ingest service checks the exact file key against its
archive manifest and current owner aliases. Claimed guest history uses that same
check. Raw recovery files cannot be requested through this Worker.

File clients request Clerk's `convex` token template. If a verified token does
not yet contain `convex_user_id`, the Worker forwards that same token to
`users:getViewerState` on the configured `CONVEX_URL`. This read-only fallback
uses Convex's authenticated identity while metadata delivery catches up.
Unverified tokens are never forwarded. An unavailable account lookup returns
503; caller-supplied account headers cannot authorize a file. Production and
development use their corresponding Convex deployments in `wrangler.jsonc`.

Temporary AI exports use `exports/account=<encoded account>/<UUID>.parquet`.
They require the same exact-key authorization, with an account-specific grant
that expires after one hour. Expired grants deny cached bytes too.

Every request, including an internal cache hit, needs a current archive grant.
If the grant service is unavailable, the Worker returns 503; it never falls back
to guessing ownership from a path. Denied grants return 403.

## Caching and byte ranges

Browser responses use `Cache-Control: private, no-store`. The Worker separately
caches immutable byte representations under keys containing the account,
normalized byte range, and cache version. Cache writes use status 200 because
Cloudflare rejects stored 206 responses; the client receives the original 206,
Content-Range, and exact Content-Length. Representations larger than 50 MB are
streamed without caching. Requested ranges are limited to 50 MB, suffixes to
10 MB. Full file GETs are streamed. HEAD reads metadata only.

The archive manifest must reference immutable file keys. New archive contents
must get a new key. Unpublishing a manifest entry revokes even cached access.
Previously issued public browser-cache responses need a new client URL version
to force a request with the new private policy; old downloaded copies cannot be
revoked by changing server headers.

## Required settings and deployment order

No provisioning or deployment is performed by the checks below.

1. Deploy ingest's authenticated `GET /internal/archive-access` endpoint and its
   authoritative archive manifest. Import the legacy archive index and verify
   owner aliases before switching this Worker. The endpoint accepts `user_id`
   (the internal Convex account ID) and `key` (the exact R2 key). It returns 200
   with `{ "allowed": true }` or `{ "allowed": false }` and requires the dedicated
   `FILE_ACCESS_SECRET`. It must deny unindexed keys and raw recovery data.
2. Set `FILE_ACCESS_SECRET` in ingest and in each Worker environment, alongside
   the existing Clerk secrets. Provision the separate development bucket if it
   does not already exist:

   ```sh
   npx wrangler r2 bucket create ndle-analytics-dev
   npx wrangler secret put FILE_ACCESS_SECRET --env dev
   npx wrangler secret put FILE_ACCESS_SECRET --env prod
   ```

3. Set the verified development `FILE_ACCESS_ENDPOINT` in `wrangler.jsonc`.
   It is deliberately empty: development must not request production grants or
   read the production bucket. Use the matching staging Clerk issuer and ingest
   owner map. Production uses the existing `ndle-analytics` bucket and
   `https://api.ndle.app/internal/archive-access`.
4. Run checks, deploy development, verify a claimed guest archive and denied
   cross-account access, then deploy production through the approved release
   process. Watch grant failures, cache-write errors, and file-read latency.

Local values belong in `.dev.vars`; use development credentials. Reuse any
existing development server for this repository.

## Checks

```sh
npm ci
npm test
npm run typecheck
npx wrangler types --check
npm run deploy:dry-run
npx wrangler deploy --env dev --dry-run
```

Tests use local workerd R2 and Cache API storage. They verify separate cached
ranges, source deletion after caching, grant revocation before cached reads,
claimed guest access, private GET/HEAD responses, and range errors.
