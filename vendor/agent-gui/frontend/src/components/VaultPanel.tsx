import { useCallback, useEffect, useState } from "react";

interface AgentDidInfo {
  agent_id: string;
  did: string;
  capabilities: string[];
  published: boolean;
  registry_published?: boolean;
  registry_status?: string | null;
  registry_path?: string | null;
  registry_payload_hash?: string | null;
  registry_verified?: boolean;
}

interface DelegationInfo {
  id: string;
  from_agent: string;
  to_agent: string;
  scope: string;
  policy: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface CapabilityRegistryAgent {
  agent_id: string;
  name: string;
  tagline?: string;
  did: string;
  node_id: string;
  node_did?: string | null;
  capabilities: string[];
  kv_path: string;
  payload_hash?: string | null;
  verified: boolean;
  status: string;
  stale?: boolean;
  rejection_reason?: string | null;
  last_seen_at?: string | null;
  last_publish_status?: string | null;
  provenance?: { room?: string | null; seq?: number | null; from?: string | null; announced_at?: string | null } | null;
}

interface CapabilityRegistryState {
  status: {
    enabled: boolean;
    kv_namespace: string;
    scan_rooms: string[];
    last_scan_at?: string | null;
    last_scan_status?: string | null;
    last_error?: string | null;
    local_count: number;
    discovered_count: number;
    verified_count: number;
    rejected_count: number;
  };
  local: CapabilityRegistryAgent[];
  discovered: CapabilityRegistryAgent[];
}

const ACTION_OPTIONS = ["sign_text", "create_deal", "lock", "claim", "refund", "settle", "delegate", "transfer"];

export function VaultPanel() {
  const [agents, setAgents] = useState<AgentDidInfo[]>([]);
  const [delegations, setDelegations] = useState<DelegationInfo[]>([]);
  const [registry, setRegistry] = useState<CapabilityRegistryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registryBusy, setRegistryBusy] = useState<string | null>(null);
  const [policyQuery, setPolicyQuery] = useState<{ agent_id: string; action: string; policy?: string }>({ agent_id: "technocore-specialist", action: "settle" });
  const [policySaving, setPolicySaving] = useState(false);
  const [policySaved, setPolicySaved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [didData, delData, registryData] = await Promise.all([
        fetch("/api/agents/dids").then((r) => r.json()) as Promise<{ agents: AgentDidInfo[] }>,
        fetch("/api/delegations").then((r) => r.json()) as Promise<{ delegations: DelegationInfo[] }>,
        fetch("/api/capability-registry").then((r) => r.json()) as Promise<CapabilityRegistryState>,
      ]);
      setAgents(didData.agents);
      setDelegations(delData.delegations);
      setRegistry(registryData);
      const policyResp = await fetch("/api/signing-policy?agent_id=" + encodeURIComponent(policyQuery.agent_id) + "&action=" + encodeURIComponent(policyQuery.action));
      const policyData: { policy: string } = await policyResp.json();
      setPolicyQuery((prev) => ({ ...prev, policy: policyData.policy }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vault load failed");
    } finally {
      setLoading(false);
    }
  }, [policyQuery.agent_id, policyQuery.action]);

  useEffect(() => { void refresh(); }, []);

  const fetchPolicy = useCallback(async (agentId: string, action: string) => {
    try {
      const policyResp = await fetch("/api/signing-policy?agent_id=" + encodeURIComponent(agentId) + "&action=" + encodeURIComponent(action));
      const policyData: { policy: string } = await policyResp.json();
      setPolicyQuery((prev) => ({ ...prev, policy: policyData.policy }));
    } catch { /* ignore */ }
  }, []);

  // When agent/action changes, refetch current policy
  useEffect(() => { void fetchPolicy(policyQuery.agent_id, policyQuery.action); }, [policyQuery.agent_id, policyQuery.action, fetchPolicy]);

