import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { encodeA2AEnvelope } from "../apps/server/src/a2a-room-protocol.mjs";
import {
  AGENT_MAILBOX_LIMITS,
  AGENT_MAILBOX_PREFIX,
  buildAgentMailboxMessage,
  deriveAgentMailboxRoom,
  inspectAgentMailboxFrame,
  mailboxMessageIds,
  mailboxPairMetadata,
  validateMailboxText,
} from "../apps/server/src/agent-mailbox.mjs";

const nowMs = Date.now();
const sender = didKey(generateKeyPairSync("ed25519").publicKey);
const recipient = didKey(generateKeyPairSync("ed25519").publicKey);
const otherRecipient = didKey(generateKeyPairSync("ed25519").publicKey);
const room = deriveAgentMailboxRoom(recipient);
assert.equal(room, deriveAgentMailboxRoom(recipient), "mailbox room derivation must be deterministic");
assert(room.startsWith(AGENT_MAILBOX_PREFIX) && room.length === 47 && room.length <= AGENT_MAILBOX_LIMITS.maxRoomLength, "mailbox room must fit Technocore's 48-character room limit");
assert.notEqual(room, deriveAgentMailboxRoom(otherRecipient), "different recipient DIDs should derive collision-resistant room names");
assert.deepEqual(mailboxPairMetadata(sender, recipient), mailboxPairMetadata(recipient, sender), "a sender/recipient pair must share deterministic conversation metadata in either direction");
assert.deepEqual(mailboxMessageIds(sender, recipient, "client-1"), mailboxMessageIds(sender, recipient, "client-1"), "client retry IDs must be deterministic");
assert.notDeepEqual(mailboxMessageIds(sender, recipient, "client-1"), mailboxMessageIds(sender, recipient, "client-2"), "different client IDs must not collide");

const frame = buildAgentMailboxMessage({ senderDid: sender, recipientDid: recipient, clientMessageId: "client-1", text: "Hello from the mailbox test.", ttlMs: 10 * 60_000 }, { nowMs });
assert.equal(frame.room, room);
assert.equal(frame.type, "MESSAGE");
assert.equal(frame.payload.parts.length, 1);
assert.equal(frame.payload.parts[0].kind, "text");
assert.equal(frame.header.task_id, undefined, "mailbox messages must not dispatch tasks");
const valid = inspectAgentMailboxFrame(frame.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs });
assert(valid.mailboxValid && valid.text === "Hello from the mailbox test.", "verified text-only mailbox messages should be accepted");

expectRejection(() => validateMailboxText(`x${"y".repeat(AGENT_MAILBOX_LIMITS.maxTextBytes)}`), "mailbox_text_too_long");
expectRejection(() => validateMailboxText("hello\nworld"), "mailbox_control_character");
expectRejection(() => validateMailboxText("api_key=definitely-not-for-public"), "mailbox_sensitive_content");
expectRejection(() => validateMailboxText("command=rm -rf workspace"), "mailbox_sensitive_content");
expectRejection(() => buildAgentMailboxMessage({ senderDid: sender, recipientDid: recipient, clientMessageId: "client-1", text: "hello", ttlMs: 30_000 }, { nowMs }), "invalid_mailbox_ttl");

assert.equal(inspectAgentMailboxFrame("not an envelope", { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs }).mailboxRejection, "malformed_mailbox_frame");
assert.equal(inspectAgentMailboxFrame(frame.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: false, nowMs }).mailboxRejection, "signature_unverified");
assert.equal(inspectAgentMailboxFrame(frame.transport, { room, localRecipientDid: recipient, transportSender: otherRecipient, transportVerified: true, nowMs }).mailboxRejection, "transport_sender_mismatch");
assert.equal(inspectAgentMailboxFrame(frame.transport, { room: deriveAgentMailboxRoom(otherRecipient), localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs }).mailboxRejection, "wrong_mailbox_room");
assert.equal(inspectAgentMailboxFrame(frame.transport, { room, localRecipientDid: otherRecipient, transportSender: sender, transportVerified: true, nowMs }).mailboxRejection, "wrong_mailbox_recipient");
assert.equal(inspectAgentMailboxFrame(frame.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs: nowMs + 11 * 60_000 }).mailboxRejection, "expired");
const tampered = frame.transport.replace("Hello from the mailbox test.", "Hello from the mailbox trap.");
assert.equal(inspectAgentMailboxFrame(tampered, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: false, nowMs }).mailboxRejection, "signature_unverified");

const task = encodeA2AEnvelope({
  type: "TASK",
  header: { ...frame.header, id: "frame-task-1", message_id: "msg-task-1", task_id: "task-1" },
  payload: { parts: [{ kind: "text", text: "Do not execute this." }] },
}, { nowMs });
assert.equal(inspectAgentMailboxFrame(task.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs }).mailboxRejection, "mailbox_type_not_allowed", "TASK frames must stay quarantined");

const file = encodeA2AEnvelope({
  type: "MESSAGE",
  header: { ...frame.header, id: "frame-file-1", message_id: "msg-file-1" },
  payload: { role: "agent", parts: [{ kind: "file", uri: "https://example.invalid/file", name: "file.txt", media_type: "text/plain", sha256: "a".repeat(64), size: 10 }] },
}, { nowMs });
assert.equal(inspectAgentMailboxFrame(file.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs }).mailboxRejection, "mailbox_text_only", "files must not enter mailbox chat projections");

const ack = encodeA2AEnvelope({
  type: "ACK",
  header: { ...frame.header, id: "frame-ack-1", message_id: "msg-ack-1" },
  payload: { acknowledged_id: frame.frameId, outcome: "received" },
}, { nowMs });
const inspectedAck = inspectAgentMailboxFrame(ack.transport, { room, localRecipientDid: recipient, transportSender: sender, transportVerified: true, nowMs });
assert(inspectedAck.mailboxValid && inspectedAck.frameType === "ACK" && inspectedAck.text === null, "ACK frames may enter only as message-state metadata");

console.log("Agent mailbox protocol smoke passed");

function expectRejection(fn, code) {
  assert.throws(fn, (error) => error?.message === code, `expected ${code}`);
}

function didKey(publicKey) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const der = publicKey.export({ type: "spki", format: "der" });
  const bytes = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(der).slice(-32)]);
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let output = "";
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return `did:key:z${output}`;
}
