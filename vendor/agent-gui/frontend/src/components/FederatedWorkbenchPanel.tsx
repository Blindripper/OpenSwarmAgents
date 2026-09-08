import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { FederatedWorkbenchOverview, FederatedWorkbenchTask } from "../types";

type Tab = "verified" | "stale" | "untrusted" | "quarantine";

const button = { height: 31, padding: "0 11px", borderRadius: 6, border: "1px solid #2563eb", background: "#172d61", color: "#bfdbfe", fontSize: 11, fontWeight: 900, cursor: "pointer" } as const;

function key(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function short(value?: string | null) {
  if (!value) return "unknown";
  return value.length > 34 ? `${value.slice(0, 18)}...${value.slice(-8)}` : value;
}

function pill(state: string) {
  if (state === "verified") return { color: "#7ee0c2", bg: "#0e221b", label: "VERIFIED" };
  if (state === "stale") return { color: "#fde68a", bg: "#2d230b", label: "STALE" };
  if (state === "imported") return { color: "#a5b4fc", bg: "#151a2e", label: "IMPORTED" };
  return { color: "#fca5a5", bg: "#2a1015", label: state === "quarantined" ? "QUARANTINED" : "UNTRUSTED" };
}

function badge(color: string, background: string): import("react").CSSProperties {
  return { padding: "2px 7px", borderRadius: 999, border: `1px solid ${color}`, background, color, fontSize: 10, fontWeight: 900, textTransform: "uppercase" };
}

function TaskCard({ task, busy, confirming, onReview, onConfirm, onCancel }: {
  task: FederatedWorkbenchTask;
  busy: boolean;
  confirming: boolean;
  onReview: (task: FederatedWorkbenchTask) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const status = pill(task.state);
  return <article data-testid={`federated-workbench-task-${task.id}`} style={{ border: `1px solid ${status.color}`, borderRadius: 9, padding: 12, background: "#0b1522", display: "grid", gap: 9 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: 14, overflowWrap: "anywhere" }}>{task.title}</strong>
          <span style={badge(status.color, status.bg)}>{status.label}</span>
          <span style={badge("#93c5fd", "#10243a")}>INSPECT ONLY</span>
          <span style={badge("#c4b5fd", "#22163a")}>NO EXECUTION</span>
        </div>
        <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
          {short(task.origin_node_id)} / {short(task.origin_agent_id)} / {short(task.task_id)}
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 11, textAlign: "right" }}>
        <div>{task.status}</div>
        <div>seen {new Date(task.last_seen_at).toLocaleString()}</div>
      </div>
    </div>

    <div style={{ border: "1px solid #1e2a45", borderRadius: 8, padding: 10, background: "#09111e", color: "#dbeafe", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>{task.summary}</div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, color: "#cbd5e1", fontSize: 12 }}>
      <div><b style={{ color: "#93c5fd" }}>Goal</b><br />{task.goal_title || task.goal_id || "none"}</div>
      <div><b style={{ color: "#93c5fd" }}>Binding</b><br />{short(task.identity_binding.node_id)} / {short(task.identity_binding.agent_id)} / {short(task.identity_binding.task_id)}</div>
      <div><b style={{ color: "#93c5fd" }}>Source hash</b><br />{short(task.source_hash)}</div>
    </div>

    {task.required_capabilities.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {task.required_capabilities.map((capability) => <span key={capability} style={{ padding: "3px 7px", borderRadius: 6, background: "#172238", color: "#93c5fd", fontSize: 11, fontWeight: 800 }}>{capability}</span>)}
    </div>}

    {task.imported_session_id ? <div style={{ color: "#a5b4fc", fontSize: 12 }}>Imported as {task.imported_session_id}</div> : task.importable && <div style={{ display: "grid", gap: 8 }}>
      {confirming ? <div role="dialog" aria-label="Confirm federated task import" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", display: "grid", gap: 8 }}>
        <strong style={{ color: "#fde68a", fontSize: 12 }}>Import verified task into Home?</strong>
        <div style={{ color: "#fef3c7", fontSize: 11, lineHeight: 1.45 }}>This creates one local private desk record. It does not start a connector, claim remote work, publish, share files, or settle payment.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onConfirm} disabled={busy} style={button}>{busy ? "Importing..." : "Confirm import"}</button>
          <button type="button" onClick={onCancel} style={{ ...button, borderColor: "#334155", background: "#111827", color: "#cbd5e1" }}>Cancel</button>
        </div>
      </div> : <button type="button" onClick={() => onReview(task)} disabled={busy} style={button}>Review import</button>}
    </div>}
  </article>;
}

