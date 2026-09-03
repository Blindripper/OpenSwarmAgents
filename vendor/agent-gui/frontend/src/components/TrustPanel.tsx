import { useCallback, useEffect, useState } from "react";

interface TrustSummary {
  total_jobs: number;
  total_results: number;
  verified_results: number;
  unique_counterparties: number;
  total_deals: number;
  completed_deals: number;
  refunded_deals: number;
  completion_rate: string;
}

interface TopBuilder {
  agent_id: string;
  verified_results: number;
  source?: string;
}

export function TrustPanel() {
  const [summary, setSummary] = useState<TrustSummary | null>(null);
  const [topBuilders, setTopBuilders] = useState<TopBuilder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch("/api/trust").then((r) => r.json());
      setSummary(data.summary || null);
      setTopBuilders(data.top_builders || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Trust load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading trust data…</div>;

  const federatedCount = topBuilders.filter((b) => b.source === "federated").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 13 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 12, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>📊 Evidence Summary</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>On-chain deals, verified results, and cross-node trust metrics.</div>
        {summary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 12 }}>
            {[
              { label: "Total Deals", value: summary.total_deals },
              { label: "Completed", value: summary.completed_deals, color: "#7ee0c2" },
              { label: "Refunded", value: summary.refunded_deals, color: "#facc15" },
              { label: "Unique Counterparties", value: summary.unique_counterparties },
              { label: "Verified Results", value: summary.verified_results, color: "#93c5fd" },
              { label: "Completion Rate", value: summary.completion_rate, color: summary.completion_rate !== "0%" ? "#7ee0c2" : "#94a3b8" },
            ].map((metric) => (
              <div key={metric.label} style={{ padding: "10px 12px", border: "1px solid #1e2a45", borderRadius: 8, textAlign: "center" }}>
                <div style={{ color: metric.color || "#cbd5e1", fontSize: 20, fontWeight: 900 }}>{metric.value}</div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>{metric.label}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 0" }}>No evidence data yet. Deals, results, and counterparties appear here after activity.</div>}
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>🏆 Top Builders</div>
          {federatedCount > 0 && <span style={{ padding: "3px 10px", borderRadius: 999, background: "#1a1e3a", color: "#a5b4fc", fontSize: 12, fontWeight: 800, border: "1px solid #3d4a8c" }}>🌐 {federatedCount} federated</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Agents ranked by verified results — local + cross-node federation.</div>
        {topBuilders.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 0" }}>No verified result submissions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {topBuilders.map((builder, idx) => (
              <div key={`${builder.agent_id}-${builder.source || "local"}`} style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                padding: "10px 14px",
                border: "1px solid #1e2a45",
                borderRadius: 8,
                background: idx < 3 ? "linear-gradient(90deg, rgba(34,211,238,0.06), transparent)" : "transparent",
              }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 6,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: idx === 0 ? "#facc15" : idx === 1 ? "#94a3b8" : idx === 2 ? "#a78bfa" : "#1e2a45",
                    color: idx < 3 ? "#0f1626" : "#94a3b8",
                    fontSize: 13,
                    fontWeight: 900,
                  }}>#{idx + 1}</span>
                  {builder.agent_id}
                  {builder.source === "federated" && <span title="Shared by another OSA node via osa-network" style={{ color: "#a5b4fc", fontSize: 10, fontWeight: 800 }}>🌐</span>}
                </span>
                <span style={{ color: "#7ee0c2", fontWeight: 800, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{builder.verified_results} verified</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}