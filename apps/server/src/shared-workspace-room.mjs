import { createHash } from "node:crypto";

export const SHARED_WORKSPACE_PROFILE = "osa-shared-workspace/1";
export const SHARED_WORKSPACE_PREFIX = "OSA-WS/1";
export const SHARED_WORKSPACE_EVENT_TYPES = Object.freeze(["OPEN", "NOTE"]);
export const SHARED_WORKSPACE_LIMITS = Object.freeze({ maxWireBytes: 4096, maxTextBytes: 1200, maxTitleBytes: 120, maxMembers: 16, maxEvents: 500 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DID = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,180}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SENSITIVE = /(?:-----BEGIN|private\s*key|secret\s*[:=]|seed\s*(?:phrase)?\s*[:=]|password\s*[:=]|bearer\s+[A-Za-z0-9._~-]{12,}|osa_conn_|wallet\s*(?:seed|key)|\b(?:transfer|settle|refund)\s+(?:funds?|tokens?|flop)\b)/i;

export function sharedWorkspaceRoom(workspaceId) {
  const id = String(workspaceId || "").toLowerCase();
  if (!UUID.test(id)) fail("invalid_workspace_id");
  return `p-osa-ws-${id}`;
}

export function composeSharedWorkspaceOpen(input = {}, options = {}) {
  const createdAt = timestamp(input.createdAt || new Date(options.nowMs ?? Date.now()).toISOString(), "created_at");
  const expiresAt = futureTimestamp(input.expiresAt, options.nowMs ?? Date.now(), "expires_at");
  const workspaceId = workspaceIdValue(input.workspaceId);
  const room = sharedWorkspaceRoom(workspaceId);
  const members = normalizeMembers(input.members);
  const payload = {
    schema: SHARED_WORKSPACE_PROFILE,
    type: "OPEN",
    workspace_id: workspaceId,
    room,
    session_id: token(input.sessionId, "session_id", 180),
    title: narrative(input.title, "title", SHARED_WORKSPACE_LIMITS.maxTitleBytes),
    owner_node_id: token(input.ownerNodeId, "owner_node_id", 120),
    owner_node_did: did(input.ownerNodeDid, "owner_node_did"),
    sender_did: did(input.senderDid, "sender_did"),
    members,
    created_at: createdAt,
    expires_at: expiresAt,
    authority: "coordination_only",
    remote_execution: false,
    files_shared: false,
    no_payment: true,
    no_settlement: true,
  };
  if (payload.sender_did !== payload.owner_node_did) fail("owner_sender_mismatch");
  return finalize(payload);
}

export function composeSharedWorkspaceNote(input = {}, options = {}) {
  const createdAt = timestamp(input.createdAt || new Date(options.nowMs ?? Date.now()).toISOString(), "created_at");
  const expiresAt = futureTimestamp(input.expiresAt, options.nowMs ?? Date.now(), "expires_at");
  const workspaceId = workspaceIdValue(input.workspaceId);
  const payload = {
    schema: SHARED_WORKSPACE_PROFILE,
    type: "NOTE",
    workspace_id: workspaceId,
    room: sharedWorkspaceRoom(workspaceId),
    session_id: token(input.sessionId, "session_id", 180),
    sender_did: did(input.senderDid, "sender_did"),
    text: narrative(input.text, "text", SHARED_WORKSPACE_LIMITS.maxTextBytes),
    idempotency_key: token(input.idempotencyKey, "idempotency_key", 128),
    created_at: createdAt,
    expires_at: expiresAt,
    authority: "none",
    remote_execution: false,
    files_shared: false,
    no_payment: true,
    no_settlement: true,
  };
  return finalize(payload);
}

export function inspectSharedWorkspaceFrame(wire, options = {}) {
  const raw = String(wire || "");
  const base = { detected: raw.startsWith(`${SHARED_WORKSPACE_PREFIX} `), valid: false, verified: options.transportVerified === true, rejection: null, frame: null, eventId: null };
  if (!base.detected) return { ...base, rejection: "not_shared_workspace_frame" };
  if (Buffer.byteLength(raw) > SHARED_WORKSPACE_LIMITS.maxWireBytes) return reject(base, "wire_too_large");
  try {
    const json = raw.slice(SHARED_WORKSPACE_PREFIX.length + 1);
    const parsed = JSON.parse(json);
    if (json !== canonicalJson(parsed)) fail("frame_not_canonical");
    if (parsed.schema !== SHARED_WORKSPACE_PROFILE || !SHARED_WORKSPACE_EVENT_TYPES.includes(parsed.type)) fail("unsupported_shared_workspace_frame");
    const eventId = String(parsed.event_id || "");
    const expected = frameHash(parsed);
    if (!/^[a-f0-9]{64}$/.test(eventId) || eventId !== expected) fail("event_hash_mismatch");
    if (parsed.room !== sharedWorkspaceRoom(parsed.workspace_id)) fail("workspace_room_mismatch");
    if (options.room && parsed.room !== options.room) fail("wrong_shared_workspace_room");
    if (parsed.sender_did !== options.transportSender) fail("transport_sender_mismatch");
    if (parsed.remote_execution !== false || parsed.files_shared !== false || parsed.no_payment !== true || parsed.no_settlement !== true) fail("shared_workspace_authority_mismatch");
    if (Date.parse(parsed.expires_at) <= (options.nowMs ?? Date.now())) fail("expired");
    timestamp(parsed.created_at, "created_at");
    timestamp(parsed.expires_at, "expires_at");
    token(parsed.session_id, "session_id", 180);
    did(parsed.sender_did, "sender_did");
    if (parsed.type === "OPEN") {
      narrative(parsed.title, "title", SHARED_WORKSPACE_LIMITS.maxTitleBytes);
      token(parsed.owner_node_id, "owner_node_id", 120);
      did(parsed.owner_node_did, "owner_node_did");
      if (parsed.sender_did !== parsed.owner_node_did || parsed.authority !== "coordination_only") fail("owner_sender_mismatch");
      normalizeMembers(parsed.members);
    } else {
      narrative(parsed.text, "text", SHARED_WORKSPACE_LIMITS.maxTextBytes);
      token(parsed.idempotency_key, "idempotency_key", 128);
      if (parsed.authority !== "none") fail("shared_workspace_authority_mismatch");
    }
    if (options.transportVerified !== true) fail("signature_unverified");
    return { ...base, valid: true, rejection: null, frame: parsed, eventId };
  } catch (error) {
    return reject(base, String(error?.message || "malformed_shared_workspace_frame").slice(0, 100));
  }
}

export function normalizeSharedWorkspaceRooms(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of records) {
    try {
      const workspaceId = workspaceIdValue(raw.workspace_id || raw.workspaceId);
      if (seen.has(workspaceId)) continue;
      seen.add(workspaceId);
      const members = normalizeMembers(raw.members);
      const events = normalizeSharedWorkspaceEvents(raw.events || []);
      out.push({
        id: workspaceId,
        workspace_id: workspaceId,
        room: sharedWorkspaceRoom(workspaceId),
        session_id: token(raw.session_id || raw.sessionId, "session_id", 180),
        title: narrative(raw.title, "title", SHARED_WORKSPACE_LIMITS.maxTitleBytes),
        owner_node_id: token(raw.owner_node_id || raw.ownerNodeId, "owner_node_id", 120),
        owner_node_did: did(raw.owner_node_did || raw.ownerNodeDid, "owner_node_did"),
        members,
        manifest_event_id: /^[a-f0-9]{64}$/.test(String(raw.manifest_event_id || "")) ? String(raw.manifest_event_id) : null,
        create_idempotency_key: raw.create_idempotency_key ? token(raw.create_idempotency_key, "create_idempotency_key", 128) : null,
        created_at: timestamp(raw.created_at || raw.createdAt, "created_at"),
        updated_at: timestamp(raw.updated_at || raw.updatedAt || raw.created_at || raw.createdAt, "updated_at"),
        expires_at: timestamp(raw.expires_at || raw.expiresAt, "expires_at"),
        publish_status: ["pending", "sent", "duplicate", "failed"].includes(raw.publish_status) ? raw.publish_status : "pending",
        publish_error: raw.publish_error ? String(raw.publish_error).slice(0, 240) : null,
        events,
      });
    } catch { /* discard malformed persisted room */ }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 100);
}

