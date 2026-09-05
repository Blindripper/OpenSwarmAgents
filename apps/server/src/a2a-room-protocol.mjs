import { createHash } from "node:crypto";

export const A2A_ROOM_PROFILE = "osa-a2a-room/1";
export const A2A_WIRE_VERSION = "1";
export const A2A_FRAME_TYPES = Object.freeze(["MESSAGE", "TASK", "STATUS", "RESULT", "ARTIFACT", "ERROR", "ACK"]);
export const A2A_LIMITS = Object.freeze({
  maxWireBytes: 4096,
  maxLogicalBytes: 3584,
  maxHeaderBytes: 1400,
  maxPayloadBytes: 2600,
  maxParts: 8,
  maxTextPartBytes: 1024,
  maxDataPartBytes: 1536,
  maxFileBytes: 10 * 1024 * 1024,
  maxDepth: 12,
  maxTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
});

const headerFields = new Set([
  "id", "correlation_id", "context_id", "task_id", "message_id", "sender", "recipient",
  "created_at", "expires_at", "schema", "media_type",
]);
const requiredHeaderFields = [
  "id", "correlation_id", "context_id", "message_id", "sender", "recipient", "created_at", "expires_at",
];
const taskBoundTypes = new Set(["TASK", "STATUS", "RESULT", "ARTIFACT"]);
const statusStates = new Set(["submitted", "working", "input-required", "completed", "failed", "canceled", "rejected"]);
const ackOutcomes = new Set(["received", "accepted", "rejected", "duplicate"]);
const partKinds = new Set(["text", "data", "file"]);
const dangerousMediaTypes = new Set([
  "application/x-executable", "application/x-msdownload", "application/x-sh", "application/x-shellscript",
  "text/x-shellscript", "text/x-python", "text/x-powershell", "application/vnd.microsoft.portable-executable",
]);
const sensitiveFieldNames = new Set([
  "authority", "authorization", "permission", "permissions", "execute", "execution", "executable",
  "command", "cmd", "shell", "script", "tool", "toolcall", "functioncall", "wallet", "walletaddress",
  "privatekey", "secret", "secrets", "seed", "mnemonic", "payment", "settlement", "transfer", "amount",
  "asset", "rail", "credential", "credentials", "password", "apikey", "accesstoken", "refreshtoken",
]);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function canonicalJson(value) {
  return canonicalValue(value, 0);
}

export function encodeA2AEnvelope(input, options = {}) {
  const type = String(input?.type || "").toUpperCase();
  const header = input?.header;
  const payload = input?.payload;
  validateEnvelope(type, header, payload, options);
  const headerJson = canonicalJson(header);
  const payloadJson = canonicalJson(payload);
  const logical = `A2A/${A2A_WIRE_VERSION} ${type} ${headerJson}\n${payloadJson}`;
  const transport = `A2A/${A2A_WIRE_VERSION} ${type} ${headerJson}\\n${payloadJson}`;
  enforceEncodedLimits(logical, transport, headerJson, payloadJson);
  return {
    profile: A2A_ROOM_PROFILE,
    version: A2A_WIRE_VERSION,
    type,
    header,
    payload,
    logical,
    transport,
    envelopeHash: sha256(logical),
    headerHash: sha256(headerJson),
    payloadHash: sha256(payloadJson),
  };
}

