import { createHash } from "node:crypto";
import { A2A_LIMITS, canonicalJson, encodeA2AEnvelope, inspectA2AEnvelope } from "./a2a-room-protocol.mjs";
import { AGENT_MAILBOX_LIMITS, deriveAgentMailboxRoom } from "./agent-mailbox.mjs";

export const SUBTASK_DELEGATION_PROFILE = "osa-subtask-delegation/1";
export const SUBTASK_DELEGATION_FRAME_TYPES = Object.freeze(["TASK", "STATUS", "RESULT", "ACK"]);
export const SUBTASK_DELEGATION_LIMITS = Object.freeze({
  maxWireBytes: A2A_LIMITS.maxWireBytes,
  maxLogicalBytes: A2A_LIMITS.maxLogicalBytes,
  maxHeaderBytes: A2A_LIMITS.maxHeaderBytes,
  maxPayloadBytes: A2A_LIMITS.maxPayloadBytes,
  maxParts: 1,
  maxTextBytes: Math.min(A2A_LIMITS.maxTextPartBytes, AGENT_MAILBOX_LIMITS.maxTextBytes),
  maxNarrativeBytes: Math.min(A2A_LIMITS.maxTextPartBytes, AGENT_MAILBOX_LIMITS.maxTextBytes),
  maxRequiredCapabilities: 20,
  maxIdempotencyKeyBytes: 128,
  maxExpiryMs: 30 * 24 * 60 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
});

const DANGEROUS_TEXT_PATTERNS = Object.freeze([
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|seed[_ -]?phrase|mnemonic|password|credential|secret)\s*[:=]\s*\S+/i,
  /\b(?:authorization|bearer)\s*[:= ]\s*[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:wallet|wallet_address|payment|settlement|transfer|amount|asset|rail)\s*[:=]\s*\S+/i,
  /\b(?:command|cmd|shell|script|tool_call|toolcall|function_call|execute)\s*[:=]\s*\S+/i,
]);

const META_PREFIX = "OSA SUBTASK";
const TASK_META_KEYS = Object.freeze([
  "delegation_id",
  "task_id",
  "frame_id",
  "context_id",
  "correlation_id",
  "request_hash",
  "sender_did",
  "sender_node_id",
  "recipient_did",
  "recipient_node_id",
  "expiry",
  "required_capabilities",
  "idempotency_key",
  "authority",
  "no_payment",
  "no_settlement",
  "task_text_hash",
]);

const RESULT_META_KEYS = Object.freeze([
  "delegation_id",
  "task_id",
  "frame_id",
  "context_id",
  "correlation_id",
  "request_hash",
  "result_hash",
  "sender_did",
  "sender_node_id",
  "recipient_did",
  "recipient_node_id",
  "expiry",
  "idempotency_key",
  "authority",
  "no_payment",
  "no_settlement",
  "result_text_hash",
]);

export function subtaskDelegationRoomForRecipient(recipientDid) {
  return deriveAgentMailboxRoom(recipientDid);
}

export function subtaskDelegationRoomLabel(recipientDid) {
  return `#${subtaskDelegationRoomForRecipient(recipientDid)}`;
}

export function subtaskDelegationIds(input = {}) {
  const senderDid = validateDid(input.senderDid, "senderDid");
  const recipientDid = validateDid(input.recipientDid, "recipientDid");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const requestHash = String(input.requestHash || "").slice(0, 64);
  const digest = sha256([
    "OSA::subtask-delegation::v1",
    senderDid,
    recipientDid,
    idempotencyKey,
    requestHash,
  ].join("\0"));
  const stem = digest.slice(0, 40);
  return {
    delegation_id: `subtask-${stem}`,
    task_id: `task-subtask-${stem}`,
    context_id: `ctx-subtask-${stem}`,
    correlation_id: `corr-subtask-${stem}`,
    task_frame_id: `frame-subtask-task-${stem}`,
    status_frame_id: `frame-subtask-status-${stem}`,
    result_frame_id: `frame-subtask-result-${stem}`,
    ack_frame_id: `frame-subtask-ack-${stem}`,
  };
}

function responseFrameIds(input, kind) {
  const delegationId = validateTokenish(input.delegationId, "delegationId", 120);
  const taskId = validateTokenish(input.taskId, "taskId", 120);
  const contextId = validateTokenish(input.contextId, "contextId", 120);
  const correlationId = validateTokenish(input.correlationId, "correlationId", 120);
  if (taskId !== `task-${delegationId}`) fail("subtask_task_id_mismatch");
  const stem = sha256(["OSA::subtask-response::v1", kind, delegationId, input.idempotencyKey, input.requestHash].join("\0")).slice(0, 40);
  return {
    delegation_id: delegationId,
    task_id: taskId,
    context_id: contextId,
    correlation_id: correlationId,
    [`${kind}_frame_id`]: `frame-subtask-${kind}-${stem}`,
  };
}

export function subtaskDelegationRequestHash(input = {}) {
  return sha256(canonicalJson({
    senderDid: validateDid(input.senderDid, "senderDid"),
    recipientDid: validateDid(input.recipientDid, "recipientDid"),
    senderNodeId: validateTokenish(input.senderNodeId, "senderNodeId", 100),
    recipientNodeId: validateTokenish(input.recipientNodeId, "recipientNodeId", 100),
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
    requiredCapabilities: normalizeCapabilities(input.requiredCapabilities),
    taskText: validateNarrativeText(input.taskText, "taskText"),
    expiry: validateTimestamp(input.expiry, "expiry"),
    noPayment: input.noPayment === true,
    noSettlement: input.noSettlement === true,
  }));
}

