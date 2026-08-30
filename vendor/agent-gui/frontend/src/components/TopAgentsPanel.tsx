import type { TopAgent } from "../types";

interface Props {
  agents: TopAgent[];
  loading?: boolean;
  onRefresh: () => void;
  onCopy?: (sessionId: string) => void;
}

export function TopAgentsPanel({ agents, loading = false, onRefresh, onCopy }: Props) {
  const maxCopies = Math.max(1, ...agents.map((agent) => agent.copy_count));

  return (
    <div style={{
      flex: 1,
      overflow: "auto",
      background: "linear-gradient(180deg, #11182d 0%, #151126 52%, #0c1020 100%)",
      color: "var(--text)",
      padding: 18,
      boxSizing: "border-box",
    }}>
      <div style={{
        maxWidth: 1120,
        margin: "0 auto",
        display: "grid",
        gap: 12,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 38,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0 }}>Top100 AI Agents</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
              Ranked by Public copies
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid #2a3558",
              background: "#121828",
              color: loading ? "var(--text-dim)" : "var(--accent2)",
              cursor: loading ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {loading ? "Loading" : "Refresh"}
          </button>
        </div>

        {agents.length === 0 ? (
          <div style={{
            minHeight: 360,
            border: "1px dashed #2a3558",
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            color: "var(--text-dim)",
            fontSize: 13,
            textAlign: "center",
            padding: 24,
          }}>
            Share a Home agent to Public to start the chart.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {agents.map((agent) => {
              const pct = Math.max(4, Math.round((agent.copy_count / maxCopies) * 100));
              return (
                <div
                  key={agent.id}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    minHeight: 76,
                    borderRadius: 8,
                    border: "1px solid #273453",
                    background: "#101827",
                    boxShadow: agent.rank <= 3 ? "0 0 22px rgba(34,211,238,0.12)" : "none",
                  }}
                >
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, rgba(34,211,238,0.24), rgba(124,58,237,0.12))",
                  }} />
                  <div style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "58px minmax(0, 1fr) 120px 86px",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 76,
                    padding: "10px 12px",
                    boxSizing: "border-box",
                  }}>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 900,
                      color: agent.rank <= 3 ? "var(--accent2)" : "var(--text)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      #{agent.rank}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 800,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }} title={agent.title}>
                        {agent.title}
                      </div>
                      <div style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }} title={agent.summary}>
                        {agent.agent} - {agent.model}
                      </div>
                    </div>
                    <div style={{
                      justifySelf: "end",
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--text)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {agent.copy_count} copies
                    </div>
                    <button
                      type="button"
                      onClick={() => onCopy?.(agent.id)}
                      disabled={!onCopy}
                      style={{
                        height: 30,
                        borderRadius: 6,
                        border: "1px solid var(--card-border)",
                        background: "var(--accent2)",
                        color: "white",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: onCopy ? "pointer" : "default",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
