import { createHash } from "node:crypto";
import { A2A_LIMITS, encodeA2AEnvelope, inspectA2AEnvelope } from "./a2a-room-protocol.mjs";

export const AGENT_MAILBOX_PROFILE = "osa-agent-mailbox/1";
export const AGENT_MAILBOX_PREFIX = "mb-osa-";
export const AGENT_MAILBOX_LIMITS = Object.freeze({
  maxRoomLength: 48,
  hashHexLength: 40,
  maxTextBytes: Math.min(1000, A2A_LIMITS.maxTextPartBytes),
  maxTtlMs: 24 * 60 * 60 * 1000,
  maxClientMessageIdLength: 128,
  projectionLimit: 1000,
  syncRoomLimit: 100,
});
export const PUBLIC_UNLISTED_ACK_FIELD = "public_unlisted_acknowledged";

const sensitiveTextPatterns = Object.freeze([
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|seed[_ -]?phrase|mnemonic|password|credential|secret)\s*[:=]\s*\S+/i,
  /\b(?:authorization|bearer)\s*[:= ]\s*[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:wallet|wallet_address|payment|settlement|transfer|amount|asset|rail)\s*[:=]\s*\S+/i,
  /\b(?:command|cmd|shell|script|tool_call|toolcall|function_call|execute)\s*[:=]\s*\S+/i,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/,
]);

export function deriveAgentMailboxRoom(recipientDid) {
  const did = validateMailboxDid(recipientDid, "recipient");
  const digest = createHash("sha256").update(did, "utf8").digest("hex");
  const room = `${AGENT_MAILBOX_PREFIX}${digest.slice(0, AGENT_MAILBOX_LIMITS.hashHexLength)}`;
  if (room.length > AGENT_MAILBOX_LIMITS.maxRoomLength) fail("mailbox_room_too_long");
  return room;
}

export function mailboxPairMetadata(firstDid, secondDid) {
  const pair = [validateMailboxDid(firstDid, "sender"), validateMailboxDid(secondDid, "recipient")].sort();
  const digest = sha256(`OSA::agent-mailbox-pair::v1\0${pair[0]}\0${pair[1]}`);
  return {
    correlationId: `corr-mb-${digest.slice(0, 40)}`,
    contextId: `ctx-mb-${digest.slice(0, 40)}`,
  };
}

export function mailboxMessageIds(senderDid, recipientDid, clientMessageId) {
  const sender = validateMailboxDid(senderDid, "sender");
  const recipient = validateMailboxDid(recipientDid, "recipient");
  const clientId = validateClientMessageId(clientMessageId);
  const digest = sha256(`OSA::agent-mailbox-message::v1\0${sender}\0${recipient}\0${clientId}`);
  return {
    frameId: `frame-mb-${digest.slice(0, 40)}`,
    messageId: `msg-mb-${digest.slice(0, 40)}`,
  };
}

export function buildAgentMailboxMessage(input, options = {}) {
  const sender = validateMailboxDid(input?.senderDid, "sender");
  const recipient = validateMailboxDid(input?.recipientDid, "recipient");
  const text = validateMailboxText(input?.text);
  const clientMessageId = validateClientMessageId(input?.clientMessageId);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const ttlMs = Number(input?.ttlMs);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > AGENT_MAILBOX_LIMITS.maxTtlMs) fail("invalid_mailbox_ttl");
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const pair = mailboxPairMetadata(sender, recipient);
  const ids = mailboxMessageIds(sender, recipient, clientMessageId);
  const encoded = encodeA2AEnvelope({
    type: "MESSAGE",
    header: {
      id: ids.frameId,
      correlation_id: pair.correlationId,
      context_id: pair.contextId,
      message_id: ids.messageId,
      sender,
      recipient,
      created_at: createdAt,
      expires_at: expiresAt,
      media_type: "text/plain",
      schema: AGENT_MAILBOX_PROFILE,
    },
    payload: {
      role: "agent",
      parts: [{ kind: "text", text, media_type: "text/plain" }],
    },
  }, { nowMs });
  return {
    ...encoded,
    room: deriveAgentMailboxRoom(recipient),
    clientMessageId,
    text,
    createdAt,
    expiresAt,
    correlationId: pair.correlationId,
    contextId: pair.contextId,
    frameId: ids.frameId,
    messageId: ids.messageId,
  };
}