export function normalizeSharedWorkspaceEvents(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of records) {
    const eventId = String(raw.event_id || raw.eventId || "");
    if (!/^[a-f0-9]{64}$/.test(eventId) || seen.has(eventId)) continue;
    seen.add(eventId);
    out.push({
      event_id: eventId,
      type: SHARED_WORKSPACE_EVENT_TYPES.includes(raw.type) ? raw.type : "NOTE",
      sender_did: String(raw.sender_did || "").slice(0, 200),
      text: raw.text ? String(raw.text).slice(0, SHARED_WORKSPACE_LIMITS.maxTextBytes) : null,
      idempotency_key: raw.idempotency_key ? String(raw.idempotency_key).slice(0, 128) : null,
      created_at: timestampOrNull(raw.created_at) || new Date(0).toISOString(),
      observed_at: timestampOrNull(raw.observed_at) || null,
      source_seq: Number.isSafeInteger(Number(raw.source_seq)) ? Number(raw.source_seq) : null,
      verified: raw.verified === true,
      state: raw.state === "quarantined" ? "quarantined" : "accepted",
      rejection: raw.rejection ? String(raw.rejection).slice(0, 120) : null,
    });
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.event_id.localeCompare(b.event_id)).slice(-SHARED_WORKSPACE_LIMITS.maxEvents);
}

