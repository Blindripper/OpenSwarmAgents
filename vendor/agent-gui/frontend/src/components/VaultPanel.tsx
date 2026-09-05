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
  delegation_id?: string;
  from_agent: string;
  to_agent: string;
  delegator_did?: string;
  delegatee_did?: string;
  scopes?: string[];
  capabilities?: string[];
  scope: string;
  policy: string;
  state: "draft" | "active" | "revoked" | "expired" | "untrusted";
  revision?: number;
  created_at: string;
  issued_at?: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  kv_path?: string | null;
  payload_hash?: string | null;
  verified?: boolean;
  stale?: boolean;
  rejection_reason?: string | null;
  last_publish_status?: string | null;
  last_publish_error?: string | null;
  authority?: "local_note_only" | "informational_only" | string;
  provenance?: { room?: string | null; seq?: number | null; from?: string | null; announced_at?: string | null } | null;
}

interface DelegationNotesState {
  schema: string;
  status: {
    enabled: boolean;
    room: string;
    kv_namespace: string;
    allowed_scopes: string[];
    allowed_capabilities: string[];
    last_scan_status?: string | null;
    last_error?: string | null;
    verified_count: number;
    rejected_count: number;
  };
  delegations: DelegationInfo[];
  local: DelegationInfo[];
  discovered: DelegationInfo[];
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
const DELEGATION_SCOPES = ["coordination", "work_request", "result_delivery", "review", "paperrail_no_value"];
const DELEGATION_CAPABILITIES = ["request_work", "submit_result", "attest_result", "claim", "receipt", "research", "review", "synthesis", "coding", "testing"];

export function VaultPanel() {
  const [agents, setAgents] = useState<AgentDidInfo[]>([]);
  const [delegationNotes, setDelegationNotes] = useState<DelegationNotesState | null>(null);
  const [registry, setRegistry] = useState<CapabilityRegistryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registryBusy, setRegistryBusy] = useState<string | null>(null);
  const [policyQuery, setPolicyQuery] = useState<{ agent_id: string; action: string; policy?: string }>({ agent_id: "technocore-specialist", action: "settle" });
  const [policySaving, setPolicySaving] = useState(false);
  const [policySaved, setPolicySaved] = useState<string | null>(null);
  const [delegationBusy, setDelegationBusy] = useState<string | null>(null);
  const [pendingDelegationAction, setPendingDelegationAction] = useState<{ id: string; action: "publish" | "revoke" } | null>(null);
  const [delegationForm, setDelegationForm] = useState({
    from_agent: "technocore-specialist",
    to_agent: "coder",
    scopes: ["coordination"],
    capabilities: ["request_work"],
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [didData, delData, registryData] = await Promise.all([
        fetch("/api/agents/dids").then((r) => r.json()) as Promise<{ agents: AgentDidInfo[] }>,
        fetch("/api/delegations").then((r) => r.json()) as Promise<DelegationNotesState>,
        fetch("/api/capability-registry").then((r) => r.json()) as Promise<CapabilityRegistryState>,
      ]);
      setAgents(didData.agents);
      setDelegationNotes(delData);
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

  const toggleDelegationValue = useCallback((kind: "scopes" | "capabilities", value: string) => {
    setDelegationForm((current) => {
      const values = current[kind];
      return { ...current, [kind]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
  }, []);

  const createDelegation = useCallback(async () => {
    setDelegationBusy("create");
    setError(null);
    try {
      const resp = await fetch("/api/delegations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...delegationForm, expires_at: new Date(delegationForm.expires_at).toISOString(), confirmation: "create-delegation" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Delegation draft creation failed");
      setDelegationNotes(data.delegation_notes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delegation draft creation failed");
    } finally {
      setDelegationBusy(null);
    }
  }, [delegationForm]);

  const runDelegationAction = useCallback(async (id: string, action: "publish" | "revoke") => {
    const key = `${action}:${id}`;
    setDelegationBusy(key);
    setError(null);
    try {
      const resp = await fetch(`/api/delegations/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: action === "publish" ? "publish-delegation" : "revoke-delegation" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || `Delegation ${action} failed`);
      setDelegationNotes(data.delegation_notes);
      setPendingDelegationAction(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Delegation ${action} failed`);
    } finally {
      setDelegationBusy(null);
    }
  }, []);

  const scanDelegations = useCallback(async () => {
    setDelegationBusy("scan");
    setError(null);
    try {
      const resp = await fetch("/api/delegations/scan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Delegation scan failed");
      setDelegationNotes(data.delegation_notes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delegation scan failed");
    } finally {
      setDelegationBusy(null);
    }
  }, []);

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

  const delegationCard = (delegation: DelegationInfo, local = false) => {
    const id = delegation.id || delegation.delegation_id || "delegation";
    const stale = delegation.stale === true;
    const untrusted = !local && delegation.verified !== true;
    const active = delegation.state === "active" && !stale && !untrusted;
    return (
      <div key={`${local ? "local" : "remote"}-${id}`} data-testid={`delegation-${local ? "local" : "remote"}`} style={{ display: "grid", gap: 8, padding: "10px 12px", border: "1px solid #1e2a45", borderRadius: 8, background: "rgba(15,23,42,0.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}><strong style={{ color: "#93c5fd" }}>{delegation.from_agent}</strong> → <strong style={{ color: "#38bdf8" }}>{delegation.to_agent}</strong></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {local && <span style={badgeStyle("local")}>LOCAL NOTE</span>}
            {active && <span style={badgeStyle("verified")}>{local ? "VERIFIED" : "SIGNATURE VERIFIED"}</span>}
            {delegation.state === "draft" && <span style={badgeStyle("local")}>DRAFT · NOT PUBLIC</span>}
            {delegation.state === "revoked" && <span style={badgeStyle("untrusted")}>REVOKED</span>}
            {delegation.state === "expired" && <span style={badgeStyle("stale")}>EXPIRED</span>}
            {stale && <span style={badgeStyle("stale")}>STALE</span>}
            {untrusted && <span style={badgeStyle("untrusted")}>UNTRUSTED</span>}
          </div>
        </div>
        <div style={{ color: "#94a3b8", fontSize: 11 }}>Scopes: {(delegation.scopes || [delegation.scope]).join(", ")} · Capabilities: {(delegation.capabilities || []).join(", ") || "none"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 6, color: "#64748b", fontSize: 10 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>KV {delegation.kv_path || "local draft"}</span>
          <span>Revision {delegation.revision || 0} · expires {delegation.expires_at ? new Date(delegation.expires_at).toLocaleString() : "unspecified"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Delegator {shortDid(delegation.delegator_did)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{delegation.provenance?.room ? `Seen #${delegation.provenance.room}${delegation.provenance.seq ? `:${delegation.provenance.seq}` : ""}` : `Hash ${shortHash(delegation.payload_hash)}`}</span>
        </div>
        <div style={{ color: local ? "#93c5fd" : "#facc15", fontSize: 10, fontWeight: 800 }}>
          {local ? "LOCAL NOTE ONLY · managed delegate signing remains human-required" : "INFORMATIONAL ONLY · grants no authority or execution rights"}
        </div>
        {(delegation.rejection_reason || delegation.last_publish_error) && <div style={{ color: "#fca5a5", fontSize: 11 }}>Rejected: {delegation.rejection_reason || delegation.last_publish_error}</div>}
        {local && delegation.state === "draft" && (
          pendingDelegationAction?.id === id && pendingDelegationAction.action === "publish" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#facc15", fontSize: 11 }}>This publishes a dual-signed public KV note and room pointer. It does not grant runtime authority.</span>
              <button type="button" disabled={delegationBusy !== null} onClick={() => void runDelegationAction(id, "publish")} style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid #facc15", background: "#2a210e", color: "#facc15", fontWeight: 900, cursor: "pointer" }}>Confirm publish</button>
              <button type="button" onClick={() => setPendingDelegationAction(null)} style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", cursor: "pointer" }}>Cancel</button>
            </div>
          ) : <button type="button" disabled={delegationBusy !== null} onClick={() => setPendingDelegationAction({ id, action: "publish" })} style={{ justifySelf: "start", height: 30, padding: "0 11px", borderRadius: 6, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontWeight: 900, cursor: "pointer" }}>Publish note</button>
        )}
        {local && delegation.state === "active" && (
          pendingDelegationAction?.id === id && pendingDelegationAction.action === "revoke" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#fca5a5", fontSize: 11 }}>Revocation publishes a superseding signed revision and cannot reactivate this note.</span>
              <button type="button" disabled={delegationBusy !== null} onClick={() => void runDelegationAction(id, "revoke")} style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid #ef4444", background: "#2a1010", color: "#fca5a5", fontWeight: 900, cursor: "pointer" }}>Confirm revoke</button>
              <button type="button" onClick={() => setPendingDelegationAction(null)} style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", cursor: "pointer" }}>Cancel</button>
            </div>
          ) : <button type="button" disabled={delegationBusy !== null} onClick={() => setPendingDelegationAction({ id, action: "revoke" })} style={{ justifySelf: "start", height: 30, padding: "0 11px", borderRadius: 6, border: "1px solid #ef4444", background: "#2a1010", color: "#fca5a5", fontWeight: 900, cursor: "pointer" }}>Revoke note</button>
        )}
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
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>🔗 Delegation Notes</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              Versioned <code>osa-delegation-note/1</code> KV claims. Remote notes are informational only and never grant authority or execution rights.
            </div>
          </div>
          <button type="button" disabled={delegationBusy !== null} onClick={() => void scanDelegations()} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#93c5fd", fontWeight: 900, fontSize: 12, cursor: "pointer" }}>{delegationBusy === "scan" ? "Scanning..." : "Scan notes"}</button>
        </div>
        <div style={{ padding: "9px 11px", marginBottom: 12, borderRadius: 7, border: "1px solid #a16207", background: "#2a210e", color: "#fde68a", fontSize: 11, lineHeight: 1.5 }}>
          Publishing and revoking are explicit authenticated human actions. The managed <code>delegate</code> action stays <strong>require-human</strong>. Public records contain only bounded public metadata and no private signing material.
        </div>
        {delegationNotes?.status.last_error && <div style={{ color: "#facc15", fontSize: 11, marginBottom: 8 }}>Scanner using cached projection: {delegationNotes.status.last_error}</div>}

        <div style={{ display: "grid", gap: 10, padding: 12, marginBottom: 14, border: "1px solid #1e2a45", borderRadius: 8, background: "rgba(15,23,42,0.5)" }}>
          <strong style={{ color: "#cbd5e1", fontSize: 13 }}>Create a local draft</strong>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4, color: "#94a3b8", fontSize: 11 }}>Delegator
              <select aria-label="Delegator" value={delegationForm.from_agent} onChange={(event) => setDelegationForm((current) => ({ ...current, from_agent: event.target.value }))} style={{ height: 32, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", padding: "0 8px" }}>
                {agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.agent_id}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, color: "#94a3b8", fontSize: 11 }}>Delegatee
              <select aria-label="Delegatee" value={delegationForm.to_agent} onChange={(event) => setDelegationForm((current) => ({ ...current, to_agent: event.target.value }))} style={{ height: 32, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", padding: "0 8px" }}>
                {agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.agent_id}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, color: "#94a3b8", fontSize: 11 }}>Expires
              <input aria-label="Delegation expiry" type="datetime-local" value={delegationForm.expires_at} onChange={(event) => setDelegationForm((current) => ({ ...current, expires_at: event.target.value }))} style={{ height: 30, borderRadius: 6, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", padding: "0 8px" }} />
            </label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Bounded scopes</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{DELEGATION_SCOPES.map((scope) => <label key={scope} style={{ color: "#cbd5e1", fontSize: 10 }}><input type="checkbox" checked={delegationForm.scopes.includes(scope)} onChange={() => toggleDelegationValue("scopes", scope)} /> {scope}</label>)}</div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Bounded capabilities</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{DELEGATION_CAPABILITIES.map((capability) => <label key={capability} style={{ color: "#cbd5e1", fontSize: 10 }}><input type="checkbox" checked={delegationForm.capabilities.includes(capability)} onChange={() => toggleDelegationValue("capabilities", capability)} /> {capability}</label>)}</div>
          </fieldset>
          <button type="button" disabled={delegationBusy !== null || delegationForm.from_agent === delegationForm.to_agent || delegationForm.scopes.length === 0} onClick={() => void createDelegation()} style={{ justifySelf: "start", height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #7ee0c2", background: "#0e2a17", color: "#7ee0c2", fontWeight: 900, cursor: "pointer" }}>{delegationBusy === "create" ? "Creating..." : "Create local draft"}</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900 }}>Local notes</div>
            {(delegationNotes?.local || []).length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 13 }}>No local delegation notes yet.</div> : (delegationNotes?.local || []).map((delegation) => delegationCard(delegation, true))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900 }}>Federated notes · {delegationNotes?.status.verified_count || 0} verified · {delegationNotes?.status.rejected_count || 0} untrusted</div>
            {(delegationNotes?.discovered || []).length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 13 }}>No federated delegation notes discovered yet.</div> : (delegationNotes?.discovered || []).map((delegation) => delegationCard(delegation, false))}
          </div>
        </div>
      </section>
    </div>
  );
}