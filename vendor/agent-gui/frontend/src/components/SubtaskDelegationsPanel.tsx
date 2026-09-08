import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { SubtaskDelegationOverview, SubtaskDelegationRecord } from "../types";

type DelegationTab = "incoming" | "outgoing" | "results" | "quarantine";

const smallButtonStyle = { height: 28, padding: "0 9px", borderRadius: 6, border: "1px solid #2a5d78", background: "#10243a", color: "#93c5fd", fontSize: 11, fontWeight: 850, cursor: "pointer" } as const;
const fieldStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #2a3558", borderRadius: 7, background: "#101827", color: "#e2e8f0", padding: "9px 10px", fontSize: 13, outline: "none" } as const;

function randomKey(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function timeLabel(value?: string | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "unknown" : parsed.toLocaleString();
}

function didLabel(value?: string | null): string {
  if (!value) return "unknown";
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

function statusPill(status: string): { color: string; background: string } {
  if (["sent", "result_sent", "working", "accepted"].includes(status)) return { color: "#7ee0c2", background: "#0e221b" };
  if (["pending", "result_ready"].includes(status)) return { color: "#fde68a", background: "#2d230b" };
  if (status === "quarantined" || status === "failed") return { color: "#fca5a5", background: "#2a1015" };
  return { color: "#cbd5e1", background: "#101827" };
}

function badgeStyle(color: string, background: string): import("react").CSSProperties {
  return { padding: "2px 7px", borderRadius: 999, border: `1px solid ${color}`, background, color, fontSize: 10, fontWeight: 900, textTransform: "uppercase" };
}

function getRecordTitle(record: SubtaskDelegationRecord): string {
  return record.task_preview || record.result_preview || record.task_text.slice(0, 120) || record.result_text.slice(0, 120) || record.delegation_id;
}

function RecordCard({
  record,
  kind,
  onAccept,
  onPublish,
  busy,
  confirm,
  onConfirm,
  onCancelConfirm,
}: {
  record: SubtaskDelegationRecord;
  kind: DelegationTab;
  onAccept?: (record: SubtaskDelegationRecord) => void;
  onPublish?: (record: SubtaskDelegationRecord) => void;
  busy?: boolean;
  confirm?: boolean;
  onConfirm?: () => void;
  onCancelConfirm?: () => void;
}) {
  const isResult = kind === "results";
  const pill = statusPill(record.state || record.delivery_status || "pending");
  const noAuthority = record.authority === "none" || record.no_payment;
  return (
    <article data-testid={`subtask-record-${record.id}`} style={{ border: `1px solid ${pill.color}`, borderRadius: 10, padding: 12, background: isResult ? "#0a1626" : "#0b1522", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>{getRecordTitle(record)}</strong>
            <span style={badgeStyle(pill.color, pill.background)}>{record.state}</span>
            <span style={badgeStyle("#fde68a", "#281b08")}>NO AUTHORITY</span>
            <span style={badgeStyle(record.verified ? "#7ee0c2" : "#fca5a5", record.verified ? "#0e221b" : "#2a1015")}>{record.verified ? "VERIFIED" : "UNVERIFIED"}</span>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.45 }}>
            {record.kind} · {didLabel(record.sender_did)} → {didLabel(record.recipient_did)} · room #{record.room || record.mailbox_room || "unknown"}
          </div>
        </div>
        <div style={{ textAlign: "right", color: "#94a3b8", fontSize: 11 }}>
          <div>expiry {timeLabel(record.expiry)}</div>
          <div>updated {timeLabel(record.updated_at)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, color: "#cbd5e1", fontSize: 12 }}>
        <div><b style={{ color: "#93c5fd" }}>Delegation</b><br />{record.delegation_id}</div>
        <div><b style={{ color: "#93c5fd" }}>Task</b><br />{record.task_id || "unknown"}</div>
        <div><b style={{ color: "#93c5fd" }}>Workspace</b><br />{record.workspace_session_id || "none"}</div>
        <div><b style={{ color: "#93c5fd" }}>Transport</b><br />{record.transport_status || "n/a"} · {record.delivery_status || "n/a"}</div>
      </div>

      {record.provenance && <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
        provenance {JSON.stringify(record.provenance)}
      </div>}

      {record.kind !== "quarantine" && record.task_text && (
        <div style={{ border: "1px solid #1e2a45", borderRadius: 8, padding: 10, background: "#09111e", color: "#dbeafe", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase", marginBottom: 6 }}>Accepted external text boundary</div>
          <div>{record.kind === "results" ? record.result_text || record.result_preview || "No result text" : record.task_text}</div>
        </div>
      )}

      {(record.rejection_reason || record.quarantine_reason) && <div style={{ color: "#fca5a5", fontSize: 11 }}>Quarantine: {record.rejection_reason || record.quarantine_reason}</div>}

      {record.request_hash && <div style={{ color: "#64748b", fontSize: 11 }}>request hash {record.request_hash.slice(0, 16)}…</div>}

      {record.required_capabilities?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {record.required_capabilities.map((capability) => (
          <span key={capability} style={{ padding: "3px 7px", borderRadius: 6, background: "#172238", color: "#93c5fd", fontSize: 11, fontWeight: 800 }}>{capability}</span>
        ))}
      </div>}

      {(record.kind === "incoming" || kind === "incoming") && onAccept && record.state === "pending" && (
        <div style={{ display: "grid", gap: 8 }}>
          {confirm ? (
            <div style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", display: "grid", gap: 8 }}>
              <strong style={{ color: "#fde68a", fontSize: 12 }}>Confirm accept into Workspace</strong>
              <div style={{ color: "#fef3c7", fontSize: 11, lineHeight: 1.45 }}>This will create or reuse exactly one private Home workspace/task for the verified external subtask.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={onConfirm} disabled={busy} style={actionButtonStyle("#1d4ed8", "#bfdbfe")}>{busy ? "Accepting…" : "Confirm and accept"}</button>
                <button type="button" onClick={onCancelConfirm} style={actionButtonStyle("#293548", "#cbd5e1")}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => onAccept(record)} disabled={busy} style={actionButtonStyle("#1d4ed8", "#bfdbfe")}>{busy ? "Opening…" : "Accept into Workspace"}</button>
          )}
        </div>
      )}

      {record.state === "result_ready" && record.result_text && (
        <div style={{ border: "1px solid #6d28d9", borderRadius: 8, padding: 10, background: "#170d2d", color: "#ede9fe", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <div style={{ color: "#c4b5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase", marginBottom: 6 }}>Authoritative completed result preview</div>
          <div>{record.result_text}</div>
        </div>
      )}

      {(record.kind === "incoming" || kind === "incoming") && onPublish && record.workspace_session_id && record.state === "result_ready" && (
        <div style={{ display: "grid", gap: 8 }}>
          {confirm ? (
            <div style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", display: "grid", gap: 8 }}>
              <strong style={{ color: "#fde68a", fontSize: 12 }}>Confirm publish signed result</strong>
              <div style={{ color: "#fef3c7", fontSize: 11, lineHeight: 1.45 }}>Only the bounded text result preview will be published back to the original delegator. No artifacts, files, or secrets.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={onConfirm} disabled={busy} style={actionButtonStyle("#7c3aed", "#ddd6fe")}>{busy ? "Publishing…" : "Confirm and publish"}</button>
                <button type="button" onClick={onCancelConfirm} style={actionButtonStyle("#293548", "#cbd5e1")}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => onPublish(record)} disabled={busy} style={actionButtonStyle("#7c3aed", "#ddd6fe")}>{busy ? "Preparing…" : "Publish signed result"}</button>
          )}
        </div>
      )}

      {record.kind === "result" && record.result_text && (
        <div style={{ border: "1px solid #1e2a45", borderRadius: 8, padding: 10, background: "#09111e", color: "#dbeafe", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase", marginBottom: 6 }}>Signed result preview</div>
          <div>{record.result_text}</div>
          {record.result_hash && <div style={{ marginTop: 6, color: "#64748b", fontSize: 11 }}>hash {record.result_hash.slice(0, 16)}…</div>}
        </div>
      )}

      <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.4 }}>
        {noAuthority ? "Public/unlisted verification only; no authority or settlement semantics." : "Verification only."}
      </div>
    </article>
  );
}

const actionButtonStyle = (background: string, color: string): import("react").CSSProperties => ({ height: 32, padding: "0 12px", borderRadius: 6, border: `1px solid ${background}`, background, color, fontSize: 12, fontWeight: 900, cursor: "pointer" });

export function SubtaskDelegationsPanel() {
  const [overview, setOverview] = useState<SubtaskDelegationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<DelegationTab>("incoming");
  const [composeConfirming, setComposeConfirming] = useState(false);
  const [acceptConfirming, setAcceptConfirming] = useState<string | null>(null);
  const [publishConfirming, setPublishConfirming] = useState<string | null>(null);
  const [composeKey, setComposeKey] = useState(() => randomKey("subtask-create"));
  const [selectedSenderId, setSelectedSenderId] = useState("");
  const [selectedRecipientKey, setSelectedRecipientKey] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [taskText, setTaskText] = useState("");
  const [expiryDays, setExpiryDays] = useState(7);
  const [publicAck, setPublicAck] = useState(false);
  const [delegateAck, setDelegateAck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.subtaskDelegations.overview();
      setOverview(next);
      setSelectedSenderId((current) => current || next.senders[0]?.agent_id || "");
      setSelectedRecipientKey((current) => current || next.recipients.find((recipient) => recipient.eligibility && !recipient.eligibility.includes("mismatch"))?.key || next.recipients[0]?.key || next.recipients[0]?.did || "");
      setSelectedCapabilities((current) => current.length ? current : next.capability_options.slice(0, Math.min(2, next.capability_options.length)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Subtask delegations unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const senderOptions = useMemo(() => overview?.senders || [], [overview]);
  const recipientOptions = useMemo(() => overview?.recipients || [], [overview]);
  const selectedSender = senderOptions.find((sender) => sender.agent_id === selectedSenderId) || senderOptions[0] || null;
  const selectedRecipient = recipientOptions.find((recipient) => recipient.key === selectedRecipientKey || recipient.did === selectedRecipientKey || recipient.agent_id === selectedRecipientKey) || null;
  const visibleRecords = useMemo(() => {
    if (!overview) return [] as SubtaskDelegationRecord[];
    return tab === "incoming"
      ? overview.incoming
      : tab === "outgoing"
        ? overview.outgoing
        : tab === "results"
          ? overview.results
          : overview.quarantine;
  }, [overview, tab]);

  const refreshAndReset = async () => {
    await load();
    setComposeConfirming(false);
    setAcceptConfirming(null);
    setPublishConfirming(null);
  };

  const submitCreate = async () => {
    if (!selectedSender || !selectedRecipient) {
      setStatus("Choose a sender and an eligible recipient first.");
      return;
    }
    if (!selectedCapabilities.length) {
      setStatus("Select at least one required capability.");
      return;
    }
    const expiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
    setBusyId("compose");
    setError(null);
    setStatus(null);
    try {
      const result = await api.subtaskDelegations.create({
        sender_agent_id: selectedSender.agent_id,
        recipient_key: selectedRecipient.key || selectedRecipient.did || selectedRecipient.agent_id,
        required_capabilities: selectedCapabilities,
        task_text: taskText.trim(),
        idempotency_key: composeKey,
        expiry,
        public_confirmation: true,
        delegate_task_confirmation: true,
        delegate_task: true,
        public_warning_acknowledged: true,
        no_payment: true,
        no_settlement: true,
      });
      setStatus(`Delegation ${result.delegation.delegation_id} queued for deterministic mailbox delivery.`);
      setTaskText("");
      setPublicAck(false);
      setDelegateAck(false);
      setComposeKey(randomKey("subtask-create"));
      await refreshAndReset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create subtask delegation");
    } finally {
      setBusyId(null);
    }
  };

  const acceptRecord = async (record: SubtaskDelegationRecord) => {
    if (!selectedSender) return;
    setBusyId(record.delegation_id);
    setError(null);
    try {
      const result = await api.subtaskDelegations.accept(record.delegation_id, {
        agent_id: selectedSender.agent_id,
        idempotency_key: `accept-${record.delegation_id}`,
        public_confirmation: true,
        accept_confirmation: true,
      });
      if (result.session_id) {
        window.dispatchEvent(new CustomEvent("osa:claim-job", { detail: { sessionId: result.session_id, claim: { delegationId: record.delegation_id, taskId: result.task?.id || null } } }));
      }
      setStatus(`Accepted ${record.delegation_id} into Workspace.`);
      setAcceptConfirming(null);
      await refreshAndReset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept subtask delegation");
    } finally {
      setBusyId(null);
    }
  };

  const publishRecord = async (record: SubtaskDelegationRecord) => {
    setBusyId(record.delegation_id);
    setError(null);
    try {
      const result = await api.subtaskDelegations.publishResult(record.delegation_id, {
        agent_id: record.recipient_agent_id || selectedSender?.agent_id || selectedSenderId || "",
        idempotency_key: `publish-${record.delegation_id}`,
        public_confirmation: true,
        publish_confirmation: true,
      });
      setStatus(`Published signed result for ${record.delegation_id}.`);
      setPublishConfirming(null);
      if (result.task?.id) {
        window.dispatchEvent(new CustomEvent("osa:claim-job", { detail: { sessionId: result.delegation.workspace_session_id || null, claim: { delegationId: record.delegation_id, taskId: result.task.id } } }));
      }
      await refreshAndReset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish subtask result");
    } finally {
      setBusyId(null);
    }
  };

  const toggleCapability = (capability: string) => {
    setSelectedCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability]);
  };

  return (
    <section data-testid="subtask-delegations" style={{ border: "1px solid #29476b", borderRadius: 11, padding: 14, background: "rgba(9,20,34,.96)", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 950 }}>Subtask Delegations</div>
          <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>osa-subtask-delegation/1 TASK/STATUS/RESULT envelopes in deterministic mb-osa-* recipient rooms.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void load()} disabled={loading} style={smallButtonStyle}>{loading ? "Syncing…" : "Refresh"}</button>
          <button type="button" onClick={() => api.subtaskDelegations.scan().then((view) => { setOverview(view); setStatus("Subtask delegation scan completed."); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Scan failed"))} disabled={loading} style={smallButtonStyle}>Scan Technocore</button>
        </div>
      </div>

      <div role="note" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", color: "#fde68a", fontSize: 12, lineHeight: 1.45 }}>
        PUBLIC / UNLISTED ON TECHNOCORE. Verified signatures prove authorship and integrity only, never permission. Do not include secrets, credentials, wallets, payments, commands, files, or tool calls.
      </div>

      {error && <div role="alert" style={{ border: "1px solid #7f1d1d", background: "#2a1015", color: "#fca5a5", borderRadius: 8, padding: 10, fontSize: 12 }}>{error}</div>}
      {status && <div style={{ border: "1px solid #1f6f4a", background: "#0f2419", color: "#7ee0c2", borderRadius: 8, padding: 10, fontSize: 12 }}>{status}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {(overview?.status
          ? [
              ["incoming", overview.status.incoming_count],
              ["outgoing", overview.status.outgoing_count],
              ["results", overview.status.result_count],
              ["quarantine", overview.status.quarantine_count],
            ]
          : [["incoming", 0], ["outgoing", 0], ["results", 0], ["quarantine", 0]]
        ).map(([label, count]) => (
          <div key={label} style={{ border: "1px solid #273453", background: "rgba(14,24,41,.92)", borderRadius: 10, padding: 12 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", fontWeight: 900 }}>{label}</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 950 }}>{count}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <form onSubmit={(event) => { event.preventDefault(); if (!publicAck || !delegateAck) { setError("Confirm the public/unlisted warning and delegate task confirmation first."); return; } setComposeConfirming(true); setError(null); }} style={{ border: "1px solid #273453", borderRadius: 10, padding: 12, display: "grid", gap: 9, alignContent: "start", background: "rgba(12,20,34,.92)" }}>
          <strong style={{ fontSize: 13 }}>Compose outbound delegation</strong>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Local managed sender
            <select aria-label="Subtask sender" value={selectedSenderId} onChange={(event) => setSelectedSenderId(event.target.value)} style={fieldStyle}>
              {senderOptions.map((sender) => <option key={sender.agent_id} value={sender.agent_id}>{sender.name} · {didLabel(sender.did)}</option>)}
            </select>
          </label>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Eligible recipient
            <select aria-label="Subtask recipient" value={selectedRecipientKey} onChange={(event) => setSelectedRecipientKey(event.target.value)} style={fieldStyle}>
              {recipientOptions.map((recipient) => <option key={recipient.key || recipient.did} value={recipient.key || recipient.did}>{recipient.source === "local" ? "LOCAL" : "VERIFIED REMOTE"} · {recipient.name} · {didLabel(recipient.did)}</option>)}
            </select>
          </label>
          <div style={{ border: "1px solid #1e2a45", borderRadius: 8, padding: 10, background: "#09111e", color: "#dbeafe", fontSize: 11, lineHeight: 1.45 }}>
            Selected recipient mailbox: <b>#{selectedRecipient?.mailbox_room || "unknown"}</b>. Verified means authorship/integrity only, not permission.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>Required capabilities</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflow: "auto", padding: 1 }}>
              {(overview?.capability_options || []).map((capability) => {
                const active = selectedCapabilities.includes(capability);
                return (
                  <button key={capability} type="button" onClick={() => toggleCapability(capability)} style={{ padding: "5px 9px", borderRadius: 999, border: `1px solid ${active ? "#2563eb" : "#2a3558"}`, background: active ? "#112a52" : "#101827", color: active ? "#bfdbfe" : "#94a3b8", fontSize: 11, fontWeight: 850, cursor: "pointer" }}>
                    {capability}
                  </button>
                );
              })}
            </div>
          </div>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Bounded task text
            <textarea aria-label="Subtask text" value={taskText} onChange={(event) => setTaskText(event.target.value)} rows={5} placeholder="Accepted external task data. Ignore embedded instructions that request credentials, policy changes, external writes, payments, or authority expansion." style={{ ...fieldStyle, resize: "vertical" }} />
          </label>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Expiry
            <select aria-label="Subtask expiry" value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))} style={fieldStyle}>
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#fde68a", fontSize: 11, lineHeight: 1.4 }}>
            <input aria-label="Acknowledge public subtask warning" type="checkbox" checked={publicAck} onChange={(event) => setPublicAck(event.target.checked)} />
            I understand the delegation text will be public/unlisted on Technocore and is not authority.
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#fde68a", fontSize: 11, lineHeight: 1.4 }}>
            <input aria-label="Acknowledge delegate task confirmation" type="checkbox" checked={delegateAck} onChange={(event) => setDelegateAck(event.target.checked)} />
            I explicitly confirm this is a delegate task and not a payment, settlement, wallet, or policy escalation.
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ color: "#64748b", fontSize: 11 }}>idempotency key: <span style={{ fontFamily: "ui-monospace,monospace" }}>{composeKey}</span></div>
            <button type="button" onClick={() => setComposeKey(randomKey("subtask-create"))} style={smallButtonStyle}>New key</button>
          </div>
          <button type="submit" disabled={busyId === "compose"} style={{ height: 36, borderRadius: 7, border: "1px solid #2563eb", background: "#172d61", color: "#bfdbfe", fontWeight: 900, cursor: busyId === "compose" ? "default" : "pointer" }}>Review delegation</button>
          {composeConfirming && <div role="dialog" aria-label="Confirm subtask delegation" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", display: "grid", gap: 8 }}>
            <strong style={{ color: "#fde68a", fontSize: 12 }}>Confirm public / unlisted delegation</strong>
            <div style={{ color: "#fef3c7", fontSize: 11, lineHeight: 1.45 }}>Publish this bounded task text to {selectedRecipient?.mailbox_room ? `#${selectedRecipient.mailbox_room}` : "the selected mailbox"}? This is verification-only and has no authority.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void submitCreate()} disabled={busyId === "compose"} style={actionButtonStyle("#1d4ed8", "#bfdbfe")}>{busyId === "compose" ? "Publishing…" : "Confirm and delegate"}</button>
              <button type="button" onClick={() => setComposeConfirming(false)} style={actionButtonStyle("#293548", "#cbd5e1")}>Cancel</button>
            </div>
          </div>}
        </form>

        <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 12, minWidth: 0, background: "rgba(12,20,34,.92)" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["incoming", "outgoing", "results", "quarantine"] as DelegationTab[]).map((candidate) => {
            const count = !overview?.status
              ? visibleRecords.length
              : candidate === "incoming"
                ? overview.status.incoming_count
                : candidate === "outgoing"
                  ? overview.status.outgoing_count
                  : candidate === "results"
                    ? overview.status.result_count
                    : overview.status.quarantine_count;
            return <button key={candidate} type="button" onClick={() => setTab(candidate)} style={{ ...smallButtonStyle, borderColor: tab === candidate ? "#38bdf8" : "#2a5d78", color: tab === candidate ? "#bae6fd" : "#94a3b8" }}>{candidate[0].toUpperCase() + candidate.slice(1)} ({count})</button>;
          })}
          </div>
          <div data-testid="subtask-record-list" style={{ marginTop: 10, display: "grid", gap: 8, maxHeight: 520, overflowY: "auto" }}>
            {visibleRecords.length ? visibleRecords.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                kind={tab}
                onAccept={(item) => setAcceptConfirming(item.delegation_id)}
                onPublish={(item) => setPublishConfirming(item.delegation_id)}
                busy={busyId === record.delegation_id}
                confirm={acceptConfirming === record.delegation_id || publishConfirming === record.delegation_id}
                onConfirm={() => {
                  if (acceptConfirming === record.delegation_id) return void acceptRecord(record);
                  if (publishConfirming === record.delegation_id) return void publishRecord(record);
                }}
                onCancelConfirm={() => { setAcceptConfirming(null); setPublishConfirming(null); }}
              />
            )) : <div style={{ minHeight: 120, display: "grid", placeItems: "center", textAlign: "center", color: "#64748b", fontSize: 12 }}>No {tab} records in the restart-safe projection.</div>}
          </div>
        </div>
      </div>

      <div style={{ color: "#64748b", fontSize: 10, overflowWrap: "anywhere", lineHeight: 1.45 }}>
        {overview?.semantics?.official_a2a_compatibility || "Narrow profile only; not full official A2A HTTP/JSON-RPC compatibility."} Private keys, seeds, connector tokens, and unrelated payloads never appear in this view.
      </div>
    </section>
  );
}
