import { useCallback, useState } from "react";
import type { AutomodeState, AutomodeEntry } from "../useAutomode";

const badgeColor = (status: string) => {
  switch (status) {
    case "scanning": return { bg: "#0f2131", color: "#38bdf8", border: "#1e6091", label: "SCANNING" };
    case "matched": return { bg: "#1f3010", color: "#a3e635", border: "#558520", label: "MATCHED" };
    case "accepted": return { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "ACCEPTED" };
    case "executing": return { bg: "#241f10", color: "#facc15", border: "#7a6420", label: "EXECUTING" };
    case "completing": return { bg: "#151a2e", color: "#a5b4fc", border: "#3d4a8c", label: "WRAPPING UP" };
    case "completed": return { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "DONE" };
    case "failed": return { bg: "#2a1015", color: "#fca5a5", border: "#7f1d1d", label: "FAILED" };
    default: return { bg: "#121828", color: "#cbd5e1", border: "#2a3558", label: status.toUpperCase() };
  }
};

function statusDot(entry: AutomodeEntry): string {
  switch (entry.status) {
    case "executing": return "🔄";
    case "completed": return "✅";
    case "failed": return "❌";
    case "scanning": return "🔍";
    case "accepted": return "📋";
    case "completing": return "🏁";
    default: return "⏳";
  }
}

export function AutomodeControl({
  automodeState,
  onStart,
  onStop,
  agentId,
}: {
  automodeState: AutomodeState;
  onStart: () => void;
  onStop: () => void;
  agentId?: string;
}) {
  const [showLog, setShowLog] = useState(false);

  return (
    <div style={{
      border: `1px solid ${automodeState.running ? "rgba(126, 224, 194, .52)" : "rgba(71, 85, 105, .58)"}`,
      borderRadius: 8,
      background: automodeState.running ? "rgba(16, 37, 31, .94)" : "rgba(15, 23, 42, .78)",
      padding: 10,
      display: "grid",
      gap: 8,
      minWidth: 260,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 950, color: automodeState.running ? "#7ee0c2" : "#cbd5e1" }}>
            {automodeState.running ? "🤖 Automode ON" : "🤖 Automode"}
          </span>
          {automodeState.current && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              height: 20, padding: "0 6px", borderRadius: 4,
              fontSize: 9, fontWeight: 900,
              background: badgeColor(automodeState.current.status).bg,
              color: badgeColor(automodeState.current.status).color,
              border: `1px solid ${badgeColor(automodeState.current.status).border}`,
            }}>
              {badgeColor(automodeState.current.status).label}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {!automodeState.running ? (
            <button
              type="button"
              onClick={onStart}
              title="Start autonomous job hunting on Technocore"
              style={{
                height: 28, padding: "0 10px", borderRadius: 6,
                border: "1px solid #2a8c72", background: "#10251f",
                color: "#7ee0c2", fontSize: 11, fontWeight: 900,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              ▶ Start
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              title="Stop autonomous mode"
              style={{
                height: 28, padding: "0 10px", borderRadius: 6,
                border: "1px solid #7f1d1d", background: "#2a1015",
                color: "#fca5a5", fontSize: 11, fontWeight: 900,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {/* Current activity */}
      {automodeState.current && (
        <div style={{
          border: "1px solid #1e2a45", borderRadius: 6,
          background: "#09111e", padding: 8,
          display: "grid", gap: 4,
          maxHeight: showLog ? 200 : 80,
          overflow: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
            <strong style={{ fontSize: 11, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {statusDot(automodeState.current)} {automodeState.current.jobTitle}
            </strong>
            <button
              type="button"
              onClick={() => setShowLog(!showLog)}
              style={{
                fontSize: 9, fontWeight: 900, color: "#94a3b8",
                background: "none", border: "none", cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {showLog ? "▲ less" : "▼ more"}
            </button>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.5 }}>
            {showLog
              ? automodeState.current.activityLog.map((line, i) => (
                  <div key={i} style={{ padding: "1px 0" }}>{line}</div>
                ))
              : automodeState.current.activityLog.slice(-2).map((line, i) => (
                  <div key={i} style={{ padding: "1px 0" }}>{line}</div>
                ))}
          </div>
        </div>
      )}

      {/* Running indicator */}
      {automodeState.running && !automodeState.current && (
        <div style={{ color: "#38bdf8", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
          Idle — next scan in 30s
        </div>
      )}

      {/* Quick stats */}
      {automodeState.history.length > 0 && (
        <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 8 }}>
          <span>📊 {automodeState.history.length} job(s)</span>
          <span>✅ {automodeState.history.filter((e) => e.status === "completed").length} completed</span>
          <span>❌ {automodeState.history.filter((e) => e.status === "failed").length} failed</span>
        </div>
      )}
    </div>
  );
}

export function AutomodeHistoryView({ history, onClear }: { history: AutomodeEntry[]; onClear?: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div style={{
        border: "1px dashed #2a3558", borderRadius: 8, padding: 20,
        textAlign: "center", color: "#94a3b8", fontSize: 12,
      }}>
        No completed automode jobs yet. Start Automode on a desk to see results here.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14, color: "#e2e8f0" }}>Automode Job History</strong>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              height: 26, padding: "0 8px", borderRadius: 5,
              border: "1px solid #7f1d1d", background: "#2a1015",
              color: "#fca5a5", fontSize: 10, fontWeight: 900, cursor: "pointer",
            }}
          >
            Clear history
          </button>
        )}
      </div>
      {history.map((entry) => {
        const badge = badgeColor(entry.status);
        const expanded = expandedId === entry.id;
        return (
          <div
            key={entry.id}
            style={{
              border: `1px solid ${entry.status === "completed" ? "#2a8c72" : "#2a3558"}`,
              borderRadius: 8, padding: 10,
              background: entry.status === "completed" ? "rgba(16,37,31,.92)" : "#101827",
              display: "grid", gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 12, color: "#e2e8f0" }}>{statusDot(entry)} {entry.jobTitle}</strong>
                  <span style={{
                    height: 18, padding: "0 5px", borderRadius: 4,
                    fontSize: 9, fontWeight: 900,
                    background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                  }}>
                    {badge.label}
                  </span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>#{entry.jobRoom}</span>
                </div>
                {entry.resultSummary && <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{entry.resultSummary}</div>}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  style={{
                    height: 24, padding: "0 6px", borderRadius: 4,
                    border: "1px solid #2a3558", background: "#121828",
                    color: "#cbd5e1", fontSize: 9, fontWeight: 900, cursor: "pointer",
                  }}
                >
                  {expanded ? "▲" : "▼"} Log
                </button>
              </div>
            </div>

            {entry.claimId && <div style={{ color: "#64748b", fontSize: 10 }}>Claim: {entry.claimId}</div>}
            {entry.sessionId && <div style={{ color: "#64748b", fontSize: 10 }}>Session: {entry.sessionId}</div>}
            <div style={{ color: "#64748b", fontSize: 10 }}>
              {new Date(entry.startedAt).toLocaleString()} → {entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "ongoing"}
            </div>

            {expanded && entry.activityLog.length > 0 && (
              <div style={{
                border: "1px solid #1e2a45", borderRadius: 6,
                background: "#09111e", padding: 8, maxHeight: 200, overflow: "auto",
                fontSize: 10, color: "#94a3b8", lineHeight: 1.6,
              }}>
                {entry.activityLog.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}