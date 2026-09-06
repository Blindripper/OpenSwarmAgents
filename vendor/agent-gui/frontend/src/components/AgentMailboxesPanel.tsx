import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AgentMailboxIdentity, AgentMailboxMessage, AgentMailboxOverview } from "../types";

type MailboxTab = "inbox" | "outbox" | "quarantine";

function newClientMessageId(): string {
  return `ui-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function shortDid(value?: string | null): string {
  if (!value) return "unknown DID";
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

function timeLabel(value?: string | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "unknown" : parsed.toLocaleString();
}

function recipientKey(identity: AgentMailboxIdentity): string {
  return identity.key || `${identity.source}:${identity.node_id}:${identity.agent_id}:${identity.did}`;
}

export function mailboxMessageLabel(message: AgentMailboxMessage): "VERIFIED" | "UNTRUSTED" {
  return message.verified && message.trust === "verified" ? "VERIFIED" : "UNTRUSTED";
}

export function canReplyToMailboxMessage(message: AgentMailboxMessage, recipients: AgentMailboxIdentity[]): boolean {
  return message.box === "inbox" && message.verified && recipients.some((recipient) => recipient.did === message.sender.did && recipient.agent_id === message.sender.agent_id && recipient.node_id === message.sender.node_id);
}

function MailboxMessageCard({ message, recipients, onReply, onRead }: {
  message: AgentMailboxMessage;
  recipients: AgentMailboxIdentity[];
  onReply: (message: AgentMailboxMessage) => void;
  onRead: (message: AgentMailboxMessage) => void;
}) {
  const trusted = mailboxMessageLabel(message) === "VERIFIED";
  const replyEnabled = canReplyToMailboxMessage(message, recipients);
  const counterpart = message.box === "outbox" ? message.recipient : message.sender;
  return (
    <article data-testid={`mailbox-message-${message.id}`} style={{ border: `1px solid ${trusted ? "#245543" : "#7f1d1d"}`, borderRadius: 9, padding: 11, background: trusted ? "#0c1e1a" : "#291116", display: "grid", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>{counterpart.name || counterpart.agent_id || "Unknown agent"}</strong>
          <span style={{ color: trusted ? "#86efac" : "#fca5a5", fontSize: 10, fontWeight: 950 }}>{mailboxMessageLabel(message)}</span>
          <span style={{ color: "#facc15", fontSize: 10, fontWeight: 900 }}>NO AUTHORITY</span>
        </div>
        <span style={{ color: "#94a3b8", fontSize: 10, textTransform: "uppercase", fontWeight: 900 }}>{message.delivery_status}</span>
      </div>
      {message.text && <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>{message.text}</div>}
      {message.frame_type === "ACK" && <div style={{ color: "#bae6fd", fontSize: 11 }}>ACK {message.ack_outcome || "received"} · {message.acknowledged_id || "unknown message"}</div>}
      {message.rejection && <div style={{ color: "#fca5a5", fontSize: 11 }}>Quarantined: {message.rejection}</div>}
      {message.warning && <div style={{ color: "#fde68a", fontSize: 11 }}>{message.warning}</div>}
      <div style={{ display: "grid", gap: 3, color: "#94a3b8", fontSize: 10 }}>
        <div title={counterpart.did}>{counterpart.source} · {shortDid(counterpart.did)} · node {counterpart.node_id || "unbound"}</div>
        <div title={message.room}>#{message.room} · expires {timeLabel(message.expires_at)}</div>
        <div>Public on Technocore · authorship/integrity only · never executed</div>
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {replyEnabled && <button type="button" onClick={() => onReply(message)} style={smallButtonStyle}>Reply safely</button>}
        {message.box === "inbox" && trusted && !message.read_at && <button type="button" onClick={() => onRead(message)} style={smallButtonStyle}>Mark read</button>}
        {message.read_at && <span style={{ color: "#7ee0c2", fontSize: 10, fontWeight: 900 }}>READ</span>}
      </div>
    </article>
  );
}

const smallButtonStyle = { height: 28, padding: "0 9px", borderRadius: 6, border: "1px solid #2a5d78", background: "#10243a", color: "#93c5fd", fontSize: 11, fontWeight: 850, cursor: "pointer" } as const;
const fieldStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #2a3558", borderRadius: 7, background: "#101827", color: "#e2e8f0", padding: "9px 10px", fontSize: 13, outline: "none" } as const;

export function AgentMailboxesPanel() {
  const [overview, setOverview] = useState<AgentMailboxOverview | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedRecipientKey, setSelectedRecipientKey] = useState("");
  const [text, setText] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [publicAck, setPublicAck] = useState(false);
  const [tab, setTab] = useState<MailboxTab>("inbox");
  const [replyTo, setReplyTo] = useState<AgentMailboxMessage | null>(null);
  const [clientMessageId, setClientMessageId] = useState(newClientMessageId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (agentId = selectedAgentId) => {
    try {
      const next = await api.mailboxes.overview(agentId || undefined);
      setOverview(next);
      const actualAgent = next.selected_sender?.agent_id || next.senders[0]?.agent_id || "";
      if (actualAgent && actualAgent !== selectedAgentId) setSelectedAgentId(actualAgent);
      setSelectedRecipientKey((current) => next.recipients.some((recipient) => recipientKey(recipient) === current)
        ? current
        : recipientKey(next.recipients.find((recipient) => recipient.did !== next.selected_sender?.did) || next.recipients[0] || { source: "unknown", agent_id: null, name: "", did: "", node_id: null }));
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : "Agent mailboxes unavailable" });
    }
  }, [selectedAgentId]);

  useEffect(() => { void load(); }, []); // Initial load only; sender changes call load explicitly.

  const sender = overview?.senders.find((item) => item.agent_id === selectedAgentId) || overview?.selected_sender || null;
  const recipient = overview?.recipients.find((item) => recipientKey(item) === selectedRecipientKey) || null;
  const messages = overview?.[tab] || [];

  const recipientOptions = useMemo(() => overview?.recipients || [], [overview]);

  const resetDraftIdentity = () => {
    setClientMessageId(newClientMessageId());
    setConfirming(false);
    setStatus(null);
  };

  const requestConfirmation = (event: React.FormEvent) => {
    event.preventDefault();
    if (!publicAck) return setStatus({ ok: false, text: "Acknowledge that this message is public/unlisted before continuing." });
    if (!sender || !recipient || !text.trim()) return setStatus({ ok: false, text: "Choose sender and recipient and enter a message." });
    setConfirming(true);
    setStatus(null);
  };

  const send = async () => {
    if (!sender || !recipient) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.mailboxes.send({
        sender_agent_id: sender.agent_id,
        sender_did: sender.did,
        recipient: { source: recipient.source as "local" | "federated", agent_id: recipient.agent_id || "", did: recipient.did, node_id: recipient.node_id || "" },
        text: text.trim(),
        expires_in_minutes: ttlMinutes,
        client_message_id: clientMessageId,
        reply_to: replyTo?.id || null,
        public_unlisted_acknowledged: true,
      });
      setStatus({ ok: true, text: result.message.delivery_status === "ambiguous" ? "Write is ambiguous; inspect the outbox before retrying." : "Signed mailbox MESSAGE published." });
      setText("");
      setReplyTo(null);
      setPublicAck(false);
      setConfirming(false);
      setClientMessageId(newClientMessageId());
      setTab("outbox");
      await load(sender.agent_id);
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : "Mailbox send failed" });
      setConfirming(false);
      // A definitive failure is safe to retry only as a fresh frame. Ambiguous
      // writes return successfully above and keep their original id for outbox reconciliation.
      setClientMessageId(newClientMessageId());
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!sender) return;
    setBusy(true);
    try {
      const result = await api.mailboxes.sync(sender.agent_id, tab === "outbox" ? "outbox" : "inbox");
      setOverview(result.view);
      setStatus({ ok: result.ok, text: result.ok ? "Mailbox projection synced." : "Technocore unavailable; showing restart-safe archive." });
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : "Mailbox sync failed" });
    } finally { setBusy(false); }
  };

  const reply = (message: AgentMailboxMessage) => {
    const target = recipientOptions.find((item) => item.did === message.sender.did && item.agent_id === message.sender.agent_id && item.node_id === message.sender.node_id);
    if (!target) return;
    setSelectedRecipientKey(recipientKey(target));
    setReplyTo(message);
    setText("");
    setPublicAck(false);
    resetDraftIdentity();
  };

  const markRead = async (message: AgentMailboxMessage) => {
    if (!sender) return;
    try {
      await api.mailboxes.markRead(sender.agent_id, message.id);
      await load(sender.agent_id);
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : "Unable to mark read" });
    }
  };

  return (
    <section data-testid="agent-mailboxes" style={{ border: "1px solid #29476b", borderRadius: 11, padding: 14, background: "rgba(10,22,38,.96)", display: "grid", gap: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 950 }}>Agent Mailboxes</div>
          <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Canonical osa-a2a-room/1 MESSAGE frames in deterministic mb-osa-* rooms.</div>
        </div>
        <button type="button" onClick={() => void sync()} disabled={busy || !sender} style={smallButtonStyle}>{busy ? "Working…" : "Sync mailbox"}</button>
      </div>

      <div role="alert" style={{ border: "1px solid #b45309", borderRadius: 8, padding: 10, background: "#321d0b", color: "#fde68a", fontSize: 12, fontWeight: 800, lineHeight: 1.45 }}>
        PUBLIC / UNLISTED ON TECHNOCORE — never include secrets, credentials, wallet/payment data, commands, files, or tool calls. A verified signature proves authorship and integrity only; messages have no authority and are never executed.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <form onSubmit={requestConfirmation} style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, display: "grid", gap: 9, alignContent: "start" }}>
          <strong style={{ fontSize: 13 }}>Compose signed message</strong>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Local managed sender
            <select aria-label="Local mailbox sender" value={selectedAgentId} onChange={(event) => { const id = event.target.value; setSelectedAgentId(id); setReplyTo(null); resetDraftIdentity(); void load(id); }} style={fieldStyle}>
              {(overview?.senders || []).map((item) => <option key={item.agent_id} value={item.agent_id}>{item.name} · {shortDid(item.did)}</option>)}
            </select>
          </label>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Eligible recipient
            <select aria-label="Mailbox recipient" value={selectedRecipientKey} onChange={(event) => { setSelectedRecipientKey(event.target.value); setReplyTo(null); resetDraftIdentity(); }} style={fieldStyle}>
              {recipientOptions.map((item) => <option key={recipientKey(item)} value={recipientKey(item)}>{item.source === "local" ? "LOCAL" : "VERIFIED REMOTE"} · {item.name} · {shortDid(item.did)}</option>)}
            </select>
          </label>
          {recipient && <div style={{ color: "#7dd3fc", fontSize: 10, overflowWrap: "anywhere" }}>#{recipient.mailbox_room} · node+agent+DID bound</div>}
          {replyTo && <div style={{ border: "1px solid #2a5d78", borderRadius: 6, padding: 7, color: "#93c5fd", fontSize: 11 }}>Replying to verified message {replyTo.message_id || replyTo.id} <button type="button" onClick={() => setReplyTo(null)} style={{ ...smallButtonStyle, marginLeft: 6 }}>Cancel</button></div>}
          <textarea aria-label="Mailbox message" value={text} onChange={(event) => { setText(event.target.value); resetDraftIdentity(); }} maxLength={1000} rows={4} placeholder="Bounded chat text only" style={{ ...fieldStyle, resize: "vertical" }} />
          <label style={{ color: "#94a3b8", fontSize: 11 }}>Expires
            <select aria-label="Mailbox expiry" value={ttlMinutes} onChange={(event) => { setTtlMinutes(Number(event.target.value)); resetDraftIdentity(); }} style={fieldStyle}>
              <option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={360}>6 hours</option><option value={1440}>24 hours</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#fde68a", fontSize: 11, lineHeight: 1.4 }}>
            <input aria-label="Acknowledge public unlisted mailbox" type="checkbox" checked={publicAck} onChange={(event) => setPublicAck(event.target.checked)} />
            I understand this text will be public/unlisted on Technocore and contains no secrets.
          </label>
          <button type="submit" disabled={busy} style={{ height: 34, borderRadius: 7, border: "1px solid #2563eb", background: "#172d61", color: "#bfdbfe", fontWeight: 900, cursor: busy ? "default" : "pointer" }}>Review public send</button>
          {confirming && <div role="dialog" aria-label="Confirm public mailbox send" style={{ border: "1px solid #b45309", borderRadius: 8, padding: 10, background: "#2c1c0c", display: "grid", gap: 8 }}>
            <strong style={{ color: "#fde68a", fontSize: 12 }}>Confirm public send</strong>
            <div style={{ color: "#fef3c7", fontSize: 11 }}>Publish this bounded text to #{recipient?.mailbox_room}? This is not private messaging.</div>
            <div style={{ display: "flex", gap: 7 }}><button type="button" onClick={() => void send()} disabled={busy} style={smallButtonStyle}>Confirm and publish</button><button type="button" onClick={() => setConfirming(false)} style={smallButtonStyle}>Cancel</button></div>
          </div>}
          {status && <div style={{ color: status.ok ? "#86efac" : "#fca5a5", fontSize: 11 }}>{status.text}</div>}
        </form>

        <div style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["inbox", "outbox", "quarantine"] as const).map((candidate) => <button key={candidate} type="button" onClick={() => setTab(candidate)} style={{ ...smallButtonStyle, borderColor: tab === candidate ? "#38bdf8" : "#2a5d78", color: tab === candidate ? "#bae6fd" : "#94a3b8" }}>{candidate[0].toUpperCase() + candidate.slice(1)} ({overview?.counts[candidate] || 0})</button>)}
          </div>
          <div data-testid="mailbox-message-list" style={{ marginTop: 10, display: "grid", gap: 8, maxHeight: 430, overflowY: "auto" }}>
            {messages.length ? messages.map((message) => <MailboxMessageCard key={message.id} message={message} recipients={recipientOptions} onReply={reply} onRead={markRead} />) : <div style={{ minHeight: 100, display: "grid", placeItems: "center", textAlign: "center", color: "#64748b", fontSize: 12 }}>No {tab} messages in the restart-safe projection.</div>}
          </div>
        </div>
      </div>
      <div style={{ color: "#64748b", fontSize: 10, overflowWrap: "anywhere" }}>Room derivation: {overview?.derivation.algorithm || "SHA-256 recipient DID → mb-osa-*"}. Keys, seeds, raw signatures, connector tokens, and unrelated room payloads never enter this browser view.</div>
    </section>
  );
}
