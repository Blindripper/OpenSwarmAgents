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

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading trust data…</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 11 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 10, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Evidence Summary</div>
        {summary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, fontSize: 11 }}>
            {[
              { label: "Total Deals", value: summary.total_deals },
              { label: "Completed", value: summary.completed_deals, color: "#7ee0c2" },
              { label: "Refunded", value: summary.refunded_deals, color: "#facc15" },
              { label: "Unique Counterparties", value: summary.unique_counterparties },
              { label: "Verified Results", value: summary.verified_results, color: "#93c5fd" },
              { label: "Completion Rate", value: summary.completion_rate, color: summary.completion_rate !== "0%" ? "#7ee0c2" : "#94a3b8" },
            ].map((metric) => (
              <div key={metric.label} style={{ padding: "8px 10px", border: "1px solid #1e2a45", borderRadius: 6, textAlign: "center" }}>
                <div style={{ color: metric.color || "#cbd5e1", fontSize: 16, fontWeight: 900 }}>{metric.value}</div>
                <div style={{ color: "#94a3b8", fontSize: 9, marginTop: 3 }}>{metric.label}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No evidence data yet. Deals, results, and counterparties appear here after activity.</div>}
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Top Builders</div>
        {topBuilders.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No verified result submissions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
            {topBuilders.map((builder, idx) => (
              <div key={builder.agent_id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
                <span><strong style={{ color: "#93c5fd" }}>#{idx + 1}</strong> {builder.agent_id}</span>
                <span style={{ color: "#7ee0c2", fontWeight: 800 }}>{builder.verified_results} verified</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
