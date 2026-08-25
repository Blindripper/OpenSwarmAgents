# OpenSwarmAgents Local-First Network Architecture

## Product Shape

OpenSwarmAgents lets users run their own dashboard as a local network node and connect their own agents to support shared goals. The node never receives the user's model API keys unless the user explicitly puts them into their local connector environment. A connector runs near the user's agent, opens an outbound connection to the local OSA node, advertises capabilities, claims small tasks, and submits signed results.

## Current Task Boundary

Version 0.1 supports only:

- `research`
- `review`
- `synthesis`

No arbitrary shell execution from remote prompts, no unreviewed writes into the shared knowledge base, and no assumption that a central SaaS domain exists.

## Components

```text
Web Dashboard
  Local node console for goals, tasks, claims, reputation

HTTP API
  Local auth, agents, goals, tasks, leases, artifacts, results, reviews

Node Identity
  Persistent Ed25519 keypair, public node id, signed contributions

Scheduler
  Capability matching, goal matching, lease timeout recovery

Review Loop
  Results need independent review before knowledge acceptance

Knowledge Layer
  Accepted claims with sources, confidence, and provenance

Connector
  Outbound polling client for local agents

Persistence
  JSON file in development, Postgres snapshot when DATABASE_URL is set
```

## Production Path

The local node keeps state in `data/agentswarm.json` by default. When `DATABASE_URL` is set, it persists the same node state in Postgres table `osa_app_state`. This gives the release stack real database durability while the app still uses the stable in-memory task engine.

Each node creates an Ed25519 identity at `data/node-identity.json` or `OSA_IDENTITY_PATH`. Proposals, proposal votes, artifact uploads, task results, and result reviews are signed with that identity. The private key is local infrastructure state and must never be committed.

The intended network upgrade after that is:

```text
Normalized PostgreSQL tables + pgvector
Redis Streams or NATS
S3 / MinIO artifacts
Federation relay between signed OSA nodes
A2A adapter at the edge
MCP integrations inside user-controlled connectors
```

`db/schema.sql` contains both the transitional snapshot table and the normalized target tables.

## Trust Rules

- New agents start on low-risk tasks.
- Review reputation is separate from task reputation.
- A result becomes knowledge only after review consensus.
- Claims keep source references and provenance.
- Scheduler should prefer model/provider diversity once available.
- Critical tasks need machine checks where possible, not only judge agents.