export function subtaskDelegationResultHash(input = {}) {
  const delegationId = String(input.delegationId || input.delegation_id || input.id || "").slice(0, 120);
  return sha256(canonicalJson({
    delegationId,
    taskId: String(input.taskId || input.task_id || "").slice(0, 120),
    requestHash: String(input.requestHash || "").slice(0, 64),
    resultText: validateNarrativeText(input.resultText, "resultText"),
  }));
}

export function subtaskDelegationExactCapabilityMatch(requiredCapabilities = [], offeredCapabilities = []) {
  const required = normalizeCapabilities(requiredCapabilities);
  const offered = normalizeCapabilities(offeredCapabilities);
  if (required.length !== offered.length) return false;
  return required.every((capability, index) => capability === offered[index]);
}

export function subtaskDelegationSatisfiesCapabilities(requiredCapabilities = [], offeredCapabilities = []) {
  const required = normalizeCapabilities(requiredCapabilities);
  const offered = normalizeCapabilities(offeredCapabilities);
  return required.every((capability) => offered.includes(capability));
}

export function composeSubtaskDelegationTaskFrame(input = {}, options = {}) {
  const request = normalizeSubtaskRequest(input, options);
  const ids = subtaskDelegationIds(request);
  const requestHash = subtaskDelegationRequestHash(request);
  const taskTextHash = sha256(request.taskText);
  const body = request.taskText;
  const content = formatCanonicalFrameText("TASK", {
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    frame_id: ids.task_frame_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    request_hash: requestHash,
    sender_did: request.senderDid,
    sender_node_id: request.senderNodeId,
    sender_node_did: request.senderNodeDid || null,
    recipient_did: request.recipientDid,
    recipient_node_id: request.recipientNodeId,
    recipient_node_did: request.recipientNodeDid || null,
    expiry: request.expiry,
    required_capabilities: request.requiredCapabilities,
    idempotency_key: request.idempotencyKey,
    authority: "none",
    no_payment: true,
    no_settlement: true,
    task_text_hash: taskTextHash,
  }, body);
  const encoded = encodeA2AEnvelope({
    type: "TASK",
    header: {
      id: ids.task_frame_id,
      correlation_id: ids.correlation_id,
      context_id: ids.context_id,
      task_id: ids.task_id,
      message_id: ids.task_frame_id,
      sender: request.senderDid,
      recipient: request.recipientDid,
      created_at: request.createdAt,
      expires_at: request.expiry,
      schema: SUBTASK_DELEGATION_PROFILE,
      media_type: "text/plain",
    },
    payload: {
      parts: [{ kind: "text", text: content, media_type: "text/plain" }],
    },
  }, { nowMs: request.nowMs });
  return {
    ...encoded,
    profile: SUBTASK_DELEGATION_PROFILE,
    room: subtaskDelegationRoomForRecipient(request.recipientDid),
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    task_frame_id: ids.task_frame_id,
    request_hash: requestHash,
    task_text_hash: taskTextHash,
    required_capabilities: request.requiredCapabilities,
    sender_did: request.senderDid,
    sender_node_id: request.senderNodeId,
    sender_node_did: request.senderNodeDid || null,
    recipient_did: request.recipientDid,
    recipient_node_id: request.recipientNodeId,
    recipient_node_did: request.recipientNodeDid || null,
    expiry: request.expiry,
    idempotency_key: request.idempotencyKey,
    no_payment: true,
    no_settlement: true,
    task_text: request.taskText,
  };
}

export function composeSubtaskDelegationResultFrame(input = {}, options = {}) {
  const result = normalizeSubtaskResult(input, options);
  const ids = responseFrameIds(result, "result");
  const resultHash = subtaskDelegationResultHash({
    ...result,
    delegationId: ids.delegation_id,
    taskId: ids.task_id,
  });
  const resultTextHash = sha256(result.resultText);
  const content = formatCanonicalFrameText("RESULT", {
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    frame_id: ids.result_frame_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    request_hash: result.requestHash,
    result_hash: resultHash,
    sender_did: result.senderDid,
    sender_node_id: result.senderNodeId,
    sender_node_did: result.senderNodeDid || null,
    recipient_did: result.recipientDid,
    recipient_node_id: result.recipientNodeId,
    recipient_node_did: result.recipientNodeDid || null,
    expiry: result.expiry,
    idempotency_key: result.idempotencyKey,
    authority: "none",
    no_payment: true,
    no_settlement: true,
    result_text_hash: resultTextHash,
  }, result.resultText);
  const encoded = encodeA2AEnvelope({
    type: "RESULT",
    header: {
      id: ids.result_frame_id,
      correlation_id: ids.correlation_id,
      context_id: ids.context_id,
      task_id: ids.task_id,
      message_id: ids.result_frame_id,
      sender: result.senderDid,
      recipient: result.recipientDid,
      created_at: result.createdAt,
      expires_at: result.expiry,
      schema: SUBTASK_DELEGATION_PROFILE,
      media_type: "text/plain",
    },
    payload: {
      parts: [{ kind: "text", text: content, media_type: "text/plain" }],
    },
  }, { nowMs: result.nowMs });
  return {
    ...encoded,
    profile: SUBTASK_DELEGATION_PROFILE,
    room: subtaskDelegationRoomForRecipient(result.recipientDid),
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    result_frame_id: ids.result_frame_id,
    request_hash: result.requestHash,
    result_hash: resultHash,
    result_text_hash: resultTextHash,
    sender_did: result.senderDid,
    sender_node_id: result.senderNodeId,
    sender_node_did: result.senderNodeDid || null,
    recipient_did: result.recipientDid,
    recipient_node_id: result.recipientNodeId,
    recipient_node_did: result.recipientNodeDid || null,
    expiry: result.expiry,
    idempotency_key: result.idempotencyKey,
    no_payment: true,
    no_settlement: true,
    result_text: result.resultText,
    result_preview: result.resultPreview,
  };
}

