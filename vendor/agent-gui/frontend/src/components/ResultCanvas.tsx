import { useEffect, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { ActivityEvent } from "../types";
import type { AutomodeEntry } from "../useAutomode";
import { pipelineStages } from "./AutomodeControl";

interface Props {
  open: boolean;
  autoModeHistory?: AutomodeEntry[];
  autoModeRunning?: boolean;
  onOpenChange: (open: boolean) => void;
}

const CANVAS_W = 340;

const stateColors: Record<string, { bg: string; color: string; border: string; label: string }> = {
  scanning: { bg: "#0f2131", color: "#38bdf8", border: "#1e6091", label: "SCANNING" },
  matched: { bg: "#1f3010", color: "#a3e635", border: "#558520", label: "MATCHED" },
  accepted: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "ACCEPTED" },
  executing: { bg: "#241f10", color: "#facc15", border: "#7a6420", label: "EXECUTING" },
  completing: { bg: "#151a2e", color: "#a5b4fc", border: "#3d4a8c", label: "WRAPPING UP" },
  completed: { bg: "#10251f", color: "#7ee0c2", border: "#2a8c72", label: "DONE" },
  failed: { bg: "#2a1015", color: "#fca5a5", border: "#7f1d1d", label: "FAILED" },
};

function stripAnsi(s: string): string {
  return s.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function ResultCanvas({ open, autoModeHistory = [], autoModeRunning = false, onOpenChange }: Props) {
  const [selected, setSelected] = useState<AutomodeEntry | null>(null);
  const completed = autoModeHistory.filter((e) => e.status === "completed").length;
  const failed = autoModeHistory.filter((e) => e.status === "failed").length;

  return (
    <>
      {/* Fixed toggle tab — always visible at the right edge */}
      <div
        onClick={() => onOpenChange(!open)}
        style={{
          position: "fixed", right: open ? CANVAS_W : 0, top: "50%", transform: "translateY(-50%)",
          zIndex: 9000,
          height: 60, width: 22,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(11, 18, 28, .96)",
          border: "1px solid #273453",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          cursor: "pointer",
          color: "#94a3b8", fontSize: 11, fontWeight: 900,
          transition: "right .22s ease",
          userSelect: "none",
        }}
        title={open ? "Close job history" : "Open job history"}
      >
        <span style={{ writingMode: "vertical-rl", letterSpacing: 1 }}>
          {open ? "›" : "📋 Jobs"}
        </span>
      </div>

      {/* Panel — slides in from the right */}
      <aside style={{
        position: "fixed", top: 0, right: open ? 0 : -CANVAS_W - 12,
        width: CANVAS_W, height: "100%",
        zIndex: 8999,
        display: "flex", flexDirection: "column",
        borderLeft: "1px solid #273453",
        background: "rgba(9, 15, 26, .99)",
        color: "#cbd5e1", fontSize: 12,
        overflow: "hidden",
        transition: "right .22s ease",
        boxShadow: open ? "-8px 0 40px rgba(0,0,0,.5)" : "none",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 14px", borderBottom: "1px solid #273453", flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Job History</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
              {autoModeHistory.length
                ? `${autoModeHistory.length} job${autoModeHistory.length === 1 ? "" : "s"} · ✓ ${completed} · ✗ ${failed}`
                : "No automode jobs yet"}
              {autoModeRunning ? " ● active" : ""}
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)}
            style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
            ›
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
          {autoModeHistory.length === 0 && (
            <div style={{ border: "1px dashed #2a3558", borderRadius: 8, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
              No automode jobs yet. Activate 🤖 Auto on a desk to get started.
            </div>
          )}
          {autoModeHistory.map((entry) => {
            const c = stateColors[entry.status] || stateColors.failed;
            const stages = pipelineStages(entry.status);
            return (
              <button key={entry.id} type="button" onClick={() => setSelected(entry)}
                style={{
                  textAlign: "left", display: "grid", gap: 6,
                  padding: 12, borderRadius: 9, cursor: "pointer", width: "100%",
                  border: `1px solid ${c.border}`,
                  background: `linear-gradient(180deg, ${c.bg}, #0b1525)`,
                  boxShadow: "0 12px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 13, color: "#f1f5f9", lineHeight: 1.3, display: "block" }}>{entry.agentId}</strong>
                    <span style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, display: "block" }}>{entry.jobTitle || entry.jobId}</span>
                  </div>
                  <span style={{
                    height: 18, padding: "0 6px", borderRadius: 4, flexShrink: 0, whiteSpace: "nowrap",
                    fontSize: 9, fontWeight: 900, color: c.color, border: `1px solid ${c.border}`,
                    background: "rgba(11, 21, 37, .85)",
                  }}>{c.label}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 9 }}>#{entry.jobRoom} · {new Date(entry.startedAt).toLocaleString()}</div>
                {entry.resultSummary && <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.4 }}>{entry.resultSummary}</div>}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  {stages.map((s, i) => (
                    <span key={i} style={{
                      fontSize: 8, fontWeight: 900, padding: "2px 5px", borderRadius: 3,
                      background: s.done ? "rgba(126,224,194,.12)" : "rgba(71,85,105,.15)",
                      color: s.done ? "#7ee0c2" : "#64748b",
                      border: `1px solid ${s.done ? "rgba(126,224,194,.3)" : "rgba(71,85,105,.3)"}`,
                    }}>
                      {s.done ? "✓ " : ""}{s.label}
                    </span>
                  ))}
                </div>
                <div style={{ color: "#38bdf8", fontSize: 9, fontWeight: 900, marginTop: 2 }}>View details →</div>
              </button>
            );
          })}
        </div>
      </aside>

      {selected && <JobDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function JobDetailModal({ entry, onClose }: { entry: AutomodeEntry; onClose: () => void }) {
  const c = stateColors[entry.status] || stateColors.failed;
  const stages = pipelineStages(entry.status);
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 30000,
      background: "rgba(2, 6, 16, 0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(720px, 100%)", maxHeight: "86vh",
        display: "flex", flexDirection: "column",
        background: "#0c1624",
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        boxShadow: "0 24px 90px rgba(0,0,0,.65)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
          padding: "16px 18px", borderBottom: "1px solid #273453",
          background: `linear-gradient(180deg, ${c.bg}, #0b1525)`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase" }}>Job details</div>
            <h2 style={{ fontSize: 17, fontWeight: 950, color: "#f1f5f9", marginTop: 3, lineHeight: 1.3 }}>{entry.agentId}</h2>
            <span style={{ color: "#94a3b8", fontSize: 11, marginTop: 2, display: "block" }}>{entry.jobTitle}</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {stages.map((s, i) => (
                <span key={i} style={{
                  fontSize: 9, fontWeight: 900, padding: "2px 8px", borderRadius: 4,
                  background: s.done ? "rgba(126,224,194,.15)" : "rgba(71,85,105,.2)",
                  color: s.done ? "#7ee0c2" : "#64748b",
                  border: `1px solid ${s.done ? "rgba(126,224,194,.4)" : "rgba(71,85,105,.35)"}`,
                }}>
                  {s.done ? "✓ " : "○ "}{s.label}
                </span>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[{ l: "Room", v: `#${entry.jobRoom}` }, { l: "Job ID", v: entry.jobId }, { l: "Agent", v: entry.agentId },
              { l: "Status", v: c.label }, { l: "Started", v: new Date(entry.startedAt).toLocaleString() },
              { l: "Finished", v: entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "—" },
              { l: "Claim ID", v: entry.claimId || "—" }, { l: "Session ID", v: entry.sessionId || "—" },
            ].map((f) => (
              <div key={f.l}>
                <div style={{ color: "#64748b", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3 }}>{f.l}</div>
                <div style={{ color: "#cbd5e1", fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>{f.v}</div>
              </div>
            ))}
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
                {entry.activityLog.length ? entry.activityLog.map((l, i) => <div key={i}>{l}</div>) : <div style={{ color: "#64748b" }}>No activity recorded.</div>}
              </div>
            </details>
          </div>

          <div>
            <details open>
              <summary style={{ fontSize: 10, fontWeight: 900, color: "#cbd5e1", cursor: "pointer" }}>What the agent did</summary>
              <div style={{ marginTop: 6 }}><JobWorkView entry={entry} /></div>
            </details>
          </div>

          <div>
            <details>
              <summary style={{ fontSize: 10, fontWeight: 900, color: "#cbd5e1", cursor: "pointer" }}>Full metadata</summary>
              <pre style={{ fontSize: 10, color: "#64748b", marginTop: 6, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
{JSON.stringify({ id: entry.id, room: entry.jobRoom, jobId: entry.jobId, claimId: entry.claimId, sessionId: entry.sessionId, startedAt: entry.startedAt, completedAt: entry.completedAt, status: entry.status }, null, 2)}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function JobWorkView({ entry }: { entry: AutomodeEntry }) {
  const [work, setWork] = useState<{ activity: ActivityEvent[]; consoleText: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const sid = (entry.sessionId && entry.sessionId !== "automode-default" && !entry.sessionId.startsWith("sim-")) ? entry.sessionId : null;

  useEffect(() => {
    if (!sid) { setWork(null); return; }
    let cancelled = false; setLoading(true);
    Promise.all([
      api.sessions.activity(sid, 120).catch(() => [] as ActivityEvent[]),
      api.sessions.consoleHistory(sid, 3000).catch(() => ({ text: "" })),
    ]).then(([act, cons]) => { if (!cancelled) setWork({ activity: act, consoleText: cons.text || "" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sid]);

  if (!sid) return <div style={{ fontSize: 10, color: "#64748b" }}>No linked session for this job.</div>;
  if (loading) return <div style={{ fontSize: 10, color: "#64748b" }}>Loading agent work…</div>;
  if (!work || (work.activity.length === 0 && !work.consoleText)) return <div style={{ fontSize: 10, color: "#64748b" }}>No recorded agent activity yet.</div>;
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
          <pre style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", marginTop: 6, fontFamily: "ui-monospace, monospace" }}>
            {stripAnsi(work.consoleText.slice(-4000))}
          </pre>
        </details>
      )}
    </div>
  );
}