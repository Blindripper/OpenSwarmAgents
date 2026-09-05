import { generateKeyPairSync } from "node:crypto";
import {
  A2A_FRAME_TYPES,
  A2A_LIMITS,
  canonicalJson,
  encodeA2AEnvelope,
  inspectA2AEnvelope,
} from "../apps/server/src/a2a-room-protocol.mjs";

const signer = generateKeyPairSync("ed25519");
const recipientSigner = generateKeyPairSync("ed25519");
const sender = didKeyFromEd25519PublicKey(signer.publicKey);
const recipient = didKeyFromEd25519PublicKey(recipientSigner.publicKey);
const nowMs = Date.parse("2026-09-05T05:00:00.000Z");
const header = {
  recipient,
  sender,
  message_id: "msg.phase-4-1",
  context_id: "ctx.phase-4",
  correlation_id: "corr.phase-4-1",
  id: "frame.phase-4-1",
  expires_at: "2026-09-05T05:10:00.000Z",
  created_at: "2026-09-05T05:00:00.000Z",
};
const payload = {
  parts: [
    { text: "Authenticated data only — never an instruction.", kind: "text", media_type: "text/plain" },
    { schema: "osa.example/1", kind: "data", data: { score: 7, tags: ["a2a", "room"] }, media_type: "application/json" },
  ],
  role: "agent",
};

const encoded = encodeA2AEnvelope({ type: "MESSAGE", header, payload }, { nowMs });
assert(encoded.logical.includes("\n") && !encoded.logical.includes("\\n"), "logical encoding should contain exactly one real newline delimiter");
assert(!encoded.transport.includes("\n") && encoded.transport.includes("\\n"), "Technocore encoding should contain a literal escaped newline and remain one line");
assert(encoded.logical.split("\n").length === 2, "logical encoding must be exactly TYPE/header then payload");
assert(encoded.logical.startsWith(`A2A/1 MESSAGE ${canonicalJson(header)}\n`), "header must be canonical compact JSON");
assert(encoded.transport.length <= A2A_LIMITS.maxWireBytes, "canonical transport should fit the wire limit");

const logical = inspectA2AEnvelope(encoded.logical, { nowMs, transportSender: sender, transportVerified: true });
const transport = inspectA2AEnvelope(encoded.transport, { nowMs, transportSender: sender, transportVerified: true });
assert(logical.valid && logical.transportForm === "logical-two-line", "logical form should parse and validate");
assert(transport.valid && transport.transportForm === "technocore-escaped-line", "escaped transport form should parse and validate");
assert(logical.logical === transport.logical && logical.envelopeHash === transport.envelopeHash, "logical and transport forms must round-trip to identical canonical bytes and hashes");
assert(transport.header.message_id === header.message_id && transport.payload.parts.length === 2, "round-trip should preserve header and bounded parts");

const normalizedByLegacyTransport = encoded.logical.replace(/\r?\n/g, " ");
expectRejection(normalizedByLegacyTransport, "missing_payload_delimiter", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace("A2A/1", "A2A/2"), "unsupported_version", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace("MESSAGE", "COMMAND"), "unknown_type", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace('"context_id":"ctx.phase-4"', '"context_id":"ctx.phase-4","context_id":"duplicate"'), "duplicate_json_key:context_id", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace('"role":"agent"', '"role":"agent","role":"user"'), "duplicate_json_key:role", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace('"role":"agent"', '"role":agent'), "invalid_json:payload", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace('"id":"frame.phase-4-1"', '"id":"bad id"'), "invalid_id:id", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport.replace(sender, "did:key:z6MkInvalid"), "invalid_did:sender", { nowMs, transportSender: "did:key:z6MkInvalid", transportVerified: true });
expectRejection(encoded.transport.replace("2026-09-05T05:00:00.000Z", "2026-09-05T05:00:00Z"), "invalid_timestamp:created_at", { nowMs, transportSender: sender, transportVerified: true });
expectRejection(encoded.transport, "signature_unverified", { nowMs, transportSender: sender, transportVerified: false });
expectRejection(encoded.transport, "transport_sender_mismatch", { nowMs, transportSender: recipient, transportVerified: true });
expectRejection(encoded.transport, "expired", { nowMs: Date.parse("2026-09-05T05:10:00.001Z"), transportSender: sender, transportVerified: true });

