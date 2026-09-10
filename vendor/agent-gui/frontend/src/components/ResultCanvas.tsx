import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { ActivityEvent } from "../types";
import type { AutomodeEntry } from "../useAutomode";

interface Props {
  open: boolean;
  autoModeHistory?: AutomodeEntry[];
  autoModeRunning?: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyStyle: React.CSSProperties = {
  border: "1px dashed #2a3558",
  borderRadius: 8,
  padding: 20,
  textAlign: "center",
  color: "#94a3b8",
  fontSize: 12,
};

const panelStyle: React.CSSProperties = {
  width: 340,
  minWidth: 300,
  maxWidth: "42vw",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid #273453",
  background: "rgba(9, 15, 26, 0.98)",
  color: "#cbd5e1",
  fontSize: 12,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid #273453",
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 950,
  color: "#e2e8f0",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#64748b",
  marginTop: 2,
};

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "1px solid #2a3558",
  background: "#121828",
  color: "#94a3b8",
  fontSize: 13,
  cursor: "pointer",
};

function stripAnsi(s: string): string {
  return s.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function ResultCanvas({
  open,
  autoModeHistory = [],
  autoModeRunning = false,
  onOpenChange,
}: Props) {
  const [selected, setSelected] = useState<AutomodeEntry | null>(null);

  const completed = useMemo(
    () => autoModeHistory.filter((e) => e.status === "completed"),
    [autoModeHistory],
  );
  const failed = useMemo(
    () => autoModeHistory.filter((e) => e.status === "failed"),
    [autoModeHistory],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title="Open job history canvas"
        style={{ ...iconBtnStyle, position: "fixed", right: 16, bottom: 60, zIndex: 9000 }}
      >
        📋
      </button>
    );
  }

  return (
    <aside style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Job History</div>
          <div style={subtitleStyle}>
            {autoModeHistory.length
              ? `${autoModeHistory.length} job${autoModeHistory.length === 1 ? "" : "s"} · ${completed.length} done · ${failed.length} failed`
              : "No automode jobs yet"}
            {autoModeRunning ? " · ● active" : ""}
          </div>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} style={iconBtnStyle} title="Collapse canvas">
          ›
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
        {autoModeHistory.length === 0 && (
          <div style={{ ...emptyStyle, marginTop: 8 }}>
            No automode jobs yet. Activate 🤖 Auto on a desk and completed jobs will appear here as cards.
          </div>
        )}
        {autoModeHistory.map((entry) => {
          const b = badgeColor(entry.status);
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              style={{
                textAlign: "left",
                display: "grid",
                gap: 6,
                padding: 11,
                borderRadius: 9,
                border: `1px solid ${b.border}`,
                background: b.bg,
                cursor: "pointer",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "flex-start" }}>
                <strong style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.3, flex: 1 }}>{entry.jobTitle}</strong>
                <span style={{
                  fontSize: 9, fontWeight: 900, color: b.color,
                  border: `1px solid ${b.border}`, borderRadius: 5,
                  padding: "2px 6px", flexShrink: 0, background: "#0b1525",
                }}>
                  {b.label}
                </span>
              </div>
              <div style={{ color: "#64748b", fontSize: 9 }}>
                #{entry.jobRoom} · {new Date(entry.startedAt).toLocaleString()}
              </div>
              {entry.resultSummary && (
                <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.4 }}>{entry.resultSummary}</div>
              )}
              {entry.activityLog.length > 0 && (
                <div style={{ color: "#64748b", fontSize: 9, lineHeight: 1.4 }}>
                  {entry.activityLog[entry.activityLog.length - 1]}
                </div>
              )}
              <div style={{ color: "#38bdf8", fontSize: 9, fontWeight: 900, marginTop: 2 }}>View details →</div>
            </button>
          );
        })}
      </div>

      {selected && (
        <JobDetailModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </aside>
  );
}

function badgeColor(status: AutomodeEntry["status"]) {
  const map: Record<AutomodeEntry["status"], { bg: string; color: string; border: string; label: string }> = {
    scanning: { bg: "#0f2131", color: "#38bdf8", border: "#1e6091", label: "SCANNING" },
    matched: { bg: "#1f3010", color: "#a3e635", border: "#558520", label: "MATCHED" },
    accepted: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "ACCEPTED" },
    executing: { bg: "#241f10", color: "#facc15", border: "#7a6420", label: "EXECUTING" },
    completing: { bg: "#151a2e", color: "#a5b4fc", border: "#3d4a8c", label: "WRAPPING UP" },
    completed: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "DONE" },
    failed: { bg: "#2a1015", color: "#fca5a5", border: "#7f1d1d", label: "FAILED" },
  };
  return map[status];
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ color: "#cbd5e1", fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>{value || "—"}</div>
    </div>
  );
}

