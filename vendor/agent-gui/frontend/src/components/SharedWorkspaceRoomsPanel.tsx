import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { SharedWorkspaceOverview, SharedWorkspaceRoom } from "../types";

const field = { width: "100%", boxSizing: "border-box", border: "1px solid #2a3558", borderRadius: 7, background: "#101827", color: "#e2e8f0", padding: "9px 10px", fontSize: 12 } as const;
const button = { height: 31, padding: "0 11px", borderRadius: 6, border: "1px solid #2563eb", background: "#172d61", color: "#bfdbfe", fontSize: 11, fontWeight: 900, cursor: "pointer" } as const;

function key(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
function short(value?: string | null) { return !value ? "unknown" : value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value; }

export function SharedWorkspaceRoomsPanel() {
  const [view, setView] = useState<SharedWorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [createKey, setCreateKey] = useState(() => key("shared-workspace"));
  const [selectedRoom, setSelectedRoom] = useState("");
  const [noteAgent, setNoteAgent] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteAck, setNoteAck] = useState(false);
  const [noteConfirming, setNoteConfirming] = useState(false);
  const [noteKey, setNoteKey] = useState(() => key("shared-note"));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await api.sharedWorkspaces.overview();
      setView(next);
      setSessionId((current) => current || next.workspaces[0]?.id || "");
      setTitle((current) => current || next.workspaces[0]?.title || "Shared Workspace");
      setMembers((current) => {
        if (current.length) return current;
        const ownAgentId = next.workspaces[0]?.agent_id;
        const local = next.candidates.filter((item) => item.source === "local");
        const own = local.find((item) => item.agent_id === ownAgentId);
        return [own, ...local.filter((item) => item !== own)].slice(0, 2).map((item) => item?.key || "").filter(Boolean);
      });
      setSelectedRoom((current) => current || next.rooms[0]?.workspace_id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Shared Workspaces unavailable"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const room = useMemo(() => view?.rooms.find((item) => item.workspace_id === selectedRoom) || view?.rooms[0] || null, [view, selectedRoom]);
  const localRoomMembers = room?.members.filter((member) => member.source === "local") || [];

  const createRoom = async () => {
    if (!sessionId || !title.trim() || !members.length) return setError("Choose a private Workspace, title, and at least one verified member.");
    setBusy(true); setError(null);
    try {
      const result = await api.sharedWorkspaces.create({ session_id: sessionId, title: title.trim(), member_keys: members, idempotency_key: createKey, expires_days: 7, private_room_warning_acknowledged: true, share_confirmation: true });
      setStatus(`Opened #${result.room.room}.`); setSelectedRoom(result.room.workspace_id); setConfirming(false); setAck(false); setCreateKey(key("shared-workspace"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open shared Workspace"); }
    finally { setBusy(false); }
  };

  const publishNote = async () => {
    if (!room || !noteAgent || !noteText.trim()) return setError("Choose a local room member and enter a bounded note.");
    setBusy(true); setError(null);
    try {
      await api.sharedWorkspaces.publishNote(room.workspace_id, { agent_id: noteAgent, text: noteText.trim(), idempotency_key: noteKey, private_room_warning_acknowledged: true, publish_confirmation: true });
      setStatus(`Published signed note to #${room.room}.`); setNoteText(""); setNoteAck(false); setNoteConfirming(false); setNoteKey(key("shared-note"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to publish room note"); }
    finally { setBusy(false); }
  };

  const toggle = (candidateKey: string) => setMembers((current) => current.includes(candidateKey) ? current.filter((item) => item !== candidateKey) : [...current, candidateKey]);

  return <section data-testid="shared-workspaces" style={{ border: "1px solid #315777", borderRadius: 11, padding: 14, background: "rgba(9,20,34,.96)", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div><strong style={{ fontSize: 17 }}>Shared Workspace Rooms</strong><div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Signed bounded coordination in private-name <code>p-osa-ws-&lt;uuid&gt;</code> team rooms.</div></div>
      <div style={{ display: "flex", gap: 7 }}><button type="button" style={button} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button><button type="button" style={button} onClick={() => api.sharedWorkspaces.scan().then((next) => { setView(next); setStatus("Shared room scan completed."); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Scan failed"))}>Scan rooms</button></div>
    </div>
    <div role="note" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 10, background: "#2b210c", color: "#fde68a", fontSize: 11, lineHeight: 1.5 }}>PRIVATE-NAME / UNLISTED, NOT CONFIDENTIAL. Anyone who learns the room name may read it. Signatures prove authorship and integrity only. No files, credentials, commands, remote execution, authority, payment, or settlement.</div>
    {error && <div role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>}
    {status && <div style={{ color: "#7ee0c2", fontSize: 12 }}>{status}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!ack) return setError("Acknowledge the private-name disclosure first."); setConfirming(true); }} style={{ border: "1px solid #273453", borderRadius: 9, padding: 11, display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Open a team room</strong>
        <select aria-label="Shared Workspace" value={sessionId} onChange={(event) => { setSessionId(event.target.value); const selected = view?.workspaces.find((item) => item.id === event.target.value); if (selected) { setTitle(selected.title); const own = view?.candidates.find((item) => item.source === "local" && item.agent_id === selected.agent_id); if (own?.key) setMembers((current) => current.includes(own.key!) ? current : [own.key!, ...current].slice(0, 16)); } }} style={field}>{view?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.agent_id || "agent"}</option>)}</select>
        <input aria-label="Shared room title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} style={field} />
        <div style={{ display: "grid", gap: 5, maxHeight: 150, overflow: "auto" }}>{view?.candidates.map((candidate) => <label key={candidate.key || candidate.did} style={{ display: "flex", gap: 7, color: "#cbd5e1", fontSize: 11 }}><input type="checkbox" aria-label={`Member ${candidate.name}`} checked={members.includes(candidate.key || "")} onChange={() => toggle(candidate.key || "")} />{candidate.source === "local" ? "LOCAL" : "VERIFIED REMOTE"} · {candidate.name} · {short(candidate.did)}</label>)}</div>
        <label style={{ display: "flex", gap: 7, color: "#fde68a", fontSize: 11 }}><input type="checkbox" aria-label="Acknowledge shared room disclosure" checked={ack} onChange={(event) => setAck(event.target.checked)} />I understand this room is unlisted but not confidential.</label>
        <button type="submit" disabled={busy} style={button}>Review team room</button>
        {confirming && <div role="dialog" aria-label="Confirm shared Workspace room" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 9, background: "#2b210c", display: "grid", gap: 7 }}><b style={{ color: "#fde68a", fontSize: 12 }}>Open signed shared room?</b><span style={{ color: "#fef3c7", fontSize: 11 }}>Only room metadata and selected public member identities are published; Workspace content and files stay local.</span><div style={{ display: "flex", gap: 7 }}><button type="button" onClick={() => void createRoom()} style={button}>{busy ? "Opening…" : "Confirm and open"}</button><button type="button" onClick={() => setConfirming(false)} style={button}>Cancel</button></div></div>}
      </form>

      <div style={{ border: "1px solid #273453", borderRadius: 9, padding: 11, display: "grid", gap: 8, alignContent: "start" }}>
        <strong style={{ fontSize: 13 }}>Team rooms ({view?.status.room_count || 0})</strong>
        <select aria-label="Shared room" value={room?.workspace_id || ""} onChange={(event) => { setSelectedRoom(event.target.value); setNoteAgent(""); }} style={field}>{view?.rooms.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.title} · #{item.room}</option>)}</select>
        {!room ? <div style={{ color: "#64748b", fontSize: 12 }}>No shared rooms yet.</div> : <>
          <div style={{ color: "#94a3b8", fontSize: 11 }}>#{room.room} · {room.members.length} members · {room.event_count} verified events · {room.quarantine_count} quarantined</div>
          <div style={{ maxHeight: 180, overflow: "auto", display: "grid", gap: 5 }}>{room.events.map((event) => <div key={event.event_id} style={{ border: `1px solid ${event.verified ? "#1f6f4a" : "#7f1d1d"}`, borderRadius: 7, padding: 7, color: event.verified ? "#d1fae5" : "#fecaca", fontSize: 11 }}><b>{event.type} · {event.verified ? "VERIFIED MEMBER" : "QUARANTINED"}</b><div>{event.text || event.rejection || "Room opened"}</div><div style={{ color: "#64748b" }}>{short(event.sender_did)}</div></div>)}</div>
          <select aria-label="Room note signer" value={noteAgent} onChange={(event) => setNoteAgent(event.target.value)} style={field}><option value="">Choose local member…</option>{localRoomMembers.map((member) => <option key={member.did} value={member.agent_id}>{member.name}</option>)}</select>
          <textarea aria-label="Shared room note" value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} maxLength={1200} style={{ ...field, resize: "vertical" }} placeholder="Bounded coordination text only." />
          <label style={{ display: "flex", gap: 7, color: "#fde68a", fontSize: 11 }}><input type="checkbox" aria-label="Acknowledge shared note disclosure" checked={noteAck} onChange={(event) => setNoteAck(event.target.checked)} />Publish this text to the unlisted room.</label>
          <button type="button" onClick={() => { if (!noteAck) return setError("Acknowledge the note disclosure first."); setNoteConfirming(true); }} style={button}>Review signed note</button>
          {noteConfirming && <div role="dialog" aria-label="Confirm shared room note" style={{ border: "1px solid #854d0e", borderRadius: 8, padding: 9, background: "#2b210c", display: "grid", gap: 7 }}><span style={{ color: "#fef3c7", fontSize: 11 }}>Publish exactly this bounded text under the selected member DID?</span><div style={{ display: "flex", gap: 7 }}><button type="button" onClick={() => void publishNote()} style={button}>{busy ? "Publishing…" : "Confirm and publish"}</button><button type="button" onClick={() => setNoteConfirming(false)} style={button}>Cancel</button></div></div>}
        </>}
      </div>
    </div>
  </section>;
}