export function composeSubtaskDelegationStatusFrame(input = {}, options = {}) {
  const status = normalizeSubtaskStatus(input, options);
  const ids = responseFrameIds(status, "status");
  const content = formatCanonicalFrameText("STATUS", {
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    frame_id: ids.status_frame_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    request_hash: status.requestHash,
    sender_did: status.senderDid,
    sender_node_id: status.senderNodeId,
    sender_node_did: status.senderNodeDid || null,
    recipient_did: status.recipientDid,
    recipient_node_id: status.recipientNodeId,
    recipient_node_did: status.recipientNodeDid || null,
    authority: "none",
    no_payment: true,
    no_settlement: true,
    state: status.state,
  }, status.note || status.state);
  const encoded = encodeA2AEnvelope({
    type: "STATUS",
    header: {
      id: ids.status_frame_id,
      correlation_id: ids.correlation_id,
      context_id: ids.context_id,
      task_id: ids.task_id,
      message_id: ids.status_frame_id,
      sender: status.senderDid,
      recipient: status.recipientDid,
      created_at: status.createdAt,
      expires_at: status.expiry,
      schema: SUBTASK_DELEGATION_PROFILE,
      media_type: "text/plain",
    },
    payload: { state: status.state, parts: [{ kind: "text", text: content, media_type: "text/plain" }] },
  }, { nowMs: status.nowMs });
  return {
    ...encoded,
    profile: SUBTASK_DELEGATION_PROFILE,
    room: subtaskDelegationRoomForRecipient(status.recipientDid),
    delegation_id: ids.delegation_id,
    request_hash: status.requestHash,
    sender_did: status.senderDid,
    sender_node_id: status.senderNodeId,
    sender_node_did: status.senderNodeDid || null,
    recipient_did: status.recipientDid,
    recipient_node_id: status.recipientNodeId,
    recipient_node_did: status.recipientNodeDid || null,
    expiry: status.expiry,
    state: status.state,
    note: status.note || null,
    no_payment: true,
    no_settlement: true,
  };
}

export function composeSubtaskDelegationAckFrame(input = {}, options = {}) {
  const ack = normalizeSubtaskAck(input, options);
  const ids = responseFrameIds(ack, "ack");
  const content = formatCanonicalFrameText("ACK", {
    delegation_id: ids.delegation_id,
    task_id: ids.task_id,
    frame_id: ids.ack_frame_id,
    context_id: ids.context_id,
    correlation_id: ids.correlation_id,
    request_hash: ack.requestHash,
    sender_did: ack.senderDid,
    sender_node_id: ack.senderNodeId,
    sender_node_did: ack.senderNodeDid || null,
    recipient_did: ack.recipientDid,
    recipient_node_id: ack.recipientNodeId,
    recipient_node_did: ack.recipientNodeDid || null,
    authority: "none",
    no_payment: true,
    no_settlement: true,
    ack_outcome: ack.outcome,
  }, ack.note || ack.outcome);
  const encoded = encodeA2AEnvelope({
    type: "ACK",
    header: {
      id: ids.ack_frame_id,
      correlation_id: ids.correlation_id,
      context_id: ids.context_id,
      task_id: ids.task_id,
      message_id: ids.ack_frame_id,
      sender: ack.senderDid,
      recipient: ack.recipientDid,
      created_at: ack.createdAt,
      expires_at: ack.expiry,
      schema: SUBTASK_DELEGATION_PROFILE,
      media_type: "text/plain",
    },
    payload: { acknowledged_id: ack.acknowledgedId, outcome: ack.outcome, parts: [{ kind: "text", text: content, media_type: "text/plain" }] },
  }, { nowMs: ack.nowMs });
  return {
    ...encoded,
    profile: SUBTASK_DELEGATION_PROFILE,
    room: subtaskDelegationRoomForRecipient(ack.recipientDid),
    delegation_id: ids.delegation_id,
    request_hash: ack.requestHash,
    sender_did: ack.senderDid,
    sender_node_id: ack.senderNodeId,
    sender_node_did: ack.senderNodeDid || null,
    recipient_did: ack.recipientDid,
    recipient_node_id: ack.recipientNodeId,
    recipient_node_did: ack.recipientNodeDid || null,
    expiry: ack.expiry,
    outcome: ack.outcome,
    acknowledged_id: ack.acknowledgedId,
    no_payment: true,
    no_settlement: true,
  };
}

