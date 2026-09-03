import { useCallback, useEffect, useState } from "react";

interface AgentDidInfo {
  agent_id: string;
  did: string;
  capabilities: string[];
  published: boolean;
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

const ACTION_OPTIONS = ["sign_text", "create_deal", "lock", "claim", "refund", "settle", "delegate", "transfer"];

export function VaultPanel() {
  const [agents, setAgents] = useState<AgentDidInfo[]>([]);
  const [delegations, setDelegations] = useState<DelegationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyQuery, setPolicyQuery] = useState<{ agent_id: string; action: string; policy?: string }>({ agent_id: "technocore-specialist", action: "settle" });
  const [policySaving, setPolicySaving] = useState(false);
  const [policySaved, setPolicySaved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [didData, delData] = await Promise.all([
        fetch("/api/agents/dids").then((r) => r.json()) as Promise<{ agents: AgentDidInfo[] }>,
        fetch("/api/delegations").then((r) => r.json()) as Promise<{ delegations: DelegationInfo[] }>,
      ]);
      setAgents(didData.agents);
      setDelegations(delData.delegations);
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

  useEffect(() => {
    // When agent/action changes, refetch the current policy for that combo
    void (async () => {
      try {
        const policyResp = await fetch("/api/signing-policy?agent_id=" + encodeURIComponent(policyQuery.agent_id) + "&action=" + encodeURIComponent(policyQuery.action));
        const policyData: { policy: string } = await policyResp.json();
        setPolicyQuery((prev) => ({ ...prev, policy: policyData.policy }));
      } catch { /* ignore */ }
    })();
  }, [policyQuery.agent_id, policyQuery.action]);

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

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading vault…</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 11 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 10, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Agent DIDs &amp; Capabilities</div>
        <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
          {agents.map((agent) => (
            <div key={agent.agent_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ color: "#93c5fd" }}>{agent.agent_id}</strong>
                <span style={{ color: "#64748b", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }} title={agent.did}>{agent.did}</span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ padding: "2px 6px", borderRadius: 999, background: agent.published ? "#1a3a2a" : "#1e1b2a", color: agent.published ? "#7ee0c2" : "#94a3b8", fontSize: 8, fontWeight: 800 }}>{agent.published ? "PUBLISHED" : "UNPUBLISHED"}</span>
                <span style={{ color: "#94a3b8", fontSize: 9 }}>{agent.capabilities.join(", ")}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Signing Policy</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>Agent:</span>
          <select value={policyQuery.agent_id} onChange={(e) => setPolicyQuery((prev) => ({ ...prev, agent_id: e.target.value }))} style={{ height: 28, borderRadius: 5, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 10, padding: "0 6px" }}>
            {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.agent_id}</option>)}
          </select>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>Action:</span>
          <select value={policyQuery.action} onChange={(e) => setPolicyQuery((prev) => ({ ...prev, action: e.target.value }))} style={{ height: 28, borderRadius: 5, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 10, padding: "0 6px" }}>
            {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" onClick={() => void refresh()} style={{ height: 28, padding: "0 10px", borderRadius: 5, border: "1px solid #2563eb", background: "#1e3a8a", color: "#93c5fd", fontWeight: 800, fontSize: 10, cursor: "pointer" }}>Query</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid " + (policyQuery.policy === "require-human" ? "#facc15" : "#7ee0c2"), background: "rgba(15,23,42,0.8)", fontSize: 11, fontWeight: 800 }}>
            Policy: <span style={{ color: policyQuery.policy === "require-human" ? "#facc15" : "#7ee0c2" }}>{policyQuery.policy || "—"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={policyQuery.policy || "signature-only"}
              onChange={(e) => setPolicyQuery((prev) => ({ ...prev, policy: e.target.value as "signature-only" | "require-human" }))}
              style={{ height: 30, borderRadius: 5, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 11, padding: "0 8px" }}
            >
              <option value="signature-only">signature-only</option>
              <option value="require-human">require-human</option>
            </select>
            <button
              type="button"
              disabled={policySaving}
              onClick={() => void savePolicy()}
              style={{ height: 30, padding: "0 14px", borderRadius: 5, border: "1px solid #7ee0c2", background: policySaving ? "#12301f" : "#0e2a17", color: "#7ee0c2", fontWeight: 800, fontSize: 11, cursor: policySaving ? "default" : "pointer" }}
            >
              {policySaving ? "Saving…" : "Save Policy"}
            </button>
            {policySaved && <span style={{ color: "#7ee0c2", fontSize: 10, fontWeight: 700 }}>✔ {policySaved}</span>}
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Delegations</div>
        {delegations.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No delegations set up yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 5, fontSize: 11 }}>
            {delegations.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
                <div><strong>{d.from_agent}</strong> → <strong>{d.to_agent}</strong></div>
                <div style={{ color: "#94a3b8", fontSize: 9 }}>{d.scope} · {d.policy}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}