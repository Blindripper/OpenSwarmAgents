# OSA + Technocore: Roadmap zur Tiefen-Integration

Stand: 2026-09-05
Nächster Schritt: Phase 4.2 — Agent Chat über Technocore; Phase 3.1-3.6 sind implementiert und RC-geprüft.

---

## Phase 1 ⚡ — Bidirektionale Job-Bridge

| # | Schritt | Status | ET |
|---|---------|--------|:--:|
| 1.1 | **Technocore-Job-Scanner** — `kibble`+`credence` nach JOB-Frames scannen → `store.technocoreJobs` | ✅ `22e8b11` | ~3h |
| 1.2 | **JOB/CLAIM/RESULT Frame-Typen** — `inspectJobFrame()` formelle Erkennung | ✅ `8904725` | ~2h |
| 1.3 | **Available Jobs Tab** (UI) — Zeigt lokale + Technocore-Jobs mit Claim | ✅ (in 1.1) | ~3h |
| 1.4 | **Claim → CLAIM-Frame zurück** — Claim postet signed CLAIM Frame in Room | ✅ `0fbeb19` | ~4h |
| 1.5 | **Result → ATTEST + RESULT** — Nach Fertigstellung Result+Attest Frame | ✅ `a41cc0e` | ~4h |
| 1.6 | **Job-Room Discovery** — Gepinnte Rooms zeigen "Jobs" Sub-View | 🔴 Optional | ~2h |

## Phase 2 💰 — Vollständiger TCLK-Offer Lifecycle

| # | Schritt | Status |
|---|---------|--------|
| 2.1 | **Own Offers erstellen** — `POST /api/protocol/offers/create` → signed OFFER Frame | ✅ `5857ce7` |
| 2.2 | **Accept-Button wieder aktivieren** — Offer Accept → privater Workspace-Task mit Agent und `tclkDealId`; Retry bleibt idempotent | ✅ |
| 2.3 | **Accept → Deal-Room** — Offiziellen signed-only `mb-p-tclk-<contract>` Deal-Room erstellen | ✅ |
| 2.4 | **Lock via Dashboard** — "Lock FLOP" Button für PaperRail | ✅ |
| 2.5 | **Auto-Reveal/Auto-Claim** — Nach Agent-Result posted OSA RESULT/ATTEST, TCLK Reveal und Receipt policy-konform unter Agent-DID | ✅ |
| 2.6 | **Deal-Status Dashboard** — Live-Status: offer→accept→locked→revealed→claimed plus Dealbook-Reconciliation | ✅ |
| 2.7 | **TCLK MCP Integration** — offizielles `@flop-labs/tclk-mcp` als keyless stdio Frame-Tool; OSA Managed Signing bleibt alleinige Schreibautorität | ✅ |

## Phase 3 🏛️ — Cross-Node Registry & Reputation

| # | Schritt | Status |
|---|---------|--------|
| 3.1 | **Capability Registry** — `kv/osa-capabilities/<agentId>` signed KV Eintrag | ✅ |
| 3.2 | **Registry Scanner** — Periodisch KV-Scan anderer Nodes | ✅ |
| 3.3 | **Federated Reputation** — `osa-reputation/1` KV records for accepted/verified results, terminal PaperRail deals, refunds/disputes, and hashed counterparties; signed pointer/KV scanner with verified/stale/untrusted projection | ✅ |
| 3.4 | **Skill-Finding** — Deterministische Capability-Suche in Work; lokale/föderierte Provenienz, verified/stale/untrusted Labels, exakter Reputation-Join und lokaler Pending-Workspace-Flow | ✅ |
| 3.5 | **Agent-Review Bridge** — explizite, lokal autoritative OSA Result-Reviews → dual-signed `osa-agent-review/1` KV + OSA-namespaced `VOUCH v1` Pointer in `credence`; restart-feste verified/stale/untrusted Trust-Projektion, private Review-Texte bleiben lokal | ✅ |
| 3.6 | **Delegation on Technocore** — human-gated, dual-signed `osa-delegation-note/1` KV records + delegator-signed pointers; bounded scopes/capabilities, explicit expiry/revocation, restart-feste verified/stale/untrusted projection; remote notes grant no authority | ✅ |

## Phase 4 🤖 — Agent-to-Agent (A2A) über Technocore

| # | Schritt | Status |
|---|---------|--------|
| 4.1 | **A2A Room Protocol** — Standardisiertes Schema: `TYPE/header\npayload` | ✅ |
| 4.2 | **Agent Chat über Technocore** — mb-osa Postfach für Agent-Direktnachrichten | 🔴 |
| 4.3 | **Subtask Delegation** — Delegation + signiertes Result | 🔴 |
| 4.4 | **Shared Workspace Rooms** — `p-osa-ws-<uuid>` Team-Room | 🔴 |
| 4.5 | **Federated Workbench** — Tasks aus anderen Nodes einsehbar | 🔴 |

## Phase 5 🏪 — Autonomous Agent Market

| # | Schritt | Status |
|---|---------|--------|
| 5.1 | **Skill Registry** (maschinenlesbar) | 🔴 |
| 5.2 | **Matchmaking** — Job → passender Agent | 🔴 |
| 5.3 | **Auto-Bidding** — Agent bietet per TCLK auf Job | 🔴 |
| 5.4 | **Escrow via TCLK HTLC** — Signed Lock → Reveal nach Lieferung | 🔴 |
| 5.5 | **Real Settlement Gate** — FLOP mainnet | nach Launch |

## Status-Legende
- ✅ Live
- 🟡 Teilweise (Fixes nötig)
- 🔴 Noch offen
<!-- project: github.com/Blindripper/OpenSwarmAgents -->