export function inspectSubtaskDelegationFrame(wire, options = {}) {
  const room = String(options.room || "");
  const localRecipientDid = options.localRecipientDid ? validateDid(options.localRecipientDid, "localRecipientDid") : null;
  const inspection = inspectA2AEnvelope(wire, {
    transportSender: options.transportSender,
    transportVerified: options.transportVerified,
    nowMs: options.nowMs,
    allowExpired: options.allowExpired,
  });
  const base = {
    ...inspection,
    subtaskValid: false,
    subtaskRejection: inspection.rejection || null,
    body: null,
    metadata: null,
    requestHash: null,
    resultHash: null,
    requiredCapabilities: [],
    taskText: null,
    resultText: null,
    payloadState: null,
  };
  if (!inspection.detected) return { ...base, subtaskRejection: "malformed_subtask_frame" };
  if (!inspection.valid) return base;
  if (!SUBTASK_DELEGATION_FRAME_TYPES.includes(inspection.frameType)) return { ...base, valid: false, subtaskRejection: "subtask_type_not_allowed" };
  if (inspection.header?.schema !== SUBTASK_DELEGATION_PROFILE) return reject(base, "subtask_schema_mismatch");
  if (inspection.header?.media_type !== "text/plain") return reject(base, "subtask_media_type_mismatch");
  if (room && room !== subtaskDelegationRoomForRecipient(inspection.header.recipient)) return reject(base, "wrong_subtask_room");
  if (localRecipientDid && inspection.header.recipient !== localRecipientDid) return reject(base, "wrong_subtask_recipient");
  if (inspection.payload?.parts?.length !== 1 || inspection.payload.parts[0]?.kind !== "text") return reject(base, "subtask_text_only");

  try {
    const text = String(inspection.payload.parts[0].text || "");
    if (!text.trim()) return reject(base, "subtask_frame_text_required");
    if (Buffer.byteLength(text, "utf8") > SUBTASK_DELEGATION_LIMITS.maxTextBytes) return reject(base, "subtask_frame_text_too_long");
    const parsed = parseCanonicalFrameText(inspection.frameType, text);
    if (!parsed) return reject(base, "subtask_canonical_text_mismatch");
    if (inspection.header.task_id !== `task-${parsed.delegation_id}`) return reject(base, "subtask_task_id_mismatch");
    if (parsed.sender_did && parsed.sender_did !== inspection.header.sender) return reject(base, "subtask_sender_mismatch");
    if (parsed.recipient_did && parsed.recipient_did !== inspection.header.recipient) return reject(base, "subtask_recipient_mismatch");
    if (parsed.context_id && parsed.context_id !== inspection.header.context_id) return reject(base, "subtask_context_mismatch");
    if (parsed.correlation_id && parsed.correlation_id !== inspection.header.correlation_id) return reject(base, "subtask_correlation_mismatch");
    if (parsed.task_id && parsed.task_id !== inspection.header.task_id) return reject(base, "subtask_task_mismatch");
    if (parsed.frame_id && parsed.frame_id !== inspection.header.id) return reject(base, "subtask_frame_mismatch");
    if (parsed.request_hash && !/^[a-f0-9]{64}$/.test(parsed.request_hash)) return reject(base, "subtask_request_hash_invalid");
    if (parsed.result_hash && !/^[a-f0-9]{64}$/.test(parsed.result_hash)) return reject(base, "subtask_result_hash_invalid");
    if (parsed.expiry && parsed.expiry !== inspection.header.expires_at) return reject(base, "subtask_expiry_mismatch");
    validateTokenish(parsed.sender_node_id, "senderNodeId", 100);
    validateTokenish(parsed.recipient_node_id, "recipientNodeId", 100);
    validateDid(parsed.sender_node_did, "senderNodeDid", true);
    validateDid(parsed.recipient_node_did, "recipientNodeDid", true);
    if (parsed.no_payment !== true || parsed.no_settlement !== true || parsed.authority !== "none") return reject(base, "subtask_authority_mismatch");
    if (parsed.required_capabilities !== undefined) {
      const capabilities = normalizeCapabilities(parsed.required_capabilities);
      if (capabilities.length !== parsed.required_capabilities.length) return reject(base, "subtask_capability_invalid");
      parsed.required_capabilities = capabilities;
    }
    if (inspection.frameType === "TASK") {
      if (!parsed.task_text_hash || parsed.task_text_hash !== sha256(parsed.body || "")) return reject(base, "subtask_task_text_hash_mismatch");
      base.taskText = validateNarrativeText(parsed.body, "taskText");
      base.requestHash = parsed.request_hash || null;
      base.requiredCapabilities = parsed.required_capabilities || [];
      const expectedRequestHash = subtaskDelegationRequestHash({
        senderDid: parsed.sender_did,
        recipientDid: parsed.recipient_did,
        senderNodeId: parsed.sender_node_id,
        senderNodeDid: parsed.sender_node_did,
        recipientNodeId: parsed.recipient_node_id,
        recipientNodeDid: parsed.recipient_node_did,
        idempotencyKey: parsed.idempotency_key,
        requiredCapabilities: parsed.required_capabilities,
        taskText: parsed.body,
        expiry: parsed.expiry,
        noPayment: parsed.no_payment,
        noSettlement: parsed.no_settlement,
      });
      if (parsed.request_hash !== expectedRequestHash) return reject(base, "subtask_request_hash_mismatch");
    } else if (inspection.frameType === "RESULT") {
      if (!parsed.result_text_hash || parsed.result_text_hash !== sha256(parsed.body || "")) return reject(base, "subtask_result_text_hash_mismatch");
      base.resultText = validateNarrativeText(parsed.body, "resultText");
      base.requestHash = parsed.request_hash || null;
      base.resultHash = parsed.result_hash || null;
      const expectedResultHash = subtaskDelegationResultHash({
        delegationId: parsed.delegation_id,
        taskId: parsed.task_id,
        requestHash: parsed.request_hash,
        resultText: parsed.body,
      });
      if (parsed.result_hash !== expectedResultHash) return reject(base, "subtask_result_hash_mismatch");
    } else if (inspection.frameType === "STATUS") {
      base.requestHash = parsed.request_hash || null;
      base.payloadState = String(inspection.payload?.state || parsed.state || "").slice(0, 40);
    } else if (inspection.frameType === "ACK") {
      base.requestHash = parsed.request_hash || null;
      base.payloadState = String(inspection.payload?.outcome || parsed.ack_outcome || "").slice(0, 40);
    }
    base.metadata = parsed;
  } catch (error) {
    return reject(base, normalizeRejection(error));
  }

  if (!inspection.verified) return reject(base, "signature_unverified");
  if (!inspection.valid) return base;
  return { ...base, subtaskValid: true, subtaskRejection: null };
}

export function normalizeSubtaskDelegationRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const kind = ["outgoing", "incoming", "result", "quarantine"].includes(record.kind) ? record.kind : "outgoing";
  const state = normalizeState(record.state, kind);
  const requiredCapabilities = normalizeCapabilities(record.required_capabilities || record.requiredCapabilities || []);
  const room = record.room ? String(record.room).slice(0, 48) : null;
  const requestHash = String(record.request_hash || record.requestHash || "").slice(0, 64) || null;
  const resultHash = String(record.result_hash || record.resultHash || "").slice(0, 64) || null;
  return {
    id: String(record.id || record.delegation_id || `subtask-${sha256([
      record.kind || "record",
      record.delegation_id || "",
      record.task_id || "",
      record.frame_id || record.task_frame_id || record.result_frame_id || record.ack_frame_id || "",
      record.room || "",
      record.sender_did || record.senderDid || "",
      record.recipient_did || record.recipientDid || "",
    ].join("\0")).slice(0, 24)}`).slice(0, 100),
    kind,
    state,
    delegation_id: String(record.delegation_id || "").slice(0, 120),
    task_id: String(record.task_id || "").slice(0, 120),
    context_id: String(record.context_id || record.contextId || "").slice(0, 120),
    correlation_id: String(record.correlation_id || record.correlationId || "").slice(0, 120),
    task_frame_id: String(record.task_frame_id || "").slice(0, 120),
    status_frame_id: String(record.status_frame_id || "").slice(0, 120),
    result_frame_id: String(record.result_frame_id || "").slice(0, 120),
    ack_frame_id: String(record.ack_frame_id || "").slice(0, 120),
    room,
    sender_agent_id: String(record.sender_agent_id || record.senderAgentId || "").slice(0, 80),
    sender_did: String(record.sender_did || record.senderDid || "").slice(0, 150),
    sender_node_id: String(record.sender_node_id || record.senderNodeId || "").slice(0, 100),
    sender_node_did: String(record.sender_node_did || record.senderNodeDid || "").slice(0, 150) || null,
    recipient_agent_id: String(record.recipient_agent_id || record.recipientAgentId || "").slice(0, 80),
    recipient_did: String(record.recipient_did || record.recipientDid || "").slice(0, 150),
    recipient_node_id: String(record.recipient_node_id || record.recipientNodeId || "").slice(0, 100),
    recipient_node_did: String(record.recipient_node_did || record.recipientNodeDid || "").slice(0, 150) || null,
    required_capabilities: requiredCapabilities,
    task_text: String(record.task_text || record.taskText || "").slice(0, SUBTASK_DELEGATION_LIMITS.maxTextBytes),
    task_preview: String(record.task_preview || record.taskPreview || "").slice(0, 280) || null,
    result_text: String(record.result_text || record.resultText || "").slice(0, SUBTASK_DELEGATION_LIMITS.maxTextBytes),
    result_preview: String(record.result_preview || record.resultPreview || "").slice(0, 280) || null,
    request_hash: requestHash,
    result_hash: resultHash,
    idempotency_key: String(record.idempotency_key || record.idempotencyKey || "").slice(0, 128) || null,
    expiry: validTimestamp(record.expiry || record.expires_at || record.expiresAt),
    created_at: validTimestamp(record.created_at || record.createdAt) || nowIso(),
    updated_at: validTimestamp(record.updated_at || record.updatedAt) || nowIso(),
    accepted_at: validTimestamp(record.accepted_at || record.acceptedAt),
    working_at: validTimestamp(record.working_at || record.workingAt),
    result_ready_at: validTimestamp(record.result_ready_at || record.resultReadyAt),
    result_sent_at: validTimestamp(record.result_sent_at || record.resultSentAt),
    result_received_at: validTimestamp(record.result_received_at || record.resultReceivedAt),
    published_at: validTimestamp(record.published_at || record.publishedAt),
    workspace_session_id: String(record.workspace_session_id || record.workspaceSessionId || "").slice(0, 120) || null,
    workspace_task_id: String(record.workspace_task_id || record.workspaceTaskId || "").slice(0, 120) || null,
    source_envelope_hash: String(record.source_envelope_hash || record.sourceEnvelopeHash || "").slice(0, 64) || null,
    source_frame_id: String(record.source_frame_id || record.sourceFrameId || "").slice(0, 120) || null,
    source_room: String(record.source_room || record.sourceRoom || "").slice(0, 48) || null,
    source_seq: finitePositiveNumber(record.source_seq || record.sourceSeq),
    transport_status: String(record.transport_status || record.transportStatus || "").slice(0, 32) || null,
    transport_error: String(record.transport_error || record.transportError || "").slice(0, 240) || null,
    delivery_status: String(record.delivery_status || record.deliveryStatus || "").slice(0, 32) || null,
    publish_status: String(record.publish_status || record.publishStatus || "").slice(0, 32) || null,
    publish_error: String(record.publish_error || record.publishError || "").slice(0, 240) || null,
    verified: record.verified === true,
    rejection_reason: record.rejection_reason ? String(record.rejection_reason).slice(0, 240) : null,
    quarantine_reason: record.quarantine_reason ? String(record.quarantine_reason).slice(0, 240) : null,
    provenance: normalizeProvenance(record.provenance),
    local_confirmation: record.local_confirmation === true,
    accept_idempotency_key: String(record.accept_idempotency_key || record.acceptIdempotencyKey || "").slice(0, 128) || null,
    no_payment: record.no_payment !== false,
    no_settlement: record.no_settlement !== false,
    authority: record.authority || "none",
  };
}

export function normalizeSubtaskDelegationProjection(records) {
  if (!Array.isArray(records)) return [];
  const byKey = new Map();
  for (const record of records) {
    const normalized = normalizeSubtaskDelegationRecord({ ...record, kind: record.kind === "quarantine" ? "quarantine" : record.kind || "incoming" });
    if (!normalized) continue;
    const key = `${normalized.kind}\x00${normalized.delegation_id}\x00${normalized.task_id}\x00${normalized.frame_id || normalized.task_frame_id || normalized.result_frame_id || normalized.ack_frame_id || ""}\x00${normalized.room || ""}`;
    byKey.set(key, normalized);
  }
  return [...byKey.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 1000);
}

export function normalizeSubtaskDelegationRecords(records) {
  return normalizeSubtaskDelegationProjection(records);
}