export function inspectAgentMailboxFrame(wire, options = {}) {
  const room = String(options.room || "");
  const localRecipientDid = options.localRecipientDid ? validateMailboxDid(options.localRecipientDid, "recipient") : null;
  const inspection = inspectA2AEnvelope(wire, {
    transportSender: options.transportSender,
    transportVerified: options.transportVerified,
    nowMs: options.nowMs,
  });
  const base = { ...inspection, mailboxValid: false, mailboxRejection: inspection.rejection || null, text: null };
  if (!inspection.detected) return { ...base, mailboxRejection: "malformed_mailbox_frame" };
  if (!inspection.valid) return base;
  if (!["MESSAGE", "ACK"].includes(inspection.frameType)) return { ...base, valid: false, mailboxRejection: "mailbox_type_not_allowed" };
  const expectedRoom = deriveAgentMailboxRoom(inspection.header.recipient);
  if (room !== expectedRoom) return { ...base, valid: false, mailboxRejection: "wrong_mailbox_room" };
  if (localRecipientDid && inspection.header.recipient !== localRecipientDid) {
    return { ...base, valid: false, mailboxRejection: "wrong_mailbox_recipient" };
  }
  if (inspection.frameType === "MESSAGE") {
    const parts = inspection.payload?.parts;
    if (inspection.payload?.role !== "agent" || !Array.isArray(parts) || parts.length !== 1 || parts[0]?.kind !== "text") {
      return { ...base, valid: false, mailboxRejection: "mailbox_text_only" };
    }
    try {
      base.text = validateMailboxText(parts[0].text);
    } catch (error) {
      return { ...base, valid: false, mailboxRejection: mailboxErrorCode(error) };
    }
  }
  return { ...base, mailboxValid: true, mailboxRejection: null };
}

export function validateMailboxText(value) {
  if (typeof value !== "string") fail("mailbox_text_required");
  const text = value.trim();
  if (!text) fail("mailbox_text_required");
  if (/\p{Cc}/u.test(text)) fail("mailbox_control_character");
  if (Buffer.byteLength(text, "utf8") > AGENT_MAILBOX_LIMITS.maxTextBytes) fail("mailbox_text_too_long");
  if (sensitiveTextPatterns.some((pattern) => pattern.test(text))) fail("mailbox_sensitive_content");
  return text;
}

export function validateClientMessageId(value) {
  const id = String(value || "");
  if (!id || id.length > AGENT_MAILBOX_LIMITS.maxClientMessageIdLength || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    fail("invalid_client_message_id");
  }
  return id;
}

export function mailboxRequestHash(value) {
  return sha256(JSON.stringify({
    senderDid: String(value?.senderDid || ""),
    recipientDid: String(value?.recipientDid || ""),
    recipientSource: String(value?.recipientSource || ""),
    recipientAgentId: String(value?.recipientAgentId || ""),
    recipientNodeId: String(value?.recipientNodeId || ""),
    clientMessageId: String(value?.clientMessageId || ""),
    text: String(value?.text || ""),
    ttlMs: Number(value?.ttlMs || 0),
    replyTo: value?.replyTo ? String(value.replyTo) : null,
  }));
}

export function mailboxErrorCode(error) {
  return String(error?.code || error?.message || "mailbox_validation_failed").slice(0, 120);
}

function validateMailboxDid(value, field) {
  const did = String(value || "");
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/.test(did)) fail(`invalid_mailbox_did:${field}`);
  return did;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
