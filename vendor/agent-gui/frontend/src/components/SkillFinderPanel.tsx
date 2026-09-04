import { useCallback, useEffect, useState } from "react";

interface SkillFinderCounts {
  accepted_results: number;
  verified_job_results: number;
  claimed_deals: number;
  refunded_deals: number;
  disputed_deals: number;
  unique_counterparties: number;
}

interface SkillFinderMatch {
  id: string;
  source: "local" | "federated";
  agent_id: string;
  name: string;
  tagline?: string;
  did: string;
  node_id: string;
  capabilities: string[];
  matched_skills: string[];
  eligible: boolean;
  eligibility: string;
  verification: {
    verified: boolean;
    stale: boolean;
    label: string;
    rejection_reason?: string | null;
    note: string;
  };
  provenance: {
    kind: "local" | "technocore";
    room?: string | null;
    seq?: number | null;
    kv_path?: string | null;
    payload_hash?: string | null;
    last_seen_at?: string | null;
  };
  reputation: {
    status: "none" | "untrusted" | "stale" | "local_signed_record" | "signed_record";
    label: string;
    verified: boolean;
    stale: boolean;
    counts: SkillFinderCounts;
    evidence_hash?: string | null;
    kv_path?: string | null;
    note: string;
  };
  action: {
    kind: "local_workspace" | "discovery_only";
    enabled: boolean;
    label: string;
  };
}

interface SkillFinderResponse {
  query: { raw: string; skills: string[]; source: string };
  status: {
    capability_scan?: string | null;
    capability_error?: string | null;
    reputation_scan?: string | null;
    reputation_error?: string | null;
    matched_count: number;
    returned_count: number;
    excluded: { untrusted: number; stale: number };
  };
  available_skills: string[];
  matches: SkillFinderMatch[];
}

interface Props {
  onUseLocalAgent: (agentId: string) => void | Promise<void>;
}

const panelStyle: React.CSSProperties = {
  border: "1px solid #273453",
  borderRadius: 10,
  padding: 16,
  background: "#0b1525",
};

const fieldStyle: React.CSSProperties = {
  height: 36,
  borderRadius: 7,
  border: "1px solid #2a3558",
  background: "#111827",
  color: "#e5e7eb",
  fontSize: 13,
  padding: "0 11px",
  minWidth: 0,
};

