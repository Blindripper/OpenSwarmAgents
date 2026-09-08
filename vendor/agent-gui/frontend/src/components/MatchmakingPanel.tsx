import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { MatchmakingCandidate, MatchmakingEntry, MatchmakingOverview } from "../types";

const button = { height: 32, padding: "0 11px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 11, fontWeight: 900, cursor: "pointer" } as const;
const badgeBase = { padding: "3px 7px", borderRadius: 6, fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" } as const;

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

export function MatchmakingPanel() {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matchmaking unavailable");
    } finally {
      setLoading(false);
    }
  }, [includeClaimed, includeUnsafe]);

  useEffect(() => { void load(false, false); }, []);
  const matches = useMemo(() => view?.matches || [], [view]);

  return <section data-testid="matchmaking" style={{ border: "1px solid #2563eb", borderRadius: 10, padding: 14, background: "rgba(10,20,40,.96)", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <strong style={{ fontSize: 17 }}>Matchmaking</strong>
        <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Job-to-agent recommendations from the Skill Registry.</div>
      </div>
      <button type="button" onClick={() => void load()} style={button}>{loading ? "Loading..." : "Refresh"}</button>
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
    {error && <div role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span style={badge("matched")}>{view?.status.matched_count || 0} matched</span>
      <span style={badge("partial")}>{view?.status.partial_count || 0} partial</span>
      <span style={badge("remote")}>{view?.status.provider_count || 0} providers</span>
      <span style={badge("remote")}>RECOMMENDATION ONLY</span>
    </div>
    {!loading && !matches.length && <div style={{ padding: 12, border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8", fontSize: 12 }}>No open jobs to match.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,390px),1fr))", gap: 10 }}>
      {matches.map((entry) => <MatchCard key={entry.id} entry={entry} />)}
    </div>
  </section>;
}