export function inspectA2AEnvelope(wire, options = {}) {
  const raw = String(wire ?? "");
  const detected = /^A2A\//.test(raw);
  if (!detected) return { detected: false, protocol: null, valid: false, verified: false, rejection: "not_a2a_frame" };
  const transportVerified = options.transportVerified === true;
  const transportSender = String(options.transportSender || "");
  const wireBytes = byteLength(raw);
  const base = {
    detected: true,
    protocol: A2A_ROOM_PROFILE,
    verified: transportVerified,
    valid: false,
    rejection: null,
    wireBytes,
    transportForm: null,
    version: null,
    frameType: null,
    objectId: null,
    envelopeHash: sha256(raw),
    headerHash: null,
    payloadHash: null,
    header: null,
    payload: null,
    logical: null,
  };
  if (wireBytes > A2A_LIMITS.maxWireBytes) return reject(base, "wire_too_large");

  const prefix = raw.match(/^A2A\/([0-9]+) ([A-Z][A-Z0-9_-]{0,15}) /);
  if (!prefix) return reject(base, "malformed_prefix");
  base.version = prefix[1];
  base.frameType = prefix[2];
  if (base.version !== A2A_WIRE_VERSION) return reject(base, "unsupported_version");
  if (!A2A_FRAME_TYPES.includes(base.frameType)) return reject(base, "unknown_type");

  try {
    const headerStart = prefix[0].length;
    const parsedHeader = parseStrictJsonAt(raw, headerStart, "header");
    const separator = raw.startsWith("\n", parsedHeader.end)
      ? "\n"
      : raw.startsWith("\\n", parsedHeader.end)
        ? "\\n"
        : null;
    if (!separator) return reject(base, "missing_payload_delimiter");
    base.transportForm = separator === "\n" ? "logical-two-line" : "technocore-escaped-line";
    const payloadStart = parsedHeader.end + separator.length;
    if (payloadStart >= raw.length) return reject(base, "missing_payload");
    const parsedPayload = parseStrictJsonAt(raw, payloadStart, "payload");
    if (parsedPayload.end !== raw.length) return reject(base, "trailing_data");

    const headerJson = raw.slice(headerStart, parsedHeader.end);
    const payloadJson = raw.slice(payloadStart);
    if (headerJson !== canonicalJson(parsedHeader.value)) return reject(base, "header_not_canonical");
    if (payloadJson !== canonicalJson(parsedPayload.value)) return reject(base, "payload_not_canonical");

    base.header = parsedHeader.value;
    base.payload = parsedPayload.value;
    base.objectId = typeof base.header?.id === "string" ? base.header.id : null;
    base.headerHash = sha256(headerJson);
    base.payloadHash = sha256(payloadJson);
    base.logical = `A2A/${base.version} ${base.frameType} ${headerJson}\n${payloadJson}`;
    base.envelopeHash = sha256(base.logical);
    enforceEncodedLimits(base.logical, raw, headerJson, payloadJson);
    validateEnvelope(base.frameType, base.header, base.payload, options);
  } catch (error) {
    return reject(base, normalizeRejection(error));
  }

  if (!transportVerified) return reject(base, "signature_unverified");
  if (!transportSender || transportSender !== base.header.sender) return reject(base, "transport_sender_mismatch");
  return { ...base, valid: true, rejection: null };
}

export function summarizeA2AEnvelope(inspection) {
  if (!inspection?.detected) return null;
  const type = inspection.frameType || "UNKNOWN";
  const parts = Array.isArray(inspection.payload?.parts) ? inspection.payload.parts.length : 0;
  const id = inspection.objectId ? ` · ${inspection.objectId}` : "";
  return `A2A/${inspection.version || "?"} ${type} · ${parts} part${parts === 1 ? "" : "s"}${id}`;
}

export function a2aPartMetadata(payload) {
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  return {
    partCount: parts.length,
    partKinds: [...new Set(parts.map((part) => part.kind).filter((kind) => partKinds.has(kind)))].sort(),
    mediaTypes: [...new Set(parts.map((part) => part.media_type).filter(Boolean))].sort().slice(0, A2A_LIMITS.maxParts),
    schemas: [...new Set(parts.map((part) => part.schema).filter(Boolean))].sort().slice(0, A2A_LIMITS.maxParts),
  };
}

function validateEnvelope(type, header, payload, options = {}) {
  if (!A2A_FRAME_TYPES.includes(type)) fail("unknown_type");
  validateHeader(type, header, options);
  validatePayload(type, payload);
}

function validateHeader(type, header, options) {
  assertPlainObject(header, "invalid_header");
  rejectUnknownFields(header, headerFields, "unknown_header_field");
  for (const field of requiredHeaderFields) {
    if (!Object.hasOwn(header, field)) fail(`missing_header_field:${field}`);
  }
  if (taskBoundTypes.has(type) && !Object.hasOwn(header, "task_id")) fail("missing_header_field:task_id");
  for (const field of ["id", "correlation_id", "context_id", "task_id", "message_id"]) {
    if (header[field] !== undefined) validateId(header[field], field);
  }
  validateDid(header.sender, "sender");
  validateDid(header.recipient, "recipient");
  const createdMs = validateTimestamp(header.created_at, "created_at");
  const expiresMs = validateTimestamp(header.expires_at, "expires_at");
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (expiresMs <= createdMs) fail("invalid_expiry_order");
  if (expiresMs - createdMs > A2A_LIMITS.maxTtlMs) fail("ttl_too_long");
  if (createdMs > nowMs + A2A_LIMITS.maxFutureSkewMs) fail("created_at_in_future");
  if (options.allowExpired !== true && expiresMs <= nowMs) fail("expired");
  if (header.schema !== undefined) validateToken(header.schema, "schema", 128);
  if (header.media_type !== undefined) validateMediaType(header.media_type);
}