  const runRegistryAction = useCallback(async (action: "publish" | "scan") => {
    setRegistryBusy(action);
    setError(null);
    try {
      const resp = await fetch(action === "publish" ? "/api/capability-registry/publish" : "/api/capability-registry/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Capability registry action failed");
      setRegistry(data.registry || data);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Capability registry action failed");
    } finally {
      setRegistryBusy(null);
    }
  }, [refresh]);

  const savePolicy = useCallback(async () => {
    setPolicySaving(true);
    setPolicySaved(null);
    setError(null);
    try {
      const resp = await fetch("/api/signing-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: policyQuery.agent_id, action: policyQuery.action, policy: policyQuery.policy }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Failed to update signing policy");
      setPolicySaved(`Saved: ${policyQuery.agent_id} / ${policyQuery.action} → ${policyQuery.policy}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy save failed");
    } finally {
      setPolicySaving(false);
    }
  }, [policyQuery, refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading vault...</div>;

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

  const shortHash = (value?: string | null) => value ? `${value.slice(0, 10)}...${value.slice(-6)}` : "pending";
  const shortDid = (value?: string | null) => value ? `${value.slice(0, 16)}...${value.slice(-8)}` : "unknown";

  const registryCard = (agent: CapabilityRegistryAgent, local = false) => {
    const stale = agent.stale === true;
    const untrusted = !agent.verified;
    return (
      <div key={`${agent.node_id}-${agent.agent_id}-${agent.kv_path}`} style={{ display: "grid", gap: 8, padding: "10px 12px", border: "1px solid #1e2a45", borderRadius: 8, background: "rgba(15,23,42,0.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <strong style={{ color: local ? "#93c5fd" : "#7ee0c2", fontSize: 14 }}>{agent.name || agent.agent_id}</strong>
            <span style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 460, whiteSpace: "nowrap" }}>{agent.agent_id} · {shortDid(agent.did)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {local && <span style={badgeStyle("local")}>LOCAL</span>}
            {agent.verified && !stale && <span style={badgeStyle("verified")}>VERIFIED</span>}
            {stale && <span style={badgeStyle("stale")}>STALE</span>}
            {untrusted && <span style={badgeStyle("untrusted")}>UNTRUSTED</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, fontSize: 11, color: "#94a3b8" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>KV {agent.kv_path}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Hash {shortHash(agent.payload_hash)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Node {agent.node_id}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.provenance?.room ? `Seen #${agent.provenance.room}${agent.provenance.seq ? `:${agent.provenance.seq}` : ""}` : (agent.last_publish_status || agent.status)}</span>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {agent.capabilities.map((capability) => <span key={capability} style={{ padding: "2px 7px", borderRadius: 5, background: "#111827", color: "#cbd5e1", border: "1px solid #273453", fontSize: 10, fontWeight: 800 }}>{capability}</span>)}
        </div>
        {agent.rejection_reason && <div style={{ color: "#fca5a5", fontSize: 11 }}>Rejected: {agent.rejection_reason}</div>}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 14 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 28, padding: "0 10px", borderRadius: 5, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 13, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>🔐 Agent DIDs &amp; Capabilities</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>All configured agents and their published signing capabilities.</div>
        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          {agents.map((agent) => (
            <div key={agent.agent_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", border: "1px solid #1e2a45", borderRadius: 8 }}>
              <div style={{ display: "grid", gap: 3 }}>
                <strong style={{ color: "#93c5fd", fontSize: 14 }}>{agent.agent_id}</strong>
                <span style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360, wordBreak: "break-all" }} title={agent.did}>{agent.did}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ padding: "3px 10px", borderRadius: 999, background: agent.published ? "#1a3a2a" : "#1e1b2a", color: agent.published ? "#7ee0c2" : "#94a3b8", fontSize: 11, fontWeight: 800, border: `1px solid ${agent.published ? "#2a8c72" : "#475569"}` }}>{agent.published ? "PUBLISHED" : "UNPUBLISHED"}</span>
                <span style={{ color: "#94a3b8", fontSize: 11 }}>{agent.capabilities.join(", ")}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>Capability Registry</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {registry?.status.enabled ? `KV ${registry.status.kv_namespace} · ${registry.status.verified_count} verified · ${registry.status.rejected_count} untrusted` : "Local signed records; Technocore publish is disabled."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={registryBusy !== null} onClick={() => void runRegistryAction("publish")} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontWeight: 900, fontSize: 12, cursor: registryBusy ? "default" : "pointer" }}>{registryBusy === "publish" ? "Publishing..." : "Publish"}</button>
            <button type="button" disabled={registryBusy !== null} onClick={() => void runRegistryAction("scan")} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#93c5fd", fontWeight: 900, fontSize: 12, cursor: registryBusy ? "default" : "pointer" }}>{registryBusy === "scan" ? "Scanning..." : "Scan"}</button>
          </div>
        </div>
        {registry?.status.last_error && <div style={{ color: "#facc15", fontSize: 11, marginBottom: 8 }}>Scanner using cached projection: {registry.status.last_error}</div>}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900 }}>Local Agents</div>
            {(registry?.local || []).map((agent) => registryCard(agent, true))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900 }}>Discovered Agents</div>
            {(registry?.discovered || []).length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "6px 0" }}>No external capability records discovered yet.</div>
            ) : (registry?.discovered || []).map((agent) => registryCard(agent, false))}
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>📝 Signing Policy</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Control which actions require wallet approval (require-human) or are auto-authorized (signature-only).</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>Agent:</span>
          <select value={policyQuery.agent_id} onChange={(e) => setPolicyQuery((prev) => ({ ...prev, agent_id: e.target.value }))} style={{ height: 32, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 13, padding: "0 10px" }}>
            {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.agent_id}</option>)}
          </select>
          <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>Action:</span>
          <select value={policyQuery.action} onChange={(e) => setPolicyQuery((prev) => ({ ...prev, action: e.target.value }))} style={{ height: 32, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 13, padding: "0 10px" }}>
            {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" onClick={() => void refresh()} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#1e3a8a", color: "#93c5fd", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Query</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid " + (policyQuery.policy === "require-human" ? "#facc15" : "#7ee0c2"), background: "rgba(15,23,42,0.8)", fontSize: 14, fontWeight: 800 }}>
            Policy: <span style={{ color: policyQuery.policy === "require-human" ? "#facc15" : "#7ee0c2" }}>{policyQuery.policy || "—"}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={policyQuery.policy || "signature-only"}
              onChange={(e) => setPolicyQuery((prev) => ({ ...prev, policy: e.target.value as "signature-only" | "require-human" }))}
              style={{ height: 34, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 13, padding: "0 10px" }}
            >
              <option value="signature-only">signature-only</option>
              <option value="require-human">require-human</option>
            </select>
            <button
              type="button"
              disabled={policySaving}
              onClick={() => void savePolicy()}
              style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "1px solid #7ee0c2", background: policySaving ? "#12301f" : "#0e2a17", color: "#7ee0c2", fontWeight: 800, fontSize: 13, cursor: policySaving ? "default" : "pointer" }}
            >
              {policySaving ? "Saving…" : "Save Policy"}
            </button>
            {policySaved && <span style={{ color: "#7ee0c2", fontSize: 12, fontWeight: 700, padding: "4px 8px", borderRadius: 6, background: "#0a1f14" }}>✔ {policySaved}</span>}
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>🔗 Delegations</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Authorize one agent to act on another agent's behalf for specific actions.</div>
        {delegations.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 14, padding: "8px 0" }}>No delegations set up yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {delegations.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", border: "1px solid #1e2a45", borderRadius: 8 }}>
                <div style={{ fontWeight: 600 }}><strong style={{ color: "#93c5fd" }}>{d.from_agent}</strong> → <strong style={{ color: "#38bdf8" }}>{d.to_agent}</strong></div>
                <div style={{ color: "#94a3b8", fontSize: 12 }}>{d.scope} · {d.policy}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}