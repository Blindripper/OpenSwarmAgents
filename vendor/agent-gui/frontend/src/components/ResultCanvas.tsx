import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api } from "../api/client";
import type { ActivityEvent, AuditResult, FileNode, FilePreviewData, Session, Team } from "../types";
import type { AutomodeEntry } from "../useAutomode";
import { MarkdownView } from "./FilePreview";

type CanvasTab = "result" | "audit" | "task" | "files" | "jobs";

interface Props {
  open: boolean;
  teams: Team[];
  focusedDeskId?: string | null;
  taskContents?: Record<string, string>;
  autoModeHistory?: AutomodeEntry[];
  autoModeRunning?: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (data: FilePreviewData) => void;
}

interface DeskCanvasData {
  activity: ActivityEvent[];
  audit: AuditResult | null;
  taskFile: string;
  files: FileNode[];
  consoleText: string;
}

const EMPTY_DESK_DATA: DeskCanvasData = {
  activity: [],
  audit: null,
  taskFile: "",
  files: [],
  consoleText: "",
};

export function ResultCanvas({
  open,
  teams,
  focusedDeskId = null,
  taskContents = {},
  autoModeHistory = [],
  autoModeRunning = false,
  onOpenChange,
  onPreview,
}: Props) {
  const [tab, setTab] = useState<CanvasTab>("result");
  const [deskData, setDeskData] = useState<Record<string, DeskCanvasData>>({});
  const [loading, setLoading] = useState(false);
  const [autoJobsOpen, setAutoJobsOpen] = useState(false);

  const projectTeams = useMemo(() => {
    return teams
      .map((team) => ({
        ...team,
        desks: team.desks.filter((desk) => !("isPending" in desk)) as Session[],
      }))
      .filter((team) => team.desks.length > 0);
  }, [teams]);

  const projectSessions = useMemo(
    () => projectTeams.flatMap((team) => team.desks),
    [projectTeams],
  );

  const sessionKey = useMemo(
    () => projectSessions.map((session) => session.id).sort().join("|"),
    [projectSessions],
  );

  async function load() {
    if (projectSessions.length === 0) {
      setDeskData({});
      return;
    }
    setLoading(true);
    try {
      const entries = await Promise.all(projectSessions.map(async (session) => {
        const [activityData, auditData, taskData, fileData, consoleData] = await Promise.all([
          api.sessions.activity(session.id, 80).catch(() => []),
          api.sessions.auditCached(session.id).catch(() => null),
          api.sessions.taskFile.get(session.id).catch(() => ({ content: "" })),
          api.sessions.files(session.id).catch(() => []),
          api.sessions.consoleHistory(session.id, 4000).catch(() => ({ text: "" })),
        ]);
        return [
          session.id,
          {
            activity: activityData,
            audit: auditData,
            taskFile: taskData.content || "",
            files: fileData,
            consoleText: consoleData.text || "",
          },
        ] as const;
      }));
      setDeskData(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDeskData({});
    if (open) void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey]);

  useEffect(() => {
    if (!open || !projectSessions.some((session) => session.is_running)) return;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey, projectSessions]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title="Open result canvas"
        style={collapsedStyle}
      >
        Canvas
      </button>
    );
  }

  return (
    <aside style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Canvas</div>
          <div style={subtitleStyle}>
            {projectSessions.length
              ? `${projectSessions.length} desk${projectSessions.length === 1 ? "" : "s"} across ${projectTeams.length} room${projectTeams.length === 1 ? "" : "s"}`
              : "No project desks yet"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void load()} disabled={projectSessions.length === 0 || loading} style={iconBtnStyle} title="Refresh canvas">
            ↻
          </button>
          <button type="button" onClick={() => onOpenChange(false)} style={iconBtnStyle} title="Collapse canvas">
            ›
          </button>
        </div>
      </div>

      <div style={tabsStyle}>
        {([
          ["result", "Result"],
          ["audit", "Audit"],
          ["task", "Task"],
          ["files", "Files"],
          ["jobs", "Jobs"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              ...tabBtnStyle,
              background: tab === id ? "var(--accent2)" : "transparent",
              color: tab === id ? "white" : "var(--text-dim)",
              borderColor: tab === id ? "var(--accent2)" : "#2a3558",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={bodyStyle}>
        {tab === "jobs" ? (
          <JobsView history={autoModeHistory} running={autoModeRunning} />
        ) : projectSessions.length === 0 ? (
          <div style={emptyStyle}>Start a desk to show project results.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {projectTeams.map((team) => (
              <section key={team.id} style={teamSectionStyle}>
                <div style={teamHeaderStyle}>
                  <span>{team.name || "Room"}</span>
                  <span>{team.desks.length} desk{team.desks.length === 1 ? "" : "s"}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {team.desks.map((session) => {
                    const data = deskData[session.id] ?? EMPTY_DESK_DATA;
                    const result = latestDeskResult(data);
                    const focused = focusedDeskId === session.id;
                    return (
                      <DeskCanvasSection
                        key={session.id}
                        session={session}
                        data={data}
                        result={result}
                        tab={tab}
                        focused={focused}
                        loading={loading}
                        taskContent={taskContents[session.id] || ""}
                        onPreview={onPreview}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
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

  if (!sid) return <div style={{ fontSize: 9, color: "#64748b" }}>No linked session for this job.</div>;
  if (loading) return <div style={{ fontSize: 9, color: "#64748b" }}>Loading agent work…</div>;
  if (!work || (work.activity.length === 0 && !work.consoleText)) {
    return <div style={{ fontSize: 9, color: "#64748b" }}>No recorded agent activity yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {work.activity.length > 0 && (
        <div>
          <div style={{ fontWeight: 900, fontSize: 9, color: "#cbd5e1", marginBottom: 3 }}>Agent activity</div>
          {work.activity.slice(-20).map((ev, i) => (
            <div key={i} style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
              • {(ev.title || ev.event_type || "event").slice(0, 140)}
            </div>
          ))}
        </div>
      )}
      {work.consoleText && (
        <details>
          <summary style={{ fontSize: 9, color: "#64748b", cursor: "pointer" }}>Console output</summary>
          <pre style={{
            fontSize: 9, color: "#94a3b8", lineHeight: 1.5,
            whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto",
            marginTop: 4, fontFamily: "ui-monospace, monospace",
          }}>{stripAnsi(work.consoleText.slice(-3000))}</pre>
        </details>
      )}
    </div>
  );
}

function JobsView({ history, running }: { history: AutomodeEntry[]; running: boolean }) {
  if (history.length === 0 && !running) {
    return (
      <div style={emptyStyle}>
        No automode jobs yet. Activate 🤖 Auto on a desk and completed jobs will show here.
      </div>
    );
  }
  const badge = (status: AutomodeEntry["status"]) => {
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
  };
  if (running) {
    return (
      <div style={{ display: "grid", gap: 8, padding: "10px 0" }}>
        <div style={{ fontSize: 12, color: "#7ee0c2", fontWeight: 900 }}>● Automode active — scanning every 30s</div>
        {history.length === 0 && <div style={emptyStyle}>Waiting for first job…</div>}
        {history.map((entry) => {
          const b = badge(entry.status);
          return (
            <div key={entry.id} style={{ border: `1px solid ${b.border}`, borderRadius: 8, padding: 10, background: b.bg }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                <strong style={{ fontSize: 11, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.jobTitle}</strong>
                <span style={{ fontSize: 9, fontWeight: 900, color: b.color, flexShrink: 0 }}>{b.label}</span>
              </div>
              {entry.resultSummary && <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 4 }}>{entry.resultSummary}</div>}
              {entry.activityLog.length > 0 && (
                <div style={{ color: "#64748b", fontSize: 9, marginTop: 4 }}>{entry.activityLog[entry.activityLog.length - 1]}</div>
              )}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 9, color: "#64748b", cursor: "pointer" }}>What the agent did</summary>
                <div style={{ marginTop: 5 }}><JobWorkView entry={entry} /></div>
              </details>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8, padding: "10px 0" }}>
      {history.map((entry) => {
        const b = badge(entry.status);
        return (
          <div key={entry.id} style={{ border: `1px solid ${b.border}`, borderRadius: 8, padding: 10, background: b.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <strong style={{ fontSize: 11, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.jobTitle}</strong>
              <span style={{ fontSize: 9, fontWeight: 900, color: b.color, flexShrink: 0 }}>{b.label}</span>
            </div>
            <div style={{ color: "#64748b", fontSize: 9, marginTop: 4 }}>#{entry.jobRoom} · {new Date(entry.startedAt).toLocaleString()}</div>
            {entry.resultSummary && <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 4 }}>{entry.resultSummary}</div>}
            {entry.activityLog.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 9, color: "#64748b", cursor: "pointer" }}>Activity log</summary>
                <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.6, marginTop: 4 }}>
                  {entry.activityLog.map((line, i) => <div key={i}>{line}</div>)}
                </div>
              </details>
            )}
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 9, color: "#64748b", cursor: "pointer" }}>What the agent did</summary>
              <div style={{ marginTop: 5 }}><JobWorkView entry={entry} /></div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function DeskCanvasSection({
  session,
  data,
  result,
  tab,
  focused,
  loading,
  taskContent,
  onPreview,
}: {
  session: Session;
  data: DeskCanvasData;
  result: string;
  tab: CanvasTab;
  focused: boolean;
  loading: boolean;
  taskContent: string;
  onPreview: (data: FilePreviewData) => void;
}) {
  return (
    <article style={deskSectionStyle(focused)}>
      <div style={deskHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={deskTitleStyle}>{session.title || "Untitled desk"}</div>
          <div style={deskMetaStyle}>
            {session.agent || "agent"} · {session.is_running ? "running" : session.task_solved ? "solved" : "idle"}
          </div>
        </div>
        {focused && <span style={focusPillStyle}>focused</span>}
      </div>
      {tab === "result" ? (
        <ResultView session={session} result={result} loading={loading} />
      ) : tab === "audit" ? (
        <AuditView audit={data.audit} />
      ) : tab === "task" ? (
        <MarkdownBox content={data.taskFile || taskContent || "No task loaded."} />
      ) : tab === "jobs" ? (
        <div style={emptyStyle}>Job history is shown per-desession at the Canvas level.</div>
      ) : (
        <FilesView nodes={data.files} onPreview={onPreview} />
      )}
    </article>
  );
}

function ResultView({ session, result, loading }: { session: Session; result: string; loading: boolean }) {
  if (!result) {
    return (
      <div style={emptyStyle}>
        {session.is_running || loading ? "Agent is working. Results will appear here." : "No submitted result yet."}
      </div>
    );
  }
  return <MarkdownBox content={result} />;
}

function latestDeskResult(data: DeskCanvasData) {
  const fromConsole = extractConsoleResult(data.consoleText);
  if (fromConsole) return fromConsole;
  const outputEvent = data.activity
    .slice()
    .reverse()
    .find((event) =>
      event.tool_name === "submit_result" ||
      event.title.toLowerCase().includes("submitted output") ||
      (event.event_type === "message" && event.detail.trim())
    );
  return outputEvent?.detail?.trim() || "";
}

function AuditView({ audit }: { audit: AuditResult | null }) {
  if (!audit || audit.summary.total === 0) {
    return <div style={emptyStyle}>No manager audit cached for this desk yet.</div>;
  }
  const unresolved = audit.results.filter((item) => item.verdict === "fail" || item.verdict === "unsure");
  const shown = unresolved.length ? unresolved : audit.results;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={metricStyle}>
        {audit.summary.passed}/{audit.summary.total} checks passed · {audit.summary.failed} failed · {audit.summary.unsure} unsure
      </div>
      {shown.map((item) => (
        <div key={item.id} style={auditItemStyle}>
          <div style={{
            ...verdictStyle,
            color: item.verdict === "pass" ? "#86efac" : item.verdict === "fail" ? "#fca5a5" : "#facc15",
          }}>
            {item.verdict}
          </div>
          <div style={criterionStyle}>{item.criterion}</div>
          <div style={detailStyle}>{item.evidence}</div>
          {item.fix_hint && <div style={fixStyle}>{item.fix_hint}</div>}
        </div>
      ))}
    </div>
  );
}

function FilesView({ nodes, onPreview }: { nodes: FileNode[]; onPreview: (data: FilePreviewData) => void }) {
  const flat = flattenFiles(nodes);
  if (flat.length === 0) return <div style={emptyStyle}>No files available for this desk yet.</div>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {flat.map((node) => (
        <button
          key={node.path}
          type="button"
          onClick={() => {
            if (!node.preview_type || node.preview_type === "none") return;
            if (node.preview_type === "image" || node.preview_type === "pdf") {
              onPreview({ type: node.preview_type, path: node.path, name: node.name });
              return;
            }
            api.file.preview(node.path).then(onPreview).catch(() => {});
          }}
          disabled={!node.preview_type || node.preview_type === "none"}
          style={fileBtnStyle(Boolean(node.preview_type && node.preview_type !== "none"))}
          title={node.path}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.path}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{node.preview_type || "file"}</span>
        </button>
      ))}
    </div>
  );
}

function MarkdownBox({ content }: { content: string }) {
  return (
    <div style={markdownBoxStyle}>
      <MarkdownView content={content} />
    </div>
  );
}

function extractConsoleResult(text: string) {
  const marker = "\nResult:\n";
  const index = text.lastIndexOf(marker);
  if (index < 0) return "";
  return text.slice(index + marker.length).trim().slice(0, 10000);
}

function flattenFiles(nodes: FileNode[], prefix = ""): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    const path = node.path || (prefix ? `${prefix}/${node.name}` : node.name);
    if (node.is_dir) {
      result.push(...flattenFiles(node.children || [], path));
    } else {
      result.push({ ...node, path });
    }
  }
  return result;
}

const collapsedStyle: React.CSSProperties = {
  width: 34,
  flexShrink: 0,
  border: "0",
  borderLeft: "1px solid #22304f",
  background: "#0f1626",
  color: "#93c5fd",
  fontSize: 11,
  fontWeight: 900,
  writingMode: "vertical-rl",
  textOrientation: "mixed",
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  width: "min(390px, 34vw)",
  minWidth: 320,
  maxWidth: 460,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid #22304f",
  background: "#0f1626",
  color: "var(--text)",
  minHeight: 0,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 12px 10px",
  borderBottom: "1px solid #22304f",
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
};

const subtitleStyle: React.CSSProperties = {
  marginTop: 3,
  fontSize: 11,
  color: "var(--text-dim)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid #2a3558",
  background: "#121828",
  color: "var(--text)",
  cursor: "pointer",
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "8px 10px",
  borderBottom: "1px solid #22304f",
  overflowX: "auto",
};

const tabBtnStyle: React.CSSProperties = {
  height: 26,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: 12,
};

const teamSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const teamHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: -12,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "7px 8px",
  border: "1px solid #263858",
  borderRadius: 6,
  background: "#0f1626",
  color: "#bfdbfe",
  fontSize: 11,
  fontWeight: 900,
};

function deskSectionStyle(focused: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 8,
    border: `1px solid ${focused ? "#60a5fa" : "#24304f"}`,
    borderRadius: 8,
    background: focused ? "#101d33" : "#0d1320",
    padding: 10,
    boxShadow: focused ? "0 0 0 1px rgba(96, 165, 250, 0.25)" : "none",
  };
}

const deskHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
};

const deskTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const deskMetaStyle: React.CSSProperties = {
  marginTop: 3,
  fontSize: 10,
  color: "var(--text-dim)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const focusPillStyle: React.CSSProperties = {
  flexShrink: 0,
  border: "1px solid rgba(96, 165, 250, 0.45)",
  borderRadius: 999,
  padding: "2px 6px",
  color: "#93c5fd",
  fontSize: 9,
  fontWeight: 900,
  textTransform: "uppercase",
};

const emptyStyle: React.CSSProperties = {
  border: "1px solid #24304f",
  borderRadius: 8,
  background: "#111827",
  padding: 12,
  color: "var(--text-dim)",
  fontSize: 12,
  lineHeight: 1.45,
};

const markdownBoxStyle: React.CSSProperties = {
  border: "1px solid #24304f",
  borderRadius: 8,
  background: "#111827",
  padding: 12,
  fontSize: 12,
  lineHeight: 1.45,
};

const metricStyle: React.CSSProperties = {
  border: "1px solid #24304f",
  borderRadius: 8,
  background: "#111827",
  padding: "9px 10px",
  color: "#bfdbfe",
  fontSize: 12,
  fontWeight: 800,
};

const auditItemStyle: React.CSSProperties = {
  border: "1px solid #24304f",
  borderRadius: 8,
  background: "#111827",
  padding: 10,
};

const verdictStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
};

const criterionStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  fontWeight: 900,
};

const detailStyle: React.CSSProperties = {
  marginTop: 5,
  fontSize: 11,
  color: "var(--text-dim)",
  lineHeight: 1.35,
};

const fixStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: "#93c5fd",
  lineHeight: 1.35,
};

function fileBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    minHeight: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: "1px solid #24304f",
    borderRadius: 6,
    background: enabled ? "#111827" : "#0d1320",
    color: enabled ? "var(--text)" : "var(--text-dim)",
    padding: "0 9px",
    fontSize: 11,
    cursor: enabled ? "pointer" : "default",
  };
}
