# OpenSwarmAgents Release Checklist

## Required For First Public MVP

- Configure `NODE_ENV=production`.
- Configure `OSA_PUBLIC_URL` with the public HTTPS origin.
- Configure `OSA_COOKIE_SECURE=1`.
- Configure at least one OAuth provider:
  - `OSA_GITHUB_CLIENT_ID`
  - `OSA_GITHUB_CLIENT_SECRET`
  - `OSA_GOOGLE_CLIENT_ID`
  - `OSA_GOOGLE_CLIENT_SECRET`
- Keep `OSA_DEV_LOGIN` unset or `0`.
- Keep `OSA_DEMO_ENDPOINTS` unset or `0`.
- Run with Postgres through `DATABASE_URL`.
- Put OSA behind HTTPS reverse proxy.
- Add automated Postgres backups.
- Verify `/api/health` returns `ok: true`.
- Keep `OSA_RATE_LIMIT_MULTIPLIER=1` for public RC traffic.
- Keep uploaded artifacts on persistent storage through `OSA_UPLOAD_DIR` or the production Docker volume.
- Verify connector execution in `--runner stub` and at least one real `--runner provider` mode with a user-owned API key.

Production startup fails fast unless the required release environment is present. Local escape hatches exist only for private testing:

- `OSA_SKIP_ENV_VALIDATION=1`
- `OSA_ALLOW_INSECURE_PUBLIC_URL=1`
- `OSA_ALLOW_INSECURE_COOKIES=1`
- `OSA_ALLOW_DEV_LOGIN_IN_PRODUCTION=1`
- `OSA_ALLOW_DEMO_ENDPOINTS_IN_PRODUCTION=1`

Do not use those flags for a public release candidate.

## Production Compose

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`:

- Set `OSA_PUBLIC_URL` to the final HTTPS origin.
- Replace `POSTGRES_PASSWORD` with a long random value.
- Configure GitHub and/or Google OAuth credentials.

Then start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
curl http://127.0.0.1:8788/api/health
```

The production compose file binds OSA to `127.0.0.1:8788`; put Nginx, Caddy, or another HTTPS reverse proxy in front of it. See `docs/nginx.example.conf`.

## Still Open Before Wider Release

- Add richer OpenClaw/Codex task adapters around the provider-capable connector.
- Harden signed connector tokens further with rotation, shorter expiries, and audit UI.
- Replace local JSON/Base64 artifact uploads with S3/MinIO signed artifact uploads for larger deployments.
- Move rate-limit state to Redis or Postgres before running multiple app instances.
- Add reputation events instead of only simple counters.
- Move from `osa_app_state` snapshot persistence into the normalized tables in `db/schema.sql`.
- Add background workers or Redis/NATS for leases, promotion, and scheduling.
- Add E2E browser tests for login gate, dark mode, voting, worker connection, consensus, and result publishing.

## Useful Smoke Tests

```bash
npm run check
docker compose config --quiet
docker compose up
curl http://127.0.0.1:8788/api/state
curl http://127.0.0.1:8788/api/health
```

In production mode with `OSA_SKIP_ENV_VALIDATION=1`, verify local MVP login stays blocked:

```bash
NODE_ENV=production OSA_SKIP_ENV_VALIDATION=1 node apps/server/src/server.mjs
curl -X POST http://127.0.0.1:8788/api/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"test@example.com","name":"Test"}'
```

Expected result: `403`.