function badgeStyle(kind: "local" | "signed" | "stale" | "untrusted" | "neutral"): React.CSSProperties {
  const palette = {
    local: ["#2563eb", "#10204a", "#93c5fd"],
    signed: ["#2a8c72", "#0e2a17", "#7ee0c2"],
    stale: ["#a16207", "#2a210e", "#facc15"],
    untrusted: ["#7f1d1d", "#2a1010", "#fca5a5"],
    neutral: ["#475569", "#172033", "#cbd5e1"],
  }[kind];
  return {
    padding: "3px 8px",
    borderRadius: 6,
    border: `1px solid ${palette[0]}`,
    background: palette[1],
    color: palette[2],
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}

const shortValue = (value?: string | null) => value ? `${value.slice(0, 12)}...${value.slice(-6)}` : "none";
const displaySkill = (value: string) => value.replace(/_/g, " ");

export function SkillFinderPanel({ onUseLocalAgent }: Props) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | "local" | "federated">("all");
  const [includeUnsafe, setIncludeUnsafe] = useState(false);
  const [data, setData] = useState<SkillFinderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (nextQuery: string, nextSource = source, nextIncludeUnsafe = includeUnsafe, markSearched = true) => {
    if (markSearched && !nextQuery.trim()) {
      setSearched(true);
      setData(null);
      setError("Enter at least one skill. Use commas when every listed skill is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ skill: nextQuery, source: nextSource, limit: "50" });
      if (nextIncludeUnsafe) {
        params.set("include_untrusted", "1");
        params.set("include_stale", "1");
      }
      const response = await fetch(`/api/agents/find?${params.toString()}`);
      const payload = await response.json() as SkillFinderResponse & { detail?: string };
      if (!response.ok) throw new Error(payload.detail || "Skill search failed");
      setData(payload);
      if (markSearched) setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill search failed");
    } finally {
      setLoading(false);
    }
  }, [includeUnsafe, source]);

  useEffect(() => {
    void request("", "all", false, false);
  }, []);

  const runCurrentSearch = (nextSource = source, nextIncludeUnsafe = includeUnsafe) => {
    void request(query, nextSource, nextIncludeUnsafe, true);
  };

  const exclusionCount = (data?.status.excluded.untrusted || 0) + (data?.status.excluded.stale || 0);

  return (
    <section style={panelStyle} data-testid="skill-finder">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 950, marginBottom: 4 }}>Find Agent by Skill</div>
          <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5, maxWidth: 760 }}>
            Exact capability matching across the local registry and verified federated claims. A valid signature authenticates the record—not the skill, quality, or endorsement.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={badgeStyle("local")}>LOCAL = RUNNABLE HERE</span>
          <span style={badgeStyle("signed")}>SIGNED ≠ ENDORSED</span>
        </div>
      </div>

      <form
        className="skill-finder-form"
        onSubmit={(event) => { event.preventDefault(); runCurrentSearch(); }}
        style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(120px, 170px) auto", gap: 8, alignItems: "center" }}
      >
        <input
          aria-label="Skill search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="coding or coding, testing"
          list="osa-skill-finder-options"
          style={fieldStyle}
        />
        <datalist id="osa-skill-finder-options">
          {(data?.available_skills || []).map((skill) => <option key={skill} value={skill}>{displaySkill(skill)}</option>)}
        </datalist>
        <select
          aria-label="Agent source"
          value={source}
          onChange={(event) => {
            const next = event.target.value as "all" | "local" | "federated";
            setSource(next);
            if (searched && query.trim()) runCurrentSearch(next, includeUnsafe);
          }}
          style={fieldStyle}
        >
          <option value="all">Local + federated</option>
          <option value="local">Local only</option>
          <option value="federated">Federated only</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          style={{ height: 36, padding: "0 15px", borderRadius: 7, border: "1px solid #2a8c72", background: loading ? "#17251f" : "#0f766e", color: "white", fontSize: 13, fontWeight: 900, cursor: loading ? "default" : "pointer", whiteSpace: "nowrap" }}
        >
          {loading ? "Searching..." : "Find Agents"}
        </button>
      </form>

      <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, color: "#94a3b8", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
        <input
          type="checkbox"
          checked={includeUnsafe}
          onChange={(event) => {
            const next = event.target.checked;
            setIncludeUnsafe(next);
            if (searched && query.trim()) runCurrentSearch(source, next);
          }}
        />
        Show stale and untrusted claims (never selectable)
      </label>

      {error && (
        <div role="alert" style={{ marginTop: 12, color: "#fca5a5", fontSize: 12 }}>
          {error}
          <button type="button" onClick={() => runCurrentSearch()} style={{ marginLeft: 8, padding: "3px 8px", borderRadius: 5, border: "1px solid #7f1d1d", color: "#fecaca" }}>Retry</button>
        </div>
      )}

      {(data?.status.capability_error || data?.status.reputation_error) && (
        <div style={{ marginTop: 12, color: "#facc15", fontSize: 11 }}>
          Cached registry data in use: {data.status.capability_error || data.status.reputation_error}
        </div>
      )}

      {searched && !loading && !error && data && data.matches.length === 0 && (
        <div style={{ marginTop: 14, padding: "13px 14px", border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8", fontSize: 12 }}>
          No eligible agents match <strong style={{ color: "#cbd5e1" }}>{data.query.skills.map(displaySkill).join(" + ") || query}</strong>.
          {exclusionCount > 0 && ` ${exclusionCount} stale or untrusted matching claim${exclusionCount === 1 ? " was" : "s were"} hidden.`}
        </div>
      )}

      {searched && data && data.matches.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 10, marginTop: 14 }}>
          {data.matches.map((agent) => {
            const capabilityKind = !agent.verification.verified ? "untrusted" : agent.verification.stale ? "stale" : agent.source === "local" ? "local" : "signed";
            const reputationKind = agent.reputation.status === "untrusted" ? "untrusted" : agent.reputation.status === "stale" ? "stale" : ["signed_record", "local_signed_record"].includes(agent.reputation.status) ? "signed" : "neutral";
            const counts = agent.reputation.counts;
            return (
              <article key={agent.id} style={{ display: "grid", gap: 9, minWidth: 0, padding: "12px", border: `1px solid ${agent.eligible ? "#2a4558" : "#44252d"}`, borderRadius: 9, background: "rgba(15,23,42,0.62)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", color: agent.source === "local" ? "#93c5fd" : "#7ee0c2", fontSize: 15, overflowWrap: "anywhere" }}>{agent.name}</strong>
                    <span style={{ color: "#64748b", fontSize: 10, overflowWrap: "anywhere" }}>{agent.agent_id} · {shortValue(agent.did)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span style={badgeStyle(agent.source === "local" ? "local" : "neutral")}>{agent.source === "local" ? "LOCAL" : "FEDERATED"}</span>
                    <span style={badgeStyle(capabilityKind)}>{agent.verification.label}</span>
                  </div>
                </div>
                {agent.tagline && <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }}>{agent.tagline}</div>}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {agent.matched_skills.map((skill) => <span key={skill} style={{ padding: "3px 7px", borderRadius: 5, background: "#10251f", border: "1px solid #2a8c72", color: "#7ee0c2", fontSize: 10, fontWeight: 800 }}>{displaySkill(skill)}</span>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                  {[["Accepted", counts.accepted_results], ["Job results", counts.verified_job_results], ["Claimed", counts.claimed_deals]].map(([label, value]) => (
                    <div key={String(label)} style={{ padding: "6px", border: "1px solid #273453", borderRadius: 6, background: "#0b1220", minWidth: 0 }}>
                      <div style={{ color: "#e2e8f0", fontWeight: 900, fontSize: 14 }}>{String(value)}</div>
                      <div style={{ color: "#64748b", fontSize: 9, overflowWrap: "anywhere" }}>{String(label)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={badgeStyle(reputationKind)}>{agent.reputation.label}</span>
                  {(counts.refunded_deals > 0 || counts.disputed_deals > 0) && <span style={{ color: "#facc15", fontSize: 10 }}>{counts.refunded_deals} refunded · {counts.disputed_deals} disputed</span>}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.45 }}>{agent.reputation.note}</div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 6, color: "#64748b", fontSize: 10 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={agent.node_id}>Node {shortValue(agent.node_id)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={agent.provenance.kv_path || ""}>KV {agent.provenance.kv_path || "none"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.provenance.room ? `#${agent.provenance.room}${agent.provenance.seq ? `:${agent.provenance.seq}` : ""}` : "local node"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Hash {shortValue(agent.provenance.payload_hash)}</span>
                </div>
                {agent.verification.rejection_reason && <div style={{ color: "#fca5a5", fontSize: 10 }}>Rejected: {agent.verification.rejection_reason}</div>}
                {agent.action.enabled ? (
                  <button
                    type="button"
                    aria-label={`Use ${agent.name} in Workspace`}
                    onClick={() => void onUseLocalAgent(agent.agent_id)}
                    style={{ height: 34, borderRadius: 7, border: "1px solid #2563eb", background: "#1d4ed8", color: "white", fontWeight: 900, fontSize: 12 }}
                  >
                    Use in Workspace
                  </button>
                ) : (
                  <div style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid #334155", color: agent.eligible ? "#94a3b8" : "#fca5a5", fontSize: 10, lineHeight: 1.4, textAlign: "center" }}>
                    {agent.eligible ? "Discovery only — no remote execution or authority is granted." : "Not selectable — this claim is stale or untrusted."}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