export function normalizeSubtaskDelegationSync(input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rooms = Array.isArray(value.rooms) ? value.rooms.map((room) => String(room || "").slice(0, 48)).filter(Boolean).slice(0, 20) : [];
  return {
    enabled: value.enabled === true,
    rooms,
    last_attempt_at: validTimestamp(value.last_attempt_at || value.lastAttemptAt),
    last_synced_at: validTimestamp(value.last_synced_at || value.lastSyncedAt),
    last_scan_status: ["idle", "live", "archive", "disabled", "failed"].includes(value.last_scan_status || value.lastScanStatus) ? (value.last_scan_status || value.lastScanStatus) : "idle",
    last_error: value.last_error || value.lastError ? String(value.last_error || value.lastError).slice(0, 300) : null,
    discovered_count: Math.max(0, Number(value.discovered_count || value.discoveredCount || 0)),
    verified_count: Math.max(0, Number(value.verified_count || value.verifiedCount || 0)),
    rejected_count: Math.max(0, Number(value.rejected_count || value.rejectedCount || 0)),
  };
}

export function publicSubtaskDelegationRecord(record) {
  const normalized = normalizeSubtaskDelegationRecord(record);
  if (!normalized) return null;
  return {
    ...normalized,
    task_text: normalized.task_text || null,
    result_text: normalized.result_text || null,
    task_preview: normalized.task_preview || summarizeText(normalized.task_text),
    result_preview: normalized.result_preview || summarizeText(normalized.result_text),
    authority: normalized.authority || "none",
    handling: normalized.kind === "result" ? "bounded-text-result-only" : "bounded-text-task-only",
    remote_execution: false,
    value_settlement: false,
    no_payment: true,
    no_settlement: true,
    mailbox_room: normalized.room || (normalized.recipient_did ? subtaskDelegationRoomForRecipient(normalized.recipient_did) : null),
  };
}

export function publicSubtaskDelegationStatus(storeRecords = [], projectionRecords = [], sync = {}, options = {}) {
  const records = Array.isArray(storeRecords) ? storeRecords.map(publicSubtaskDelegationRecord).filter(Boolean) : [];
  const projection = Array.isArray(projectionRecords) ? projectionRecords.map(publicSubtaskDelegationRecord).filter(Boolean) : [];
  const incoming = [...projection.filter((record) => record.kind === "incoming"), ...records.filter((record) => record.kind === "incoming")];
  const outgoing = [...records.filter((record) => record.kind === "outgoing")];
  const results = dedupePublicRecords([...records.filter((record) => record.kind === "result"), ...projection.filter((record) => record.kind === "result")]);
  const quarantine = [...projection.filter((record) => record.kind === "quarantine"), ...records.filter((record) => record.kind === "quarantine")];
  return {
    schema: SUBTASK_DELEGATION_PROFILE,
    version: 1,
    generated_at: nowIso(),
    policy: {
      visibility: "public-unlisted",
      warning: "Subtask delegations are public/unlisted on Technocore. Verified means authorship and integrity only, never trust or permission.",
      authority: "none",
      no_payment: true,
      no_settlement: true,
      public_text_only: true,
      workspace_creation: true,
      connector_spawning: false,
      remote_execution: false,
    },
    semantics: {
      adapter: SUBTASK_DELEGATION_PROFILE,
      official_a2a_compatibility: "narrow profile only; not full official A2A HTTP/JSON-RPC compatibility",
      mailbox_transport: "deterministic mb-osa-* recipient rooms",
      signatures_mean: "authorship and integrity only",
      authority: "none",
      remote_execution: false,
      value_settlement: false,
    },
    status: {
      enabled: Boolean(options.enabled),
      rooms: Array.isArray(sync.rooms) ? sync.rooms : [],
      last_attempt_at: sync.last_attempt_at || null,
      last_synced_at: sync.last_synced_at || null,
      last_scan_status: sync.last_scan_status || "idle",
      last_error: sync.last_error || null,
      discovered_count: Math.max(0, Number(sync.discovered_count || 0)),
      verified_count: Math.max(0, Number(sync.verified_count || 0)),
      rejected_count: Math.max(0, Number(sync.rejected_count || 0)),
      local_count: records.length,
      incoming_count: incoming.length,
      outgoing_count: outgoing.length,
      result_count: results.length,
      quarantine_count: quarantine.length,
    },
    senders: Array.isArray(options.senders) ? options.senders : [],
    recipients: Array.isArray(options.recipients) ? options.recipients : [],
    capability_options: Array.isArray(options.capabilityOptions) ? options.capabilityOptions : [],
    incoming,
    outgoing,
    results,
    quarantine,
  };
}

function dedupePublicRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.delegation_id}\0${record.result_hash || record.result_frame_id || record.id}`;
    if (!byKey.has(key) || record.publish_status) byKey.set(key, record);
  }
  return [...byKey.values()];
}

export function formatCanonicalFrameText(kind, meta = {}, body = "") {
  const canonicalKind = String(kind || "").toUpperCase();
  if (!SUBTASK_DELEGATION_FRAME_TYPES.includes(canonicalKind)) fail(`unsupported_frame_type:${canonicalKind}`);
  const orderedKeys = canonicalKind === "RESULT" ? RESULT_META_KEYS : canonicalKind === "TASK" ? TASK_META_KEYS : canonicalKind === "STATUS" ? [
    "delegation_id",
    "task_id",
    "frame_id",
    "context_id",
    "correlation_id",
    "request_hash",
    "sender_did",
    "sender_node_id",
    "sender_node_did",
    "recipient_did",
    "recipient_node_id",
    "recipient_node_did",
    "authority",
    "no_payment",
    "no_settlement",
    "state",
  ] : [
    "delegation_id",
    "task_id",
    "frame_id",
    "context_id",
    "correlation_id",
    "request_hash",
    "sender_did",
    "sender_node_id",
    "sender_node_did",
    "recipient_did",
    "recipient_node_id",
    "recipient_node_did",
    "authority",
    "no_payment",
    "no_settlement",
    "ack_outcome",
  ];
  const lines = [`${META_PREFIX} ${canonicalKind} v1`];
  for (const key of orderedKeys) {
    if (!Object.hasOwn(meta, key)) fail(`missing_subtask_meta:${key}`);
    lines.push(`${key}=${canonicalJson(meta[key])}`);
  }
  return `${lines.join("\n")}\n\n${String(body ?? "")}`;
}

export function parseCanonicalFrameText(kind, text) {
  const canonicalKind = String(kind || "").toUpperCase();
  if (!SUBTASK_DELEGATION_FRAME_TYPES.includes(canonicalKind)) return null;
  const raw = String(text || "");
  const separatorIndex = raw.indexOf("\n\n");
  if (separatorIndex < 0) return null;
  const preamble = raw.slice(0, separatorIndex);
  const body = raw.slice(separatorIndex + 2);
  const lines = preamble.split(/\r?\n/);
  if (lines[0] !== `${META_PREFIX} ${canonicalKind} v1`) return null;
  const metadata = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const equals = line.indexOf("=");
    if (equals <= 0) return null;
    const key = line.slice(0, equals);
    const valueText = line.slice(equals + 1);
    try {
      metadata[key] = JSON.parse(valueText);
    } catch {
      return null;
    }
  }
  const canonical = formatCanonicalFrameText(canonicalKind, metadata, body);
  if (canonical !== raw) return null;
  return { ...metadata, body };
}

export function normalizeSubtaskRequest(input = {}, options = {}) {
  const senderDid = validateDid(input.senderDid, "senderDid");
  const recipientDid = validateDid(input.recipientDid, "recipientDid");
  const requiredCapabilities = normalizeCapabilities(input.requiredCapabilities || []);
  if (!requiredCapabilities.length) fail("required_capabilities_required");
  if (requiredCapabilities.length > SUBTASK_DELEGATION_LIMITS.maxRequiredCapabilities) fail("required_capabilities_too_many");
  const taskText = validateNarrativeText(input.taskText, "taskText");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const expiry = validateExpiry(input.expiry, options.nowMs);
  return {
    nowMs: Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now(),
    createdAt: new Date(Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now()).toISOString(),
    senderDid,
    senderNodeId: validateTokenish(input.senderNodeId, "senderNodeId", 100),
    senderNodeDid: validateDid(input.senderNodeDid, "senderNodeDid", true),
    recipientDid,
    recipientNodeId: validateTokenish(input.recipientNodeId, "recipientNodeId", 100),
    recipientNodeDid: validateDid(input.recipientNodeDid, "recipientNodeDid", true),
    requiredCapabilities,
    taskText,
    idempotencyKey,
    expiry,
    noPayment: input.noPayment !== false,
    noSettlement: input.noSettlement !== false,
  };
}

export function normalizeSubtaskResult(input = {}, options = {}) {
  const senderDid = validateDid(input.senderDid, "senderDid");
  const recipientDid = validateDid(input.recipientDid, "recipientDid");
  const requestHash = String(input.requestHash || "").slice(0, 64);
  if (!/^[a-f0-9]{64}$/.test(requestHash)) fail("request_hash_required");
  const resultText = validateNarrativeText(input.resultText, "resultText");
  const resultPreview = String(input.resultPreview || resultText.slice(0, 280)).trim().slice(0, 280);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const expiry = validateExpiry(input.expiry, options.nowMs);
  return {
    nowMs: Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now(),
    createdAt: new Date(Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now()).toISOString(),
    senderDid,
    senderNodeId: validateTokenish(input.senderNodeId, "senderNodeId", 100),
    senderNodeDid: validateDid(input.senderNodeDid, "senderNodeDid", true),
    recipientDid,
    recipientNodeId: validateTokenish(input.recipientNodeId, "recipientNodeId", 100),
    recipientNodeDid: validateDid(input.recipientNodeDid, "recipientNodeDid", true),
    ...normalizeResponseLinkage(input),
    requestHash,
    resultText,
    resultPreview,
    idempotencyKey,
    expiry,
    noPayment: input.noPayment !== false,
    noSettlement: input.noSettlement !== false,
  };
}

export function normalizeSubtaskStatus(input = {}, options = {}) {
  const senderDid = validateDid(input.senderDid, "senderDid");
  const recipientDid = validateDid(input.recipientDid, "recipientDid");
  const requestHash = String(input.requestHash || "").slice(0, 64);
  if (!/^[a-f0-9]{64}$/.test(requestHash)) fail("request_hash_required");
  const state = String(input.state || "working").slice(0, 32);
  const note = input.note === undefined ? state : validateNarrativeText(input.note, "note");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const expiry = validateExpiry(input.expiry, options.nowMs);
  return {
    nowMs: Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now(),
    createdAt: new Date(Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now()).toISOString(),
    senderDid,
    senderNodeId: validateTokenish(input.senderNodeId, "senderNodeId", 100),
    senderNodeDid: validateDid(input.senderNodeDid, "senderNodeDid", true),
    recipientDid,
    recipientNodeId: validateTokenish(input.recipientNodeId, "recipientNodeId", 100),
    recipientNodeDid: validateDid(input.recipientNodeDid, "recipientNodeDid", true),
    ...normalizeResponseLinkage(input),
    requestHash,
    state,
    note,
    idempotencyKey,
    expiry,
    noPayment: input.noPayment !== false,
    noSettlement: input.noSettlement !== false,
  };
}

export function normalizeSubtaskAck(input = {}, options = {}) {
  const senderDid = validateDid(input.senderDid, "senderDid");
  const recipientDid = validateDid(input.recipientDid, "recipientDid");
  const requestHash = String(input.requestHash || "").slice(0, 64);
  if (!/^[a-f0-9]{64}$/.test(requestHash)) fail("request_hash_required");
  const outcome = ["received", "accepted", "rejected", "duplicate"].includes(String(input.outcome || ""))
    ? String(input.outcome)
    : fail("invalid_ack_outcome");
  const note = input.note === undefined ? outcome : validateNarrativeText(input.note, "note");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const expiry = validateExpiry(input.expiry, options.nowMs);
  return {
    nowMs: Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now(),
    createdAt: new Date(Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now()).toISOString(),
    senderDid,
    senderNodeId: validateTokenish(input.senderNodeId, "senderNodeId", 100),
    senderNodeDid: validateDid(input.senderNodeDid, "senderNodeDid", true),
    recipientDid,
    recipientNodeId: validateTokenish(input.recipientNodeId, "recipientNodeId", 100),
    recipientNodeDid: validateDid(input.recipientNodeDid, "recipientNodeDid", true),
    ...normalizeResponseLinkage(input),
    requestHash,
    outcome,
    acknowledgedId: validateTokenish(input.acknowledgedId, "acknowledgedId", 120),
    note,
    idempotencyKey,
    expiry,
    noPayment: input.noPayment !== false,
    noSettlement: input.noSettlement !== false,
  };
}

function normalizeResponseLinkage(input) {
  const delegationId = String(input.delegationId || input.delegation_id || "").trim();
  if (!delegationId) return { delegationId: null, taskId: null, contextId: null, correlationId: null };
  return {
    delegationId: validateTokenish(delegationId, "delegationId", 120),
    taskId: validateTokenish(input.taskId || input.task_id, "taskId", 120),
    contextId: validateTokenish(input.contextId || input.context_id, "contextId", 120),
    correlationId: validateTokenish(input.correlationId || input.correlation_id, "correlationId", 120),
  };
}

function normalizeCapabilities(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,|]/g)
      : [];
  return [...new Set(list.map((item) => String(item || "").trim().toLowerCase().replace(/[^a-z0-9._:-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")).filter(Boolean))].sort().slice(0, SUBTASK_DELEGATION_LIMITS.maxRequiredCapabilities);
}

function validateNarrativeText(value, field) {
  if (typeof value !== "string") fail(`${field}_required`);
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) fail(`${field}_required`);
  if (/\p{Cc}/u.test(text)) fail(`${field}_control_character`);
  if (Buffer.byteLength(text, "utf8") > SUBTASK_DELEGATION_LIMITS.maxNarrativeBytes) fail(`${field}_too_long`);
  if (DANGEROUS_TEXT_PATTERNS.some((pattern) => pattern.test(text))) fail(`${field}_sensitive_content`);
  return text;
}

export function validateIdempotencyKey(value) {
  const text = String(value || "").trim();
  if (!text || Buffer.byteLength(text, "utf8") > SUBTASK_DELEGATION_LIMITS.maxIdempotencyKeyBytes || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) {
    fail("invalid_idempotency_key");
  }
  return text;
}

function validateExpiry(value, nowMs = Date.now()) {
  const text = validTimestamp(value);
  if (!text) fail("expiry_required");
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) fail("invalid_expiry");
  if (timestamp <= nowMs) fail("expired");
  if (timestamp - nowMs > SUBTASK_DELEGATION_LIMITS.maxExpiryMs) fail("expiry_too_long");
  if (timestamp - nowMs > SUBTASK_DELEGATION_LIMITS.maxExpiryMs + SUBTASK_DELEGATION_LIMITS.maxFutureSkewMs) fail("expiry_too_far");
  return text;
}

function validateTimestamp(value, field) {
  const text = validTimestamp(value);
  if (!text) fail(`${field}_required`);
  return text;
}

function validateDid(value, field, optional = false) {
  const did = String(value || "").trim();
  if (!did) {
    if (optional) return null;
    fail(`invalid_did:${field}`);
  }
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/.test(did)) fail(`invalid_did:${field}`);
  return did;
}

function validateTokenish(value, field, limit) {
  const text = String(value || "").trim();
  if (!text || text.length > limit || /\s/.test(text)) fail(`invalid_${field}`);
  return text;
}

function validTimestamp(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeState(value, kind) {
  const raw = String(value || "").trim();
  const allowedIncoming = new Set(["pending", "accepted", "working", "result_ready", "result_sent", "failed", "expired", "cancelled", "quarantined"]);
  const allowedOutgoing = new Set(["sent", "accepted", "working", "result_received", "failed", "expired", "cancelled"]);
  const allowedResult = new Set(["result_ready", "result_sent", "result_received", "quarantined", "failed", "expired"]);
  const allowed = kind === "incoming" ? allowedIncoming : kind === "result" ? allowedResult : kind === "quarantine" ? new Set(["quarantined"]) : allowedOutgoing;
  return allowed.has(raw) ? raw : (kind === "quarantine" ? "quarantined" : kind === "result" ? "result_ready" : kind === "incoming" ? "pending" : "sent");
}

function summarizeText(text) {
  const value = String(text || "").trim();
  return value ? value.slice(0, 220) : null;
}

function normalizeProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    room: value.room ? String(value.room).slice(0, 48) : null,
    seq: finitePositiveNumber(value.seq),
    from: value.from ? String(value.from).slice(0, 150) : null,
    announced_at: validTimestamp(value.announced_at || value.announcedAt) || null,
    source: value.source ? String(value.source).slice(0, 40) : null,
    envelope_hash: value.envelope_hash ? String(value.envelope_hash).slice(0, 64) : null,
  };
}

function reject(base, reason) {
  return { ...base, valid: false, subtaskRejection: reason };
}

function normalizeRejection(error) {
  return String(error?.code || error?.message || "subtask_validation_failed").slice(0, 120);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function nowIso() {
  return new Date().toISOString();
}

function finitePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
