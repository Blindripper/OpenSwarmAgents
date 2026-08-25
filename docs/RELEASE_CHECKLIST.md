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

## Still Open Before Wider Release

- Replace the stub connector with a real OpenClaw/Codex task adapter.
- Harden signed connector tokens further with rotation, shorter expiries, and audit UI.
- Add S3/MinIO signed artifact uploads for images, PDFs, CSV/Excel files, code bundles, video, audio, and generic files.
- Add rate limits for proposal creation, voting, agent registration, task claiming, and result submission.
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
```

In production mode, verify:

```bash
curl -X POST http://127.0.0.1:8788/api/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"test@example.com","name":"Test"}'
```

Expected result: `403`.
