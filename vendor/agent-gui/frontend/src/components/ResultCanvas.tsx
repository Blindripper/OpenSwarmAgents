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

const CANVAS_W = 380;

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
      {/* Fixed toggle tab */}
      <div
        onClick={() => onOpenChange(!open)}
        style={{
          position: "fixed", right: open ? CANVAS_W : 0, top: "50%", transform: "translateY(-50%)",
          zIndex: 9000, height: 80, width: 26,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(11, 18, 28, .96)",
          border: "1px solid #273453", borderRight: "none",
          borderRadius: "8px 0 0 8px",
          cursor: "pointer", color: "#94a3b8", fontSize: 12, fontWeight: 900,
          transition: "right .25s ease", userSelect: "none",
        }}
        title={open ? "Close job history" : "Open job history"}
      >
        <span style={{ writingMode: "vertical-rl", letterSpacing: 1 }}>
          {open ? "›" : "📋 Jobs"}
        </span>
      </div>

      {/* Panel */}
      <aside style={{
        position: "fixed", top: 0, right: open ? 0 : -CANVAS_W - 12,
        width: CANVAS_W, height: "100%", zIndex: 8999,
        display: "flex", flexDirection: "column",
        borderLeft: "1px solid #273453",
        background: "rgba(9, 15, 26, .99)",
        color: "#cbd5e1", fontSize: 13,
        overflow: "hidden",
        transition: "right .25s ease",
        boxShadow: open ? "-8px 0 40px rgba(0,0,0,.5)" : "none",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 16px", borderBottom: "1px solid rgba(71,85,105,.5)", flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 950, color: "#f1f5f9" }}>Job History</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
              {autoModeHistory.length
                ? `${autoModeHistory.length} job${autoModeHistory.length === 1 ? "" : "s"}  ·  ✓ ${completed}  ·  ✗ ${failed}`
                : "No automode jobs yet"}
              {autoModeRunning ? "  ● active" : ""}
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)}
            style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            ›
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 12, alignContent: "start" }}>
          {autoModeHistory.length === 0 && (
            <div style={{ border: "1px dashed #2a3558", borderRadius: 8, padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13, marginTop: 12 }}>
              No automode jobs yet. Activate 🤖 Auto on a desk to get started.
            </div>
          )}
          {autoModeHistory.map((entry) => {
            const c = stateColors[entry.status] || stateColors.failed;
            const stages = pipelineStages(entry.status);
            return (
              <button key={entry.id} type="button" onClick={() => setSelected(entry)}
                style={{
                  textAlign: "left", display: "grid", gap: 8,
                  padding: 14, borderRadius: 10, cursor: "pointer", width: "100%",
                  border: `1px solid ${c.border}`,
                  background: `linear-gradient(180deg, ${c.bg.replace(")", "dd)")}, #0b1525)`,
                  boxShadow: "0 12px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 14, color: "#f1f5f9", lineHeight: 1.3, display: "block" }}>{entry.agentId}</strong>
                    <span style={{ fontSize: 12, color: "#94a3b8", marginTop: 3, display: "block" }}>{entry.jobTitle || entry.jobId}</span>
                  </div>
                  <span style={{
                    height: 20, padding: "0 8px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap",
                    fontSize: 10, fontWeight: 900, color: c.color, border: `1px solid ${c.border}`,
                    background: "rgba(11, 21, 37, .85)",
                  }}>{c.label}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 11 }}>#{entry.jobRoom} · {new Date(entry.startedAt).toLocaleString()}</div>
                {entry.resultDetail ? (
                  <div style={{
                    color: "#94a3b8", fontSize: 12, lineHeight: 1.5,
                    maxHeight: 80, overflow: "auto",
                    padding: 8, borderRadius: 6,
                    border: "1px solid rgba(71,85,105,.3)",
                    background: "rgba(2,6,16,.5)",
                  }}>
                    <pre style={{ margin: 0, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {entry.resultDetail.slice(0, 400)}
                    </pre>
                  </div>
                ) : entry.resultSummary ? (
                  <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>{entry.resultSummary}</div>
                ) : null}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
                  {stages.map((s, i) => (
                    <span key={i} title={s.info} style={{
                      fontSize: 9, fontWeight: 900, padding: "2px 6px", borderRadius: 4,
                      background: s.done ? "rgba(126,224,194,.15)" : "rgba(71,85,105,.2)",
                      color: s.done ? "#7ee0c2" : "#64748b",
                      border: `1px solid ${s.done ? "rgba(126,224,194,.35)" : "rgba(71,85,105,.35)"}`,
                    }}>
                      {s.done ? "✓ " : "○ "}{s.label}
                    </span>
                  ))}
                </div>
                <div style={{ color: "#38bdf8", fontSize: 11, fontWeight: 900, marginTop: 4 }}>View details →</div>
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
      background: "rgba(2, 6, 16, 0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(800px, 95%)", maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        background: "rgba(12, 22, 36, .99)",
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        boxShadow: "0 24px 90px rgba(0,0,0,.65)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14,
          padding: "18px 20px", borderBottom: "1px solid rgba(71,85,105,.5)",
          background: `linear-gradient(180deg, ${c.bg}, #0b1525)`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase" }}>Job Details</div>
            <h2 style={{ fontSize: 19, fontWeight: 950, color: "#f1f5f9", marginTop: 4, lineHeight: 1.3 }}>{entry.agentId}</h2>
            <span style={{ color: "#94a3b8", fontSize: 13, marginTop: 3, display: "block" }}>{entry.jobTitle}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {stages.map((s, i) => (
                <span key={i} title={s.info} style={{
                  fontSize: 10, fontWeight: 900, padding: "3px 10px", borderRadius: 5,
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
            style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "grid", gap: 16 }}>
          {/* Key fields grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {[{ l: "Room", v: `#${entry.jobRoom}` }, { l: "Job ID", v: entry.jobId }, { l: "Agent", v: entry.agentId },
              { l: "Status", v: c.label }, { l: "Started", v: new Date(entry.startedAt).toLocaleString() },
              { l: "Finished", v: entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "—" },
              { l: "Claim ID", v: entry.claimId || "—" }, { l: "Session ID", v: entry.sessionId || "—" },
            ].map((f) => (
              <div key={f.l} style={{
                padding: "8px 10px", borderRadius: 6,
                border: "1px solid rgba(71,85,105,.2)",
                background: "rgba(2,6,16,.35)",
              }}>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.4 }}>{f.l}</div>
                <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 3, overflowWrap: "anywhere" }}>{f.v}</div>
              </div>
            ))}
          </div>

          {/* Output / Agent work - fully scrollable, not truncated */}
          {(entry.resultDetail || entry.resultSummary) && (
            <div>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase" }}>Output / Agent work</div>
              {entry.resultDetail ? (
                <pre style={{
                  color: "#cbd5e1", fontSize: 13, lineHeight: 1.6,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 400, overflow: "auto",
                  marginTop: 6, padding: 12, borderRadius: 8,
                  border: "1px solid rgba(71,85,105,.3)",
                  background: "rgba(2,6,16,.5)",
                  fontFamily: "ui-monospace, monospace",
                }}>{entry.resultDetail}</pre>
              ) : (
                <div style={{ color: "#7ee0c2", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{entry.resultSummary}</div>
              )}
            </div>
          )}

          <div>
            <details open>
              <summary style={{ fontSize: 12, fontWeight: 900, color: "#cbd5e1", cursor: "pointer", padding: "4px 0" }}>📋 Activity log</summary>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.8, marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(2,6,16,.3)" }}>
                {entry.activityLog.length ? entry.activityLog.map((l, i) => <div key={i}>{l}</div>) : <div style={{ color: "#64748b" }}>No activity recorded.</div>}
              </div>
            </details>
          </div>

          <div>
            <details open>
              <summary style={{ fontSize: 12, fontWeight: 900, color: "#cbd5e1", cursor: "pointer", padding: "4px 0" }}>⚡ What the agent did</summary>
              <div style={{ marginTop: 6 }}><JobWorkView entry={entry} /></div>
            </details>
          </div>

          <div>
            <details>
              <summary style={{ fontSize: 12, fontWeight: 900, color: "#cbd5e1", cursor: "pointer", padding: "4px 0" }}>🔧 Full metadata</summary>
              <pre style={{ fontSize: 11, color: "#64748b", marginTop: 6, padding: 8, borderRadius: 6, background: "rgba(2,6,16,.3)", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
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
      api.sessions.consoleHistory(sid, 8000).catch(() => ({ text: "" })),
    ]).then(([act, cons]) => { if (!cancelled) setWork({ activity: act, consoleText: cons.text || "" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sid]);

  if (!sid) return <div style={{ fontSize: 12, color: "#64748b" }}>No linked session for this job.</div>;
  if (loading) return <div style={{ fontSize: 12, color: "#64748b" }}>Loading agent work…</div>;
  if (!work || (work.activity.length === 0 && !work.consoleText)) return <div style={{ fontSize: 12, color: "#64748b" }}>No recorded agent activity yet.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {work.activity.length > 0 && (
        <div>
          <div style={{ fontWeight: 900, fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>Agent activity</div>
          <div style={{
            maxHeight: 300, overflow: "auto",
            padding: "6px 10px", borderRadius: 6,
            background: "rgba(2,6,16,.3)",
          }}>
            {work.activity.slice(-35).map((ev, i) => (
              <div key={i} style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, padding: "3px 0", borderBottom: "1px solid rgba(71,85,105,.15)" }}>
                • {(ev.title || ev.event_type || "event").slice(0, 300)}
              </div>
            ))}
          </div>
        </div>
      )}
      {work.consoleText && (
        <details>
          <summary style={{ fontSize: 11, color: "#7dd3fc", cursor: "pointer", fontWeight: 900 }}>🖥 Console output</summary>
          <pre style={{
            fontSize: 12, color: "#94a3b8", lineHeight: 1.5,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 400, overflow: "auto",
            marginTop: 6, padding: 10, borderRadius: 6,
            background: "rgba(2,6,16,.3)",
            fontFamily: "ui-monospace, monospace",
          }}>
            {stripAnsi(work.consoleText.slice(-8000))}
          </pre>
        </details>
      )}
    </div>
  );
}