export function publicSharedWorkspaceRoom(record) {
  const room = normalizeSharedWorkspaceRooms([record])[0];
  if (!room) return null;
  return { ...room, members: room.members.map(({ key, ...member }) => member), event_count: room.events.filter((event) => event.state === "accepted").length, quarantine_count: room.events.filter((event) => event.state === "quarantined").length };
}

function finalize(payload) {
  const eventId = frameHash(payload);
  const frame = { ...payload, event_id: eventId };
  const wire = `${SHARED_WORKSPACE_PREFIX} ${canonicalJson(frame)}`;
  if (Buffer.byteLength(wire) > SHARED_WORKSPACE_LIMITS.maxWireBytes) fail("wire_too_large");
  return { frame, wire, event_id: eventId, room: payload.room, workspace_id: payload.workspace_id };
}

function frameHash(frame) {
  const { event_id, ...payload } = frame;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function normalizeMembers(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > SHARED_WORKSPACE_LIMITS.maxMembers) fail("invalid_members");
  const members = input.map((member) => ({
    key: token(member.key || `${member.nodeId || member.node_id}:${member.agentId || member.agent_id}:${member.did}`, "member_key", 240),
    agent_id: token(member.agentId || member.agent_id, "member_agent_id", 100),
    name: narrative(member.name || member.agentId || member.agent_id, "member_name", 80),
    did: did(member.did, "member_did"),
    node_id: token(member.nodeId || member.node_id, "member_node_id", 120),
    node_did: member.nodeDid || member.node_did ? did(member.nodeDid || member.node_did, "member_node_did") : null,
    source: member.source === "federated" ? "federated" : "local",
  })).sort((a, b) => a.did.localeCompare(b.did));
  if (new Set(members.map((member) => member.did)).size !== members.length) fail("duplicate_member_did");
  return members;
}

function workspaceIdValue(value) { const id = String(value || "").toLowerCase(); if (!UUID.test(id)) fail("invalid_workspace_id"); return id; }
function did(value, field) { const text = String(value || ""); if (!DID.test(text)) fail(`invalid_${field}`); return text; }
function token(value, field, max) { const text = String(value || ""); if (!TOKEN.test(text) || text.length > max) fail(`invalid_${field}`); return text; }
function narrative(value, field, max) { const text = String(value || "").replace(/\r\n/g, "\n").trim(); if (!text || Buffer.byteLength(text) > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || SENSITIVE.test(text)) fail(`invalid_${field}`); return text; }
function timestamp(value, field) { const date = new Date(String(value || "")); if (Number.isNaN(date.getTime())) fail(`invalid_${field}`); return date.toISOString(); }
function futureTimestamp(value, nowMs, field) { const result = timestamp(value, field); if (Date.parse(result) <= nowMs) fail("expired"); return result; }
function timestampOrNull(value) { try { return timestamp(value, "timestamp"); } catch { return null; } }
function reject(base, reason) { return { ...base, valid: false, rejection: reason }; }
function fail(code) { throw new Error(code); }
function canonicalJson(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; }