function validatePayload(type, payload) {
  assertPlainObject(payload, "invalid_payload");
  const allowed = {
    MESSAGE: new Set(["role", "parts"]),
    TASK: new Set(["parts"]),
    STATUS: new Set(["state", "parts"]),
    RESULT: new Set(["parts"]),
    ARTIFACT: new Set(["artifact_id", "name", "parts"]),
    ERROR: new Set(["code", "parts"]),
    ACK: new Set(["acknowledged_id", "outcome", "parts"]),
  }[type];
  rejectUnknownFields(payload, allowed, "unknown_payload_field");
  rejectSensitiveFields(payload);

  if (type === "MESSAGE") {
    if (!new Set(["agent", "user"]).has(payload.role)) fail("invalid_message_role");
    validateParts(payload.parts, true);
  } else if (["TASK", "RESULT"].includes(type)) {
    validateParts(payload.parts, true);
  } else if (type === "STATUS") {
    if (!statusStates.has(payload.state)) fail("invalid_status_state");
    validateParts(payload.parts, false);
  } else if (type === "ARTIFACT") {
    validateId(payload.artifact_id, "artifact_id");
    if (payload.name !== undefined) validateDisplayString(payload.name, "artifact_name", 160);
    validateParts(payload.parts, true);
  } else if (type === "ERROR") {
    validateToken(payload.code, "error_code", 80);
    validateParts(payload.parts, true);
  } else if (type === "ACK") {
    validateId(payload.acknowledged_id, "acknowledged_id");
    if (!ackOutcomes.has(payload.outcome)) fail("invalid_ack_outcome");
    validateParts(payload.parts, false);
  }
}

function validateParts(parts, required) {
  if (parts === undefined && !required) return;
  if (!Array.isArray(parts) || (required && parts.length === 0) || parts.length > A2A_LIMITS.maxParts) fail("invalid_parts");
  for (const part of parts) validatePart(part);
}

function validatePart(part) {
  assertPlainObject(part, "invalid_part");
  if (!partKinds.has(part.kind)) fail("unknown_part_kind");
  if (part.kind === "text") {
    rejectUnknownFields(part, new Set(["kind", "text", "media_type"]), "unknown_part_field");
    if (typeof part.text !== "string" || !part.text.trim() || byteLength(part.text) > A2A_LIMITS.maxTextPartBytes) fail("invalid_text_part");
  } else if (part.kind === "data") {
    rejectUnknownFields(part, new Set(["kind", "data", "schema", "media_type"]), "unknown_part_field");
    if (!Object.hasOwn(part, "data") || byteLength(canonicalJson(part.data)) > A2A_LIMITS.maxDataPartBytes) fail("invalid_data_part");
    rejectSensitiveFields(part.data);
    if (part.schema !== undefined) validateToken(part.schema, "part_schema", 128);
  } else {
    rejectUnknownFields(part, new Set(["kind", "uri", "name", "media_type", "sha256", "size"]), "unknown_part_field");
    let uri;
    try {
      uri = new URL(String(part.uri || ""));
    } catch {
      fail("invalid_file_uri");
    }
    if (uri.protocol !== "https:" || uri.username || uri.password || String(part.uri).length > 512) fail("invalid_file_uri");
    validateDisplayString(part.name, "file_name", 160);
    if (!/^[a-f0-9]{64}$/.test(String(part.sha256 || ""))) fail("invalid_file_hash");
    if (!Number.isSafeInteger(part.size) || part.size < 0 || part.size > A2A_LIMITS.maxFileBytes) fail("invalid_file_size");
    if (part.media_type === undefined) fail("missing_file_media_type");
  }
  if (part.media_type !== undefined) validateMediaType(part.media_type);
}

function rejectSensitiveFields(value, path = "payload", depth = 0) {
  if (depth > A2A_LIMITS.maxDepth) fail("payload_too_deep");
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) rejectSensitiveFields(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (sensitiveFieldNames.has(normalized)) fail(`sensitive_field:${key}`);
    rejectSensitiveFields(nested, `${path}.${key}`, depth + 1);
  }
}

