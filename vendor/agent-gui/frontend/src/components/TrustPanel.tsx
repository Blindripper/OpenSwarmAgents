import { useCallback, useEffect, useState } from "react";

interface TrustSummary {
  total_jobs: number;
  total_results: number;
  verified_results: number;
  accepted_results: number;
  verified_job_results: number;
  unique_counterparties: number;
  total_deals: number;
  completed_deals: number;
  claimed_deals: number;
  refunded_deals: number;
  disputed_deals: number;
  completion_rate: string;
}

interface ReputationCounts {
  accepted_results: number;
  verified_job_results: number;
  claimed_deals: number;
  refunded_deals: number;
  disputed_deals: number;
  unique_counterparties: number;
}

interface ReputationAgent {
  agent_id: string;
  name?: string;
  did?: string;
  node_id?: string;
  source?: string;
  verified: boolean;
  stale?: boolean;
  status?: string;
  rejection_reason?: string | null;
  counts: ReputationCounts;
  kv_path?: string;
  payload_hash?: string | null;
  evidence_hash?: string | null;
  last_seen_at?: string | null;
  provenance?: { room?: string | null; seq?: number | null; announced_at?: string | null } | null;
}

interface ReputationState {
  status: {
    enabled: boolean;
    kv_namespace: string;
    last_scan_status?: string | null;
    last_scan_at?: string | null;
    last_error?: string | null;
    verified_count: number;
    rejected_count: number;
  };
  local: ReputationAgent[];
  discovered: ReputationAgent[];
}

interface TrustResponse {
  summary: TrustSummary | null;
  top_builders: ReputationAgent[];
  reputation: ReputationState | null;
}

const shortHash = (value?: string | null) => value ? `${value.slice(0, 10)}...${value.slice(-6)}` : "pending";
const shortDid = (value?: string | null) => value ? `${value.slice(0, 16)}...${value.slice(-8)}` : "unknown";

const badgeStyle = (kind: "verified" | "stale" | "untrusted" | "local") => ({
  padding: "3px 9px",
  borderRadius: 6,
  border: "1px solid " + (kind === "verified" ? "#2a8c72" : kind === "stale" ? "#a16207" : kind === "local" ? "#2563eb" : "#7f1d1d"),
  background: kind === "verified" ? "#0e2a17" : kind === "stale" ? "#2a210e" : kind === "local" ? "#10204a" : "#2a1010",
  color: kind === "verified" ? "#7ee0c2" : kind === "stale" ? "#facc15" : kind === "local" ? "#93c5fd" : "#fca5a5",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0,
});

