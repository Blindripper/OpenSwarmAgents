import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { DashboardNotice } from "./DashboardNotice";
import type { MatchmakingCandidate, MatchmakingEntry, MatchmakingOverview } from "../types";

const button = { height: 32, padding: "0 11px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 11, fontWeight: 900, cursor: "pointer" } as const;
const badgeBase = { padding: "3px 7px", borderRadius: 6, fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" } as const;
const offlineMessage = "Preview mode: live jobs and providers are not connected on this page. The built-in model shows how OSA will route a FLOP request when the backend is live.";

function fallbackMatchmakingView(): MatchmakingOverview {
  return {
    schema: "osa-matchmaking/1",
    version: 1,
    generated_at: new Date().toISOString(),
    query: { job_id: null, include_claimed: false, include_stale: false, include_untrusted: false },
    policy: {
      source_of_truth: "osa-skill-registry/1 + canonical job views",
      matching: "deterministic_skill_overlap_trust_reputation_rank",
      signature_meaning: "provider identity and record integrity only, not quality guarantee",
      authority: "recommendation_only",
      remote_execution: false,
      connector_spawning: false,
      auto_bidding: false,
      payment: false,
      settlement: false,
    },
    status: { job_count: 1, matched_count: 1, partial_count: 0, no_match_count: 0, provider_count: 2, available_skill_count: 4, registry_schema: "osa-skill-registry/1" },
    matches: [{
      id: "matchmaking-offline-demo",
      job: {
        id: "offline:example-job",
        source: "local",
        room: "offline",
        seq: "example-job",
        title: "Example: build a wallet-safe FLOP miner dashboard",
        preview: "A FLOP request defines model hash, latency, FLOPs, confidentiality and fee. Matchmaking extracts skills, ranks providers, and explains trust gaps before any bid or execution exists.",
        text_hash: "offline-demo",
        required_skills: ["coding", "testing", "security_review", "technocore"],
        observed_at: null,
        claimed: false,
      },
      candidate_count: 2,
      top_score: 94,
      status: "matched",
      candidates: [
        {
          provider_id: "offline:local:coder",
          agent_id: "coder",
          name: "Local Coder Profile",
          source: "local",
          node_id: "this-node",
          did: "did:key:local-preview",
          score: 94,
          eligible: true,
          matched_skills: ["coding", "testing", "security_review"],
          missing_skills: ["technocore"],
          verification: { state: "verified", verified: true, stale: false, label: "LOCAL PROFILE" },
          reputation: { status: "local_signed_record", evidence_count: 0 },
          authority: { kind: "local_selectable", selectable_for_local_workspace: true, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
          reasons: ["local workspace profile", "matches implementation skills", "missing technocore specialization"],
        },
        {
          provider_id: "offline:federated:technocore-specialist",
          agent_id: "technocore-specialist",
          name: "Federated Technocore Specialist",
          source: "federated",
          node_id: "remote-node-preview",
          did: "did:key:remote-preview",
          score: 88,
          eligible: true,
          matched_skills: ["technocore", "security_review"],
          missing_skills: ["coding", "testing"],
          verification: { state: "verified", verified: true, stale: false, label: "CATALOG VERIFIED" },
          reputation: { status: "signed_record", evidence_count: 0 },
          authority: { kind: "recommendation_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
          reasons: ["federated catalog provider", "recommendation only", "no remote execution authority"],
        },
      ],
    }],
  };
}

function badge(kind: string): import("react").CSSProperties {
  const color = kind === "local"
    ? ["#2563eb", "#10204a", "#bfdbfe"]
    : kind === "verified" || kind === "matched"
      ? ["#2a8c72", "#0e2a17", "#7ee0c2"]
      : kind === "partial" || kind === "stale"
        ? ["#a16207", "#2a210e", "#fde68a"]
        : kind === "remote"
          ? ["#64748b", "#111827", "#cbd5e1"]
          : ["#7f1d1d", "#2a1010", "#fca5a5"];
  return { ...badgeBase, border: `1px solid ${color[0]}`, background: color[1], color: color[2] };
}

function short(value?: string | null) {
  if (!value) return "none";
  return value.length > 28 ? `${value.slice(0, 13)}...${value.slice(-7)}` : value;
}

function Candidate({ candidate }: { candidate: MatchmakingCandidate }) {
  return <div style={{ display: "grid", gap: 6, padding: 9, border: "1px solid #1e2a45", borderRadius: 7, background: "#09111e", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block", color: candidate.source === "local" ? "#93c5fd" : "#7ee0c2", fontSize: 13, overflowWrap: "anywhere" }}>{candidate.name}</strong>
        <span style={{ color: "#64748b", fontSize: 10, overflowWrap: "anywhere" }}>{candidate.agent_id} · {short(candidate.did)}</span>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={badge(candidate.source === "local" ? "local" : "remote")}>{candidate.source === "local" ? "LOCAL" : "FEDERATED"}</span>
        <span style={badge(candidate.verification.state)}>{candidate.verification.label}</span>
        <span style={badge(candidate.eligible ? "matched" : "partial")}>{candidate.score}</span>
      </div>
    </div>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {candidate.matched_skills.map((skill) => <span key={skill} style={badge("matched")}>{skill}</span>)}
      {candidate.missing_skills.map((skill) => <span key={skill} style={badge("partial")}>missing {skill}</span>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5, color: "#94a3b8", fontSize: 10 }}>
      <span title={candidate.node_id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Node {short(candidate.node_id)}</span>
      <span>{candidate.reputation.evidence_count} evidence refs</span>
      <span>{candidate.authority.selectable_for_local_workspace ? "Local selectable" : "Recommendation only"}</span>
    </div>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      <span style={badge(candidate.authority.selectable_for_local_workspace ? "local" : "remote")}>{candidate.authority.kind === "local_selectable" ? "LOCAL SELECTABLE" : "RECOMMENDATION ONLY"}</span>
      <span style={badge("remote")}>NO AUTO-BID</span>
      <span style={badge("remote")}>NO EXECUTION</span>
    </div>
  </div>;
}

function MatchCard({ entry }: { entry: MatchmakingEntry }) {
  const top = entry.candidates[0];
  return <article style={{ display: "grid", gap: 10, padding: 12, border: "1px solid #263757", borderRadius: 8, background: "rgba(15,23,42,.72)", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ color: "#bfdbfe", fontSize: 15, overflowWrap: "anywhere" }}>{entry.job.title}</strong>
        <div style={{ color: "#64748b", fontSize: 10 }}>{entry.job.source} · {entry.job.id}</div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={badge(entry.status)}>{entry.status.toUpperCase()}</span>
        <span style={badge("remote")}>top {entry.top_score}</span>
      </div>
    </div>
    <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{entry.job.preview}</div>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {entry.job.required_skills.map((skill) => <span key={skill} style={badge("matched")}>{skill}</span>)}
      {!entry.job.required_skills.length && <span style={badge("partial")}>no skill hints</span>}
    </div>
    {top ? <div style={{ display: "grid", gap: 7 }}>{entry.candidates.map((candidate) => <Candidate key={`${entry.id}:${candidate.provider_id}`} candidate={candidate} />)}</div>
      : <div style={{ border: "1px dashed #334155", borderRadius: 8, padding: 10, color: "#94a3b8", fontSize: 12 }}>No provider matched this job.</div>}
  </article>;
}

export function MatchmakingPanel({ onDraftRequest }: { onDraftRequest?: () => void }) {
  const [view, setView] = useState<MatchmakingOverview | null>(null);
  const [includeUnsafe, setIncludeUnsafe] = useState(false);
  const [includeClaimed, setIncludeClaimed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextUnsafe = includeUnsafe, nextClaimed = includeClaimed) => {
    setLoading(true);
    setError(null);
    try {
      setView(await api.matchmaking.overview({ include_stale: nextUnsafe, include_untrusted: nextUnsafe, include_claimed: nextClaimed, limit: 24, candidate_limit: 4 }));
    } catch {
      setView(fallbackMatchmakingView());
      setError(offlineMessage);
    } finally {
      setLoading(false);
    }
  }, [includeClaimed, includeUnsafe]);

  useEffect(() => { void load(false, false); }, []);
  const matches = useMemo(() => view?.matches || [], [view]);

  return <section data-testid="matchmaking" className="osa-market-priority-card" style={{ border: "1px solid #2563eb", borderRadius: 10, padding: 14, background: "rgba(10,20,40,.96)", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <strong style={{ fontSize: 18 }}>Matchmaking</strong>
        <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12, maxWidth: 780 }}>The first market screen: read open jobs, infer required skills, rank local and federated providers by skill overlap, verified provenance and reputation evidence. Output is a reasoned recommendation, not an automatic bid or execution.</div>
      </div>
      <button type="button" onClick={() => void load()} style={button}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
    <div className="osa-explainer-grid">
      <div className="osa-explainer-card"><strong>1. Job signals</strong><span>Title, body and explicit Skills fields become bounded required-skill hints.</span></div>
      <div className="osa-explainer-card"><strong>2. Provider ranking</strong><span>Skill Registry providers are scored by overlap, trust state, local availability and reputation evidence.</span></div>
      <div className="osa-explainer-card"><strong>3. Human gate</strong><span>Recommendations do not claim jobs, start connectors, send bids, move files or settle FLOP.</span></div>
    </div>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ display: "flex", gap: 7, alignItems: "center", color: "#94a3b8", fontSize: 11 }}>
        <input type="checkbox" checked={includeClaimed} onChange={(event) => { const next = event.target.checked; setIncludeClaimed(next); void load(includeUnsafe, next); }} />
        Include claimed jobs
      </label>
      <label style={{ display: "flex", gap: 7, alignItems: "center", color: "#94a3b8", fontSize: 11 }}>
        <input type="checkbox" checked={includeUnsafe} onChange={(event) => { const next = event.target.checked; setIncludeUnsafe(next); void load(next, includeClaimed); }} />
        Include stale and untrusted providers
      </label>
    </div>
    {error && <DashboardNotice eyebrow="Preview mode" title="Matchmaking can still be explored">
      <span>{error}</span>
      <div className="osa-notice-actions">
        {onDraftRequest && <button type="button" className="osa-primary-action" onClick={onDraftRequest}>Draft FLOP request</button>}
        <span>Connect the live OSA backend to replace this model with real jobs and providers.</span>
      </div>
    </DashboardNotice>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span style={badge("matched")}>{view?.status.matched_count || 0} matched</span>
      <span style={badge("partial")}>{view?.status.partial_count || 0} partial</span>
      <span style={badge("remote")}>{view?.status.provider_count || 0} providers</span>
      <span style={badge("remote")}>RECOMMENDATION ONLY</span>
    </div>
    {!loading && !matches.length && <div style={{ padding: 12, border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8", fontSize: 12, display: "grid", gap: 9 }}>
      <span>No open jobs to match yet. Create a request draft first, then connect a live backend when you are ready to publish it.</span>
      {onDraftRequest && <button type="button" className="osa-primary-action" onClick={onDraftRequest}>Draft FLOP request</button>}
    </div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,390px),1fr))", gap: 10 }}>
      {matches.map((entry) => <MatchCard key={entry.id} entry={entry} />)}
    </div>
  </section>;
}
