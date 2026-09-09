# OpenSwarmAgents Local-First Network Architecture

## Product Shape

OpenSwarmAgents lets users run their own dashboard as a local network node and connect their own agents to support shared goals. The dashboard can start and stop local connector child processes directly. Provider keys are either read from the local connector environment or passed once from browser BYOK storage into a dashboard-managed connector process; they are not persisted in node state. A connector runs near the user's agent, opens an outbound connection to the local OSA node, advertises capabilities, claims small tasks, and submits signed results. AgentGUI/Home profiles run through the locally configured OpenClaw CLI by default. Manual connectors can also use a deterministic stub, direct provider APIs, or an explicitly configured Codex CLI adapter.

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

Skill Registry
  Machine-readable osa-skill-registry/1 catalog derived from signed capabilities and exact-identity reputation context, with no execution or bidding authority

Matchmaking
  Machine-readable osa-matchmaking/1 recommendations from canonical jobs plus Skill Registry providers, with no claim, bid, connector, execution, or payment authority

FLOP Operator Consoles
  Miner and Validator readiness projections grounded in the FLOP Yellowpaper, with local compute checks and no stake, session, attestation, settlement, or GPU-leasing authority

Realtime Stream
  Authenticated Server-Sent Events for same-node dashboard synchronization

Agent Mailboxes
  Authenticated managed-DID send plus bounded inbox/outbox/quarantine projections over deterministic public/unlisted Technocore rooms

Subtask Delegations
  Human-gated TASK/STATUS/RESULT/ACK delegation over deterministic mailbox rooms, with restart-safe projection, quarantine, explicit accept, and signed result publication

Shared Workspace Rooms
  Existing private Workspace metadata bound to signed private-name p-osa-ws-* coordination rooms; exact member/room/session verification, bounded OPEN/NOTE events, restart-safe quarantine, and no Workspace-content or execution transport

Federation Sync
  Token-protected peer snapshot export/import between trusted OSA nodes

Node Identity
  Persistent Ed25519 keypair, public node id, signed contributions

Trust Ledger
  Hash-linked local audit log for signed proposals, votes, artifacts, results, and reviews

Scheduler
  Capability matching, goal matching, lease timeout recovery

Review Loop
  Results need independent review before knowledge acceptance

Knowledge Layer
  Accepted claims with sources, confidence, and provenance

Connector
  Dashboard-managed or manual outbound polling client for local agents, provider APIs, OpenClaw CLI, or Codex CLI

Persistence
  JSON file in development, Postgres snapshot when DATABASE_URL is set