export function FederatedWorkbenchPanel() {
  const [view, setView] = useState<FederatedWorkbenchOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("verified");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [importKeys, setImportKeys] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await api.federatedWorkbench.overview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Federated Workbench unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleTasks = useMemo(() => {
    const tasks = view?.tasks || [];
    return tasks.filter((task) => tab === "verified" ? ["verified", "imported"].includes(task.state) : task.state === tab);
  }, [tab, view]);

  const importTask = async (task: FederatedWorkbenchTask) => {
    const idempotencyKey = importKeys[task.id] || key("fwb-import");
    setImportKeys((current) => ({ ...current, [task.id]: idempotencyKey }));
    setBusyId(task.id);
    setError(null);
    setStatus(null);
    try {
      const result = await api.federatedWorkbench.importTask(task.id, { idempotency_key: idempotencyKey, confirmation: "import-federated-task" });
      setView(result.status);
      setStatus(`Imported ${task.title} into Home.`);
      setConfirmingId(null);
      window.dispatchEvent(new CustomEvent("osa:federated-workbench-import", { detail: { sessionId: result.session.id, taskId: result.task.id, source: task } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !view) return <section data-testid="federated-workbench" style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading federated Workbench...</section>;

  return <section data-testid="federated-workbench" style={{ border: "1px solid #315777", borderRadius: 10, padding: 14, background: "rgba(9,20,34,.96)", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div><strong style={{ fontSize: 17 }}>Federated Workbench</strong><div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Inspectable tasks from other OSA nodes, projected from canonical federation snapshots.</div></div>
      <button type="button" onClick={() => void load()} style={button}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
    <div role="note" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", color: "#fde68a", fontSize: 11, lineHeight: 1.5 }}>Federated task records are external metadata. Import requires confirmation and creates only a private local desk record; no connector, command, file, payment, or remote execution starts here.</div>
    {error && <div role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>}
    {status && <div style={{ color: "#7ee0c2", fontSize: 12 }}>{status}</div>}
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {([
        ["verified", `Verified (${view?.status.verified_count || 0})`],
        ["stale", `Stale (${view?.status.stale_count || 0})`],
        ["untrusted", `Untrusted (${view?.status.untrusted_count || 0})`],
        ["quarantine", `Quarantine (${view?.status.quarantine_count || 0})`],
      ] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} style={{ ...button, borderColor: tab === id ? "#7dd3fc" : "#2563eb", background: tab === id ? "#123a55" : "#172d61" }}>{label}</button>)}
    </div>
    {tab === "quarantine" ? <div style={{ display: "grid", gap: 8 }}>
      {(view?.quarantine || []).length ? view?.quarantine.map((item) => <div key={item.id} style={{ border: "1px solid #7f1d1d", borderRadius: 8, padding: 10, background: "#2a1015", color: "#fecaca", fontSize: 12 }}><b>{item.reason}</b><div style={{ color: "#fca5a5", marginTop: 4 }}>{short(item.origin_node_id)} · {new Date(item.last_seen_at).toLocaleString()}</div></div>) : <div style={{ color: "#64748b", fontSize: 12 }}>No quarantined federated task snapshots.</div>}
    </div> : <div style={{ display: "grid", gap: 10 }}>
      {visibleTasks.length ? visibleTasks.map((task) => <TaskCard key={task.id} task={task} busy={busyId === task.id} confirming={confirmingId === task.id} onReview={(next) => { setImportKeys((current) => ({ ...current, [next.id]: current[next.id] || key("fwb-import") })); setConfirmingId(next.id); }} onConfirm={() => void importTask(task)} onCancel={() => setConfirmingId(null)} />) : <div style={{ color: "#64748b", fontSize: 12 }}>No {tab} federated tasks.</div>}
    </div>}
  </section>;
}
