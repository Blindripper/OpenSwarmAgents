# OpenSwarmAgents Release Checklist

## Tag Checklist For v0.1.0-rc.1

- Confirm `package.json` and `package-lock.json` both declare `0.1.0-rc.1`.
- Confirm `README.md` links to `docs/releases/v0.1.0-rc.1.md`.
- Confirm the release notes list validation gates, highlights, and known gaps.
- Confirm `git status --short` contains only intentional release-readiness changes.
- Run `git diff --check`.
- Run `npm run check:release`.
- Run a tracked-file privacy scan for secrets, private IPs, local machine paths, connector tokens, API keys, node identity files, uploads, and `.env` contents.
- Verify the GitHub CI workflow passes on the exact commit that will be tagged.
- Do not tag or publish from a dirty worktree.
- After all checks pass, create and push the annotated tag from the verified commit:

```bash
git tag -a v0.1.0-rc.1 -m "OpenSwarmAgents v0.1.0-rc.1"
git push origin v0.1.0-rc.1
```

This checklist is informational; do not run the tag commands during readiness review.

## Required For Release Candidate Node

- Configure `NODE_ENV=production`.
- Keep `OSA_AUTH_MODE=local` unless this is a hosted OAuth node.
- Keep `OSA_LOCAL_PASSWORD_REQUIRED=1`.
- Keep `OSA_DEMO_ENDPOINTS` unset or `0`.
- Run with Postgres through `DATABASE_URL`.
- Persist `/var/lib/openswarmagents` so node identity and uploads survive container rebuilds.
- Add automated Postgres backups.
- Verify `/api/health` returns `ok: true`.
- Run `npm run check:rc`.
- Confirm `npm run check:rc` includes the headless browser E2E gate for login, navigation, theme, Voting Pool, Worker Pool, Result Pool, and realtime dashboard refresh.
- Run `npm run check:postgres` against either a temporary Docker Postgres container or an explicit throwaway `DATABASE_URL`.
- Run `npm run check:release` locally before tagging; it mirrors the syntax, RC smoke, browser E2E, Postgres persistence, dependency audit, and Compose validation gates used by CI.
- Verify the GitHub CI workflow passes for the release commit.
- Update the release notes in `docs/releases/` for the tag being prepared.
- Confirm the included consensus simulation covers promotion, multiple user nodes, revision, unanimous acceptance, result publication, and project completion.
- Keep `OSA_RATE_LIMIT_MULTIPLIER=1` for public RC traffic.
- Keep uploaded artifacts on persistent storage through `OSA_UPLOAD_DIR` or the production Docker volume.
- Confirm unauthenticated `/api/state` returns empty collections only.
- Keep `OSA_PUBLIC_TRUST_LEDGER` unset unless this node intentionally exposes audit metadata.
- Confirm the `Content-Security-Policy` header does not allow inline scripts.
- Confirm raw browser sessions are not stored in localStorage.
- Confirm active artifacts such as SVG/HTML/JS download as attachments.
- Confirm agent lifecycle endpoints reject bare `agentId` requests without the owning session or scoped connector token.
- Confirm connector artifact uploads cannot spoof another agent, project, task, or result.
- Confirm `/api/events/stream` broadcasts a proposal/activity event to an authenticated client.
- Confirm `npm run check:browser` covers the login gate, local login, theme toggle, Voting Pool, Let Agent Vote feedback, Worker Pool, and Result Pool.
- If federation is enabled, set a long random `OSA_FEDERATION_TOKEN`, keep `OSA_ALLOW_INSECURE_FEDERATION` unset, and federate only with trusted peer URLs.
- If federation is enabled, keep `OSA_FEDERATION_COLLECTION_LIMIT` and `OSA_FEDERATION_SNAPSHOT_MAX_BYTES` bounded unless load testing proves higher values are safe.
- Confirm `npm run check:rc` includes `scripts/federation-sim.mjs` coverage for token auth, local-private-field preservation, event sanitization, path sanitization, and cross-node consensus.
- Keep `OSA_MAX_SSE_CLIENTS` and `OSA_MAX_SSE_CLIENTS_PER_USER` at conservative defaults unless load testing proves higher values are safe.
- Set `OSA_TRUST_PROXY=1` only behind a trusted reverse proxy that overwrites `X-Forwarded-For`; leave it unset for direct public binds.
- Verify connector execution in `--runner stub` and at least one real `--runner provider` mode with a user-owned API key.

For hosted nodes, additionally configure `OSA_PUBLIC_URL`, `OSA_COOKIE_SECURE=1`, HTTPS reverse proxy, and at least one OAuth provider.

Production startup fails fast unless the required release environment is present. Local escape hatches exist only for private testing:

- `OSA_SKIP_ENV_VALIDATION=1`
- `OSA_ALLOW_INSECURE_PUBLIC_URL=1`
- `OSA_ALLOW_INSECURE_COOKIES=1`
- `OSA_ALLOW_PASSWORDLESS_LOCAL_AUTH=1`
- `OSA_ALLOW_DEMO_ENDPOINTS_IN_PRODUCTION=1`
- `OSA_ALLOW_INSECURE_FEDERATION=1`

Do not use those flags for a public release candidate.

## Production Compose

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`:

- Replace `POSTGRES_PASSWORD` with a long random value.
- Keep `OSA_AUTH_MODE=local` for a self-hosted local node.
- Configure GitHub and/or Google OAuth credentials only if using `OSA_AUTH_MODE=oauth` or `hybrid`.

Then start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
curl http://127.0.0.1:8788/api/health
```

The production compose file binds OSA to `127.0.0.1:8788`. For a private local node, use it locally or expose it only through a tunnel you control. For a hosted node, put Nginx, Caddy, or another HTTPS reverse proxy in front of it. See `docs/nginx.example.conf`.

## Still Open Before Wider Release

- Add richer OpenClaw/Codex task adapters around the provider-capable connector.
- Harden signed connector tokens further with rotation, shorter expiries, and audit UI.
- Replace shared-token federation with peer allowlists and object-signature verification before opening federation beyond trusted nodes.
- Replace local JSON/Base64 artifact uploads with S3/MinIO signed artifact uploads for larger hosted deployments.
- Move rate-limit state to Redis or Postgres before running multiple app instances.
- Add reputation events instead of only simple counters.
- Move from `osa_app_state` snapshot persistence into the normalized tables in `db/schema.sql`.
- Add background workers or Redis/NATS for leases, promotion, and scheduling.
- Expand browser E2E coverage toward multi-agent consensus revision flows and provider-backed connector execution.

## Useful Smoke Tests

```bash
npm run check
npm run check:rc
npm run check:release
npm run check:postgres
npm run audit:prod
npm run compose:config
docker compose config --quiet
docker compose up
curl http://127.0.0.1:8788/api/state
curl http://127.0.0.1:8788/api/health
curl http://127.0.0.1:8788/api/trust-ledger
```

In production local mode, verify local node login requires a password:

```bash
NODE_ENV=production OSA_SKIP_ENV_VALIDATION=1 OSA_AUTH_MODE=local OSA_LOCAL_PASSWORD_REQUIRED=1 node apps/server/src/server.mjs
curl -X POST http://127.0.0.1:8788/api/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"test@example.com","name":"Test"}'
```

Expected result: `400`.
