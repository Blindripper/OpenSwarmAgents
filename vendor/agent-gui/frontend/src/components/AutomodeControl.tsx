import { useState } from "react";
import type { AutomodeState, AutomodeEntry } from "../useAutomode";

const stateColors: Record<string, { bg: string; color: string; border: string; label: string }> = {
  scanning: { bg: "#0f2131", color: "#38bdf8", border: "#1e6091", label: "SCANNING" },
  matched: { bg: "#1f3010", color: "#a3e635", border: "#558520", label: "MATCHED" },
  accepted: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "ACCEPTED" },
  executing: { bg: "#241f10", color: "#facc15", border: "#7a6420", label: "EXECUTING" },
  completing: { bg: "#151a2e", color: "#a5b4fc", border: "#3d4a8c", label: "WRAPPING UP" },
  completed: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "DONE" },
  failed: { bg: "#2a1015", color: "#fca5a5", border: "#7f1d1d", label: "FAILED" },
};

export function pipelineStages(status: AutomodeEntry["status"]): { label: string; done: boolean; info?: string }[] {
  const done = ["accepted", "executing", "completing", "completed", "failed"];
  const workDone = ["completing", "completed", "failed"];
  const resultDone = ["completed", "failed"];
  return [
    { label: "Claimed", done: done.includes(status) },
    { label: "Work done", done: workDone.includes(status) },
    { label: "Result in", done: resultDone.includes(status) },
    { label: "Reward", done: false, info: "TCLK deal + FLOP mainnet required" },
  ];
}

function Pipeline({ status }: { status: AutomodeEntry["status"] }) {
  const stages = pipelineStages(status);
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
      {stages.map((s, i) => (
        <span key={i} style={{
          fontSize: 9, fontWeight: 900, whiteSpace: "nowrap",
          padding: "2px 6px", borderRadius: 4,
          background: s.done ? "#10251f" : "#121828",
          color: s.done ? "#7ee0c2" : "#64748b",
          border: `1px solid ${s.done ? "#2a8c72" : "#2a3558"}`,
        }}>
          {s.done ? "✓ " : "○ "}{s.label}
          {s.info && <span title={s.info} style={{ fontSize: 8, opacity: 0.6, marginLeft: 2 }}>ⓘ</span>}
        </span>
      ))}
    </div>
  );
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
  const entry = automodeState.current;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Agent name + status row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <strong style={{ fontSize: 12, color: "#e2e8f0" }}>{agentId || "Agent"}</strong>
          {entry && (
            <span style={{
              height: 18, padding: "0 5px", borderRadius: 4,
              fontSize: 9, fontWeight: 900, whiteSpace: "nowrap",
              background: stateColors[entry.status]?.bg || "#121828",
              color: stateColors[entry.status]?.color || "#cbd5e1",
              border: `1px solid ${stateColors[entry.status]?.border || "#2a3558"}`,
            }}>
              {stateColors[entry.status]?.label || entry.status.toUpperCase()}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={automodeState.running ? onStop : onStart}
          style={{
            height: 26, padding: "0 9px", borderRadius: 5,
            border: `1px solid ${automodeState.running ? "#7f1d1d" : "#2a8c72"}`,
            background: automodeState.running ? "#2a1015" : "#10251f",
            color: automodeState.running ? "#fca5a5" : "#7ee0c2",
            fontSize: 10, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {automodeState.running ? "⏹ Stop" : "▶ Start"}
        </button>
      </div>

      {/* Current entry */}
      {entry && (
        <>
          <Pipeline status={entry.status} />
          <div style={{
            border: "1px solid #1e2a45", borderRadius: 6,
            background: "#09111e", padding: 8,
            display: "grid", gap: 4,
            maxHeight: showLog ? 200 : 80, overflow: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.jobTitle || entry.jobId}
              </span>
              <button type="button" onClick={() => setShowLog(!showLog)}
                style={{ fontSize: 9, fontWeight: 900, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>
                {showLog ? "▲ less" : "▼ more"}
              </button>
            </div>
            <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.5 }}>
              {showLog
                ? entry.activityLog.map((l, i) => <div key={i} style={{ padding: "1px 0" }}>{l}</div>)
                : entry.activityLog.slice(-2).map((l, i) => <div key={i} style={{ padding: "1px 0" }}>{l}</div>)}
            </div>
            {entry.resultDetail && (
              <div style={{ fontSize: 9, color: "#64748b", lineHeight: 1.4, marginTop: 2, maxHeight: 60, overflow: "hidden" }}>
                <strong>Agent output:</strong> {entry.resultDetail.slice(0, 150)}
              </div>
            )}
          </div>
        </>
      )}

      {/* Idle indicator */}
      {automodeState.running && !entry && (
        <div style={{ color: "#38bdf8", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
          Idle — scanning every 30s
        </div>
      )}

      {/* Stats */}
      {automodeState.history.length > 0 && (
        <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 8 }}>
          <span>{automodeState.history.length} job(s)</span>
          <span style={{ color: "#7ee0c2" }}>✓ {automodeState.history.filter((e) => e.status === "completed").length}</span>
          <span style={{ color: "#fca5a5" }}>✗ {automodeState.history.filter((e) => e.status === "failed").length}</span>
        </div>
      )}
    </div>
  );
}