function JobWorkView({ entry }: { entry: AutomodeEntry }) {
  const [work, setWork] = useState<{ activity: ActivityEvent[]; consoleText: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const sid = (entry.sessionId && entry.sessionId !== "automode-default" && !entry.sessionId.startsWith("sim-"))
    ? entry.sessionId
    : null;

  useEffect(() => {
    if (!sid) { setWork(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.sessions.activity(sid, 120).catch(() => [] as ActivityEvent[]),
      api.sessions.consoleHistory(sid, 3000).catch(() => ({ text: "" })),
    ])
      .then(([act, cons]) => { if (!cancelled) setWork({ activity: act, consoleText: cons.text || "" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sid]);

  if (!sid) return <div style={{ fontSize: 10, color: "#64748b" }}>No linked session for this job.</div>;
  if (loading) return <div style={{ fontSize: 10, color: "#64748b" }}>Loading agent work…</div>;
  if (!work || (work.activity.length === 0 && !work.consoleText)) {
    return <div style={{ fontSize: 10, color: "#64748b" }}>No recorded agent activity yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {work.activity.length > 0 && (
        <div>
          <div style={{ fontWeight: 900, fontSize: 10, color: "#cbd5e1", marginBottom: 4 }}>Agent activity</div>
          {work.activity.slice(-25).map((ev, i) => (
            <div key={i} style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, padding: "2px 0", borderBottom: "1px solid rgba(71,85,105,.25)" }}>
              • {(ev.title || ev.event_type || "event").slice(0, 200)}
            </div>
          ))}
        </div>
      )}
      {work.consoleText && (
        <details>
          <summary style={{ fontSize: 10, color: "#7dd3fc", cursor: "pointer", fontWeight: 900 }}>Console output</summary>
          <pre style={{
            fontSize: 10, color: "#94a3b8", lineHeight: 1.5,
            whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto",
            marginTop: 6, fontFamily: "ui-monospace, monospace",
          }}>{stripAnsi(work.consoleText.slice(-4000))}</pre>
        </details>
      )}
    </div>
  );
}

function JobDetailModal({ entry, onClose }: { entry: AutomodeEntry; onClose: () => void }) {
  const b = badgeColor(entry.status);
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 30000,
        background: "rgba(2, 6, 16, 0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "86vh",
          display: "flex", flexDirection: "column",
          background: "#0c1624",
          border: `1px solid ${b.border}`,
          borderRadius: 12,
          boxShadow: "0 24px 90px rgba(0,0,0,.65)",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
          padding: "16px 18px",
          borderBottom: "1px solid #273453",
          background: b.bg,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase" }}>
              Job details
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 950, color: "#f1f5f9", marginTop: 3, lineHeight: 1.3 }}>{entry.jobTitle}</h2>
            <span style={{
              display: "inline-flex", marginTop: 6, fontSize: 9, fontWeight: 900, color: b.color,
              border: `1px solid ${b.border}`, borderRadius: 5, padding: "3px 8px", background: "#0b1525",
            }}>
              {b.label}
            </span>
          </div>
          <button type="button" onClick={onClose} style={{ ...iconBtnStyle, flexShrink: 0 }} title="Close">✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Field label="Room" value={`#${entry.jobRoom}`} />
            <Field label="Job ID" value={entry.jobId} />
            <Field label="Agent" value={entry.agentId} />
            <Field label="Status" value={b.label} />
            <Field label="Started" value={new Date(entry.startedAt).toLocaleString()} />
            <Field label="Finished" value={entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "—"} />
            <Field label="Claim ID" value={entry.claimId || ""} />
            <Field label="Session ID" value={entry.sessionId || ""} />
          </div>

          {entry.resultSummary && (
            <div>
              <div style={{ color: "#64748b", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3 }}>Result</div>
              <div style={{ color: "#7ee0c2", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{entry.resultSummary}</div>
            </div>
          )}

          <div>
            <details open>
              <summary style={{ fontSize: 10, fontWeight: 900, color: "#cbd5e1", cursor: "pointer" }}>Activity log</summary>
              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.7, marginTop: 6 }}>
                {entry.activityLog.length ? (
                  entry.activityLog.map((line, i) => <div key={i}>{line}</div>)
                ) : (
                  <div style={{ color: "#64748b" }}>No activity recorded.</div>
                )}
              </div>
            </details>
          </div>

          <div>
            <details open>
              <summary style={{ fontSize: 10, fontWeight: 900, color: "#cbd5e1", cursor: "pointer" }}>What the agent did</summary>
              <div style={{ marginTop: 6 }}><JobWorkView entry={entry} /></div>
            </details>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}