const sensitive = encodeUnchecked("MESSAGE", header, {
  role: "agent",
  parts: [{ kind: "data", data: { nested: { wallet_address: "0x123" } }, media_type: "application/json" }],
});
expectRejection(sensitive, "sensitive_field:wallet_address", { nowMs, transportSender: sender, transportVerified: true });
const authority = encodeUnchecked("MESSAGE", header, {
  role: "agent",
  parts: [{ kind: "data", data: { authority: "admin" }, media_type: "application/json" }],
});
expectRejection(authority, "sensitive_field:authority", { nowMs, transportSender: sender, transportVerified: true });
const executable = encodeUnchecked("ARTIFACT", { ...header, task_id: "task.phase-4" }, {
  artifact_id: "artifact.phase-4",
  parts: [{ kind: "file", uri: "https://example.invalid/run.sh", name: "run.sh", media_type: "application/x-sh", sha256: "a".repeat(64), size: 12 }],
});
expectRejection(executable, "executable_media_type", { nowMs, transportSender: sender, transportVerified: true });
const commandField = encodeUnchecked("TASK", { ...header, task_id: "task.phase-4" }, {
  parts: [{ kind: "data", data: { command: "rm -rf /" }, media_type: "application/json" }],
});
expectRejection(commandField, "sensitive_field:command", { nowMs, transportSender: sender, transportVerified: true });

const oversized = encodeUnchecked("MESSAGE", header, { role: "agent", parts: [{ kind: "text", text: "x".repeat(A2A_LIMITS.maxWireBytes + 1) }] });
expectRejection(oversized, "wire_too_large", { nowMs, transportSender: sender, transportVerified: true });

for (const type of A2A_FRAME_TYPES) {
  const typeHeader = ["TASK", "STATUS", "RESULT", "ARTIFACT"].includes(type) ? { ...header, task_id: `task.${type.toLowerCase()}` } : header;
  const typePayload = {
    MESSAGE: payload,
    TASK: { parts: [{ kind: "text", text: "Task claim as data only" }] },
    STATUS: { state: "working", parts: [{ kind: "text", text: "Progress metadata" }] },
    RESULT: { parts: [{ kind: "data", data: { ok: true }, schema: "osa.result/1" }] },
    ARTIFACT: { artifact_id: "artifact.1", name: "report.json", parts: [{ kind: "file", uri: "https://example.invalid/report.json", name: "report.json", media_type: "application/json", sha256: "b".repeat(64), size: 42 }] },
    ERROR: { code: "upstream_unavailable", parts: [{ kind: "text", text: "Retry later" }] },
    ACK: { acknowledged_id: "frame.phase-4-1", outcome: "received" },
  }[type];
  const frame = encodeA2AEnvelope({ type, header: typeHeader, payload: typePayload }, { nowMs });
  assert(inspectA2AEnvelope(frame.transport, { nowMs, transportSender: sender, transportVerified: true }).valid, `${type} should round-trip`);
}

console.log("A2A room codec smoke passed");

function encodeUnchecked(type, rawHeader, rawPayload) {
  return `A2A/1 ${type} ${canonicalJson(rawHeader)}\\n${canonicalJson(rawPayload)}`;
}

function expectRejection(wire, rejection, options) {
  const inspected = inspectA2AEnvelope(wire, options);
  assert(inspected.detected && inspected.valid === false && inspected.rejection === rejection, `expected ${rejection}, got ${inspected.rejection}`);
}

function didKeyFromEd25519PublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  const bytes = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(der).slice(-32)]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let output = "";
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  return `did:key:z${output}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