function rejectUnknownFields(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${code}:${key}`);
  }
}

function validateId(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(`invalid_id:${field}`);
}

function validateToken(value, field, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._+\/-]*$/.test(value)) fail(`invalid_token:${field}`);
}

function validateDisplayString(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`invalid_string:${field}`);
}

function validateMediaType(value) {
  const mediaType = String(value || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,95}$/.test(mediaType)) fail("invalid_media_type");
  if (dangerousMediaTypes.has(mediaType)) fail("executable_media_type");
}

function validateTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(`invalid_timestamp:${field}`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail(`invalid_timestamp:${field}`);
  return timestamp;
}

function validateDid(value, field) {
  const did = String(value || "");
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/.test(did)) fail(`invalid_did:${field}`);
  let decoded = 0n;
  const body = did.slice("did:key:z".length);
  for (const character of body) {
    const digit = base58Alphabet.indexOf(character);
    if (digit < 0) fail(`invalid_did:${field}`);
    decoded = decoded * 58n + BigInt(digit);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const leadingZeroes = body.length - body.replace(/^1+/, "").length;
  const full = Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);
  if (full.length !== 34 || full[0] !== 0xed || full[1] !== 0x01) fail(`invalid_did:${field}`);
}

function enforceEncodedLimits(logical, transport, headerJson, payloadJson) {
  if (byteLength(logical) > A2A_LIMITS.maxLogicalBytes) fail("logical_envelope_too_large");
  if (byteLength(transport) > A2A_LIMITS.maxWireBytes) fail("wire_too_large");
  if (byteLength(headerJson) > A2A_LIMITS.maxHeaderBytes) fail("header_too_large");
  if (byteLength(payloadJson) > A2A_LIMITS.maxPayloadBytes) fail("payload_too_large");
}

function canonicalValue(value, depth) {
  if (depth > A2A_LIMITS.maxDepth) fail("json_too_deep");
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_json_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item, depth + 1)).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_json_value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key], depth + 1)}`).join(",")}}`;
}

function parseStrictJsonAt(source, offset, label) {
  const state = { source, index: offset, depth: 0, label };
  const value = parseJsonValue(state);
  return { value, end: state.index };
}

function parseJsonValue(state) {
  if (state.depth > A2A_LIMITS.maxDepth) fail("json_too_deep");
  const character = state.source[state.index];
  if (character === "{") return parseJsonObject(state);
  if (character === "[") return parseJsonArray(state);
  if (character === '"') return parseJsonString(state);
  if (state.source.startsWith("true", state.index)) { state.index += 4; return true; }
  if (state.source.startsWith("false", state.index)) { state.index += 5; return false; }
  if (state.source.startsWith("null", state.index)) { state.index += 4; return null; }
  return parseJsonNumber(state);
}

function parseJsonObject(state) {
  const object = {};
  const keys = new Set();
  state.index += 1;
  state.depth += 1;
  if (state.source[state.index] === "}") { state.index += 1; state.depth -= 1; return object; }
  while (state.index < state.source.length) {
    if (state.source[state.index] !== '"') fail(`invalid_json:${state.label}`);
    const key = parseJsonString(state);
    if (keys.has(key)) fail(`duplicate_json_key:${key}`);
    keys.add(key);
    if (state.source[state.index] !== ":") fail(`invalid_json:${state.label}`);
    state.index += 1;
    object[key] = parseJsonValue(state);
    const delimiter = state.source[state.index];
    if (delimiter === "}") { state.index += 1; state.depth -= 1; return object; }
    if (delimiter !== ",") fail(`invalid_json:${state.label}`);
    state.index += 1;
  }
  fail(`invalid_json:${state.label}`);
}

function parseJsonArray(state) {
  const array = [];
  state.index += 1;
  state.depth += 1;
  if (state.source[state.index] === "]") { state.index += 1; state.depth -= 1; return array; }
  while (state.index < state.source.length) {
    array.push(parseJsonValue(state));
    const delimiter = state.source[state.index];
    if (delimiter === "]") { state.index += 1; state.depth -= 1; return array; }
    if (delimiter !== ",") fail(`invalid_json:${state.label}`);
    state.index += 1;
  }
  fail(`invalid_json:${state.label}`);
}

function parseJsonString(state) {
  const start = state.index;
  state.index += 1;
  while (state.index < state.source.length) {
    const code = state.source.charCodeAt(state.index);
    if (code === 0x22) {
      state.index += 1;
      try { return JSON.parse(state.source.slice(start, state.index)); } catch { fail(`invalid_json:${state.label}`); }
    }
    if (code < 0x20) fail(`invalid_json:${state.label}`);
    if (code === 0x5c) {
      state.index += 1;
      const escaped = state.source[state.index];
      if (escaped === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(state.source.slice(state.index + 1, state.index + 5))) fail(`invalid_json:${state.label}`);
        state.index += 5;
        continue;
      }
      if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escaped)) fail(`invalid_json:${state.label}`);
    }
    state.index += 1;
  }
  fail(`invalid_json:${state.label}`);
}

function parseJsonNumber(state) {
  const match = state.source.slice(state.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) fail(`invalid_json:${state.label}`);
  const value = Number(match[0]);
  if (!Number.isFinite(value)) fail("invalid_json_number");
  state.index += match[0].length;
  return value;
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
}

function reject(base, rejection) {
  return { ...base, valid: false, rejection };
}

function normalizeRejection(error) {
  const message = String(error?.message || "invalid_frame");
  return /^[a-z0-9_:-]{1,160}$/i.test(message) ? message : "invalid_frame";
}

function fail(code) {
  throw new Error(code);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}
