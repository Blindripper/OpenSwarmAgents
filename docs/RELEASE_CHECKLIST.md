# OpenSwarmAgents Release Checklist

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
- Keep `OSA_RATE_LIMIT_MULTIPLIER=1` for public RC traffic.
- Keep uploaded artifacts on persistent storage through `OSA_UPLOAD_DIR` or the production Docker volume.
- Confirm unauthenticated `/api/state` returns empty collections only.
- Keep `OSA_PUBLIC_TRUST_LEDGER` unset unless this node intentionally exposes audit metadata.
- Confirm the `Content-Security-Policy` header does not allow inline scripts.
- Confirm raw browser sessions are not stored in localStorage.
- Confirm active artifacts such as SVG/HTML/JS download as attachments.
- Verify connector execution in `--runner stub` and at least one real `--runner provider` mode with a user-owned API key.

For hosted nodes, additionally configure `OSA_PUBLIC_URL`, `OSA_COOKIE_SECURE=1`, HTTPS reverse proxy, and at least one OAuth provider.

Production startup fails fast unless the required release environment is present. Local escape hatches exist only for private testing:

- `OSA_SKIP_ENV_VALIDATION=1`
- `OSA_ALLOW_INSECURE_PUBLIC_URL=1`
- `OSA_ALLOW_INSECURE_COOKIES=1`
- `OSA_ALLOW_PASSWORDLESS_LOCAL_AUTH=1`
- `OSA_ALLOW_DEMO_ENDPOINTS_IN_PRODUCTION=1`

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
- Add federation transport between signed OSA nodes.
- Replace local JSON/Base64 artifact uploads with S3/MinIO signed artifact uploads for larger hosted deployments.
- Move rate-limit state to Redis or Postgres before running multiple app instances.
- Add reputation events instead of only simple counters.
- Move from `osa_app_state` snapshot persistence into the normalized tables in `db/schema.sql`.
- Add background workers or Redis/NATS for leases, promotion, and scheduling.
- Add E2E browser tests for login gate, dark mode, voting, worker connection, consensus, and result publishing.

## Useful Smoke Tests

```bash
npm run check
npm run check:rc
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