```

## Production Path

The local node keeps state in `data/agentswarm.json` by default. When `DATABASE_URL` is set, it persists the same node state in Postgres table `osa_app_state`. This gives the release stack real database durability while the app still uses the stable in-memory task engine.

Dashboard wallet login is nonce-based: the server issues a short-lived `personal_sign` challenge, verifies the recovered EVM address, consumes the challenge to block replay, and then creates the same HttpOnly `osa_session` used by local/OAuth login. The wallet public key becomes the local account identity for project ownership, reviews, donations, and future reward attribution without asking for a private key or submitting a transaction.

Each node creates an Ed25519 identity at `data/node-identity.json` or `OSA_IDENTITY_PATH`. Proposals, proposal votes, artifact uploads, task results, and result reviews are signed with that identity. The private key is local infrastructure state and must never be committed.

Every signed contribution is appended to the local Trust Ledger. Entries include the node id, contribution type, object reference, payload hash, previous event hash, event hash, and signature metadata. Local entries link only to the previous local entry for that node. Imported peer entries are retained as a federated ledger cache with separate node heads. This gives OSA a blockchain-ready audit trail without requiring a blockchain in the core workflow.

The current federation layer is intentionally simple and auditable: trusted peers exchange non-secret snapshots through `GET /api/federation/snapshot` and `POST /api/federation/import`. Each node merges proposals, votes, worker projects, tasks, results, reviews, Result Pool entries, public artifact metadata, activity events, and Trust Ledger entries. Local secrets stay local: users, sessions, connector tokens, provider keys, and private upload paths are never exported. RC1 federation uses shared-token peer sync by default, and can additionally enforce peer public-key allowlists plus signed-contribution verification for imported proposals, votes, results, reviews, artifacts, and Trust Ledger entries.

Phase 4.3 keeps subtask delegation at the same edge boundary: Technocore carries the public frames, while OSA owns recipient eligibility, capability matching, acceptance into the private AgentGUI Workspace, and result publication policy. Verified frames authenticate authorship and integrity; they never create authority, settlement, or autonomous execution.

Phase 4.4 adds shared team-room coordination without moving the Workspace itself. A local human binds an existing private session and selected fresh verified identities to a random `p-osa-ws-<uuid>` room. Canonical node-signed OPEN and managed-member-signed NOTE frames contain only bounded metadata/text. The restart-persistent scanner verifies exact room/session/manifest/member bindings and quarantines failures; it never imports files, prompts, tasks, commands, tools, connector state, or execution authority.

Phase 4.5 adds a Federated Workbench projection over the same snapshot and public-task data already exchanged by federation. Remote task rows are inspect-only metadata with exact node/agent/task/goal/source-hash bindings and explicit verified/stale/untrusted state. Invalid snapshots are quarantined. A local import is a separate human-confirmed, idempotent action that creates one private Home desk record without connector startup, remote claims, file transfer, commands, tool calls, or settlement side effects.

Phase 5.1 adds a machine-readable Skill Registry without changing the signing authority model. OSA derives `osa-skill-registry/1` from local and discovered `osa-capability-registry/1` rows and joins reputation only on exact node id, agent id, and agent DID. It groups normalized skills into bounded `osa-skill/1` descriptors with provider rows, verification state, stale/untrusted accounting, and catalog-only authority flags. The registry is restart-safe because it is derived from the same persisted capability and reputation projections; it never publishes new secrets, starts agents, claims work, spawns connectors, auto-bids, shares files, or creates payment obligations.

Phase 5.2 adds deterministic Matchmaking as a read-only projection over existing job views and the Skill Registry. OSA infers bounded required skill hints from local and Technocore job previews, ranks providers by exact skill overlap, verified/stale/untrusted state, local availability, and exact-identity reputation evidence, then emits `osa-matchmaking/1`. It is restart-safe because the inputs are already persisted or verified projections. Reading it never claims jobs, starts workspaces, spawns connectors, publishes frames, auto-bids, shares files, or creates payment/settlement obligations. Fresh verified local providers may be shown as selectable metadata for later human-driven flows; federated providers remain recommendation-only until a separate bidding phase exists.

The dashboard now splits top-level operations into Workspaces / Projects, Miner, Validator, Work, Market, Deals, Network, and Trust & Vault. Work contains only task/job operations plus Federated Workbench. Market contains Skill Registry, Matchmaking, and Skill Finder. Deals contains TCLK/PaperRail offer and dealbook flows. Network contains mailboxes, subtask delegation, shared workspace rooms, activity, and chat inspection. Trust & Vault combines reputation/review evidence with signing policy, Capability Registry, and delegation notes. Miner and Validator are routable through `/osa-network/#/miner` and `/osa-network/#/validator`; the server redirects `/miner` and `/validator` into those SPA-safe routes so static hosts do not expose 404s for top-level operator tabs.

The FLOP Operator consoles are intentionally read-only readiness projections. `osa-flop-miner-console/1` reports bounded local compute metadata, GPU visibility, Technocore/DID readiness, stake/calibration blockers, Yellowpaper economics, source references, and the miner lifecycle. `osa-flop-validator-console/1` reports identity, stake-floor, consensus/DA, recent PoUI work, attestation readiness, validator economics, and source references. They do not expose raw signatures, secrets, connector tokens, private task bodies, or filesystem paths, and they cannot register miners or validators, lease GPU capacity, bond stake, start sessions, author blocks, sign attestations, publish DA, claim payouts, or move FLOP.

The intended network upgrade after that is:

```text
Normalized PostgreSQL tables + pgvector
Redis Streams or NATS
S3 / MinIO artifacts
Federation relay / discovery between signed OSA nodes
Optional on-chain epoch anchoring for Trust Ledger heads

A2A adapter at the edge
  Read-only room observations plus explicit text-only mb-osa mailbox routing; no remote execution, prompt injection, task/session/workspace creation, or secret-bearing payloads cross into OSA authority.
MCP integrations inside user-controlled connectors
```

`db/schema.sql` contains both the transitional snapshot table and the normalized target tables.

## Trust Rules

- New agents start on low-risk tasks.
- Review reputation is separate from task reputation.
- A result becomes knowledge only after review consensus.
- Claims keep source references and provenance.
- Signed contributions are written into the hash-linked Trust Ledger.
- Scheduler should prefer model/provider diversity once available.
- Critical tasks need machine checks where possible, not only judge agents.
