# OSA + Technocore: Roadmap zur Tiefen-Integration

Stand: 2026-09-03
Nächster Schritt: Phase 1.1 — Technocore-Job-Scanner

---

## Phase 1 ⚡ — Bidirektionale Job-Bridge

| # | Schritt | Status | ET |
|---|---------|--------|:--:|
| 1.1 | **Technocore-Job-Scanner** — `kibble`+`credence` nach JOB-Frames scannen → `store.technocoreJobs` | 🔴 | ~3h |
| 1.2 | **JOB-Frames erkennen** — `inspectProtocolTranscript()` um JOB/CLAIM/RESULT Frame-Typen erweitern | 🔴 | ~2h |
| 1.3 | **Available Jobs Tab** (UI) — Neuer "Jobs" Tab zeigt lokale + Technocore-Jobs | 🔴 | ~3h |
| 1.4 | **Claim → CLAIM-Frame zurück** — Claim postet signed CLAIM Frame in Room | 🔴 | ~4h |
| 1.5 | **Result → ATTEST + RESULT** — Nach Agent-Fertigstellung Result Frame posten | 🔴 | ~4h |
| 1.6 | **Job-Room Discovery** — Gepinnte Rooms zeigen "Jobs" Sub-View | 🔴 | ~2h |

## Phase 2 💰 — Vollständiger TCLK-Offer Lifecycle

| # | Schritt | Status |
|---|---------|--------|
| 2.1 | **Own Offers erstellen** — `POST /api/protocol/offers/create` → signed OFFER Frame | 🔴 |
| 2.2 | **Accept-Button wieder aktivieren** — Offer Accept → Workspace-Task mit tclkDealId | 🔴 |
| 2.3 | **Accept → Deal-Room** — Privaten `e-p-<contract>` Deal-Room erstellen | 🔴 |
| 2.4 | **Lock via Dashboard** — "Lock FLOP" Button für PaperRail | 🔴 |
| 2.5 | **Auto-Reveal/Auto-Claim** — ✅ Schon da (`autoClaimTclkDealForTask`), Fix für tclkDealId | 🟡 |
| 2.6 | **Deal-Status Dashboard** — Live-Status: offer→accept→locked→revealed→claimed | 🔴 |
| 2.7 | **TCLK MCP Integration** — `@flop-labs/tclk-mcp` starten für Framebau | 🔴 |

## Phase 3 🏛️ — Cross-Node Registry & Reputation

| # | Schritt | Status |
|---|---------|--------|
| 3.1 | **Capability Registry** — `kv/osa-capabilities/<agentId>` signed KV Eintrag | 🔴 |
| 3.2 | **Registry Scanner** — Periodisch KV-Scan anderer Nodes | 🔴 |
| 3.3 | **Federated Reputation** — Verified Results/Completed Deals in KV publish | 🔴 |
| 3.4 | **Skill-Finding** — Dashboard: "Find Agent mit Skill X" | 🔴 |
| 3.5 | **Agent-Review Bridge** — OSA Reviews → signed nach `credence` | 🔴 |
| 3.6 | **Delegation on Technocore** — KV Delegation Notes | 🔴 |

## Phase 4 🤖 — Agent-to-Agent (A2A) über Technocore

| # | Schritt | Status |
|---|---------|--------|
| 4.1 | **A2A Room Protocol** — Standardisiertes Schema: `TYPE/header\npayload` | 🔴 |
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