export function TrustPanel() {
  const [summary, setSummary] = useState<TrustSummary | null>(null);
  const [reputation, setReputation] = useState<ReputationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"publish" | "scan" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/trust");
      const data = await response.json() as TrustResponse & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Trust load failed");
      setSummary(data.summary || null);
      setReputation(data.reputation || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Trust load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runReputationAction = useCallback(async (action: "publish" | "scan") => {
    setBusy(action);
    setError(null);
    try {
      const resp = await fetch(action === "publish" ? "/api/reputation/publish" : "/api/reputation/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Reputation action failed");
      setReputation(data.reputation || data);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reputation action failed");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading trust data...</div>;

  const allReputation = [...(reputation?.local || []).map((agent) => ({ ...agent, source: "local" })), ...(reputation?.discovered || [])];
  const visibleReputation = allReputation.sort((a, b) => {
    const aTrusted = a.verified && !a.stale ? 1 : 0;
    const bTrusted = b.verified && !b.stale ? 1 : 0;
    const aEvidence = a.counts.accepted_results + a.counts.verified_job_results + a.counts.claimed_deals;
    const bEvidence = b.counts.accepted_results + b.counts.verified_job_results + b.counts.claimed_deals;
    return bTrusted - aTrusted || bEvidence - aEvidence || a.agent_id.localeCompare(b.agent_id);
  });

  const reputationCard = (agent: ReputationAgent) => {
    const local = agent.source === "local";
    const stale = agent.stale === true;
    const untrusted = !agent.verified;
    const counts = agent.counts || { accepted_results: 0, verified_job_results: 0, claimed_deals: 0, refunded_deals: 0, disputed_deals: 0, unique_counterparties: 0 };
    return (
      <div key={`${agent.node_id || "local"}-${agent.agent_id}-${agent.kv_path || "none"}`} style={{ display: "grid", gap: 8, padding: "10px 12px", border: "1px solid #1e2a45", borderRadius: 8, background: "rgba(15,23,42,0.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <strong style={{ color: local ? "#93c5fd" : "#7ee0c2", fontSize: 14 }}>{agent.name || agent.agent_id}</strong>
            <span style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 460, whiteSpace: "nowrap" }}>{agent.agent_id} · {shortDid(agent.did)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {local && <span style={badgeStyle("local")}>LOCAL</span>}
            {agent.verified && !stale && <span style={badgeStyle("verified")}>SIGNED RECORD</span>}
            {stale && <span style={badgeStyle("stale")}>STALE</span>}
            {untrusted && <span style={badgeStyle("untrusted")}>UNTRUSTED</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, fontSize: 11 }}>
          {[
            ["Accepted", counts.accepted_results, "#93c5fd"],
            ["Job Results", counts.verified_job_results, "#7ee0c2"],
            ["Claimed", counts.claimed_deals, "#7ee0c2"],
            ["Refunded", counts.refunded_deals, "#facc15"],
            ["Disputed", counts.disputed_deals, "#fca5a5"],
            ["Counterparties", counts.unique_counterparties, "#cbd5e1"],
          ].map(([label, value, color]) => (
            <div key={String(label)} style={{ padding: "7px 8px", border: "1px solid #273453", borderRadius: 6, background: "#0b1220" }}>
              <div style={{ color: String(color), fontWeight: 900, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{String(value)}</div>
              <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>{String(label)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, fontSize: 11, color: "#94a3b8" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>KV {agent.kv_path || "local"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Payload {shortHash(agent.payload_hash)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Evidence {shortHash(agent.evidence_hash)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.provenance?.room ? `Seen #${agent.provenance.room}${agent.provenance.seq ? `:${agent.provenance.seq}` : ""}` : (agent.status || "local")}</span>
        </div>
        {agent.rejection_reason && <div style={{ color: "#fca5a5", fontSize: 11 }}>Rejected: {agent.rejection_reason}</div>}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 13 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 12, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 8, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>Evidence Summary</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Verified local results, PaperRail terminal deals, refunds, disputes, and unique counterparties.</div>
        {summary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 12 }}>
            {[
              { label: "Accepted Results", value: summary.accepted_results, color: "#93c5fd" },
              { label: "Verified Jobs", value: summary.verified_job_results, color: "#7ee0c2" },
              { label: "Claimed Deals", value: summary.claimed_deals, color: "#7ee0c2" },
              { label: "Refunded", value: summary.refunded_deals, color: "#facc15" },
              { label: "Disputed", value: summary.disputed_deals, color: "#fca5a5" },
              { label: "Counterparties", value: summary.unique_counterparties, color: "#cbd5e1" },
            ].map((metric) => (
              <div key={metric.label} style={{ padding: "10px 12px", border: "1px solid #1e2a45", borderRadius: 8, textAlign: "center" }}>
                <div style={{ color: metric.color, fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{metric.value}</div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>{metric.label}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 0" }}>No evidence data yet.</div>}
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 8, padding: 16, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>Federated Reputation</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {reputation?.status.enabled ? `KV ${reputation.status.kv_namespace} · ${reputation.status.verified_count} signature-verified · ${reputation.status.rejected_count} untrusted` : "Local signed records; Technocore publish is disabled."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy !== null} onClick={() => void runReputationAction("publish")} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>{busy === "publish" ? "Publishing..." : "Publish"}</button>
            <button type="button" disabled={busy !== null} onClick={() => void runReputationAction("scan")} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#93c5fd", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>{busy === "scan" ? "Scanning..." : "Scan"}</button>
          </div>
        </div>
        {reputation?.status.last_error && <div style={{ color: "#facc15", fontSize: 11, marginBottom: 8 }}>Scanner using cached projection: {reputation.status.last_error}</div>}
        {visibleReputation.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 0" }}>No reputation records yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>{visibleReputation.map(reputationCard)}</div>
        )}
      </section>
    </div>
  );
}
