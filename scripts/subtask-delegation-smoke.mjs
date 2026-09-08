import assert from "node:assert/strict";
import {
  composeSubtaskDelegationResultFrame,
  composeSubtaskDelegationTaskFrame,
  inspectSubtaskDelegationFrame,
  subtaskDelegationExactCapabilityMatch,
  subtaskDelegationRequestHash,
  subtaskDelegationResultHash,
  subtaskDelegationRoomForRecipient,
  subtaskDelegationSatisfiesCapabilities,
} from "../apps/server/src/subtask-delegation.mjs";

const senderDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
const recipientDid = "did:key:z6MktCjMnQxY8SdzpQwL2oCePJqBM2SYA11vngd4D2fa5g9Z";
const nowMs = Date.parse("2026-09-06T10:00:00.000Z");
const request = {
  senderDid,
  recipientDid,
  senderNodeId: "node-smoke-sender",
  senderNodeDid: senderDid,
  recipientNodeId: "node-smoke-recipient",
  recipientNodeDid: recipientDid,
  requiredCapabilities: ["research", "synthesis"],
  taskText: "Bounded smoke task text",
  idempotencyKey: "smoke-create",
  expiry: "2026-09-13T10:00:00.000Z",
  noPayment: true,
  noSettlement: true,
};

assert.equal(subtaskDelegationRoomForRecipient(recipientDid).startsWith("mb-osa-"), true, "recipient room should be deterministic");
assert.equal(subtaskDelegationSatisfiesCapabilities(["research"], ["research", "synthesis"]), true, "capability superset should satisfy the request");
assert.equal(subtaskDelegationExactCapabilityMatch(["research", "synthesis"], ["research", "synthesis"]), true, "exact capability match should round-trip");

const firstFrame = composeSubtaskDelegationTaskFrame(request, { nowMs });
const secondFrame = composeSubtaskDelegationTaskFrame(request, { nowMs });
assert.equal(firstFrame.delegation_id, secondFrame.delegation_id, "idempotent subtask task ids should be stable");
assert.equal(firstFrame.transport, secondFrame.transport, "idempotent subtask task transport should be stable");
assert.equal(firstFrame.request_hash, subtaskDelegationRequestHash(request), "task request hash should be canonical");

const inspection = inspectSubtaskDelegationFrame(firstFrame.transport, {
  room: firstFrame.room,
  localRecipientDid: recipientDid,
  transportSender: senderDid,
  transportVerified: true,
  nowMs,
});
assert.equal(inspection.valid, true, `expected task frame to validate, got ${inspection.subtaskRejection || inspection.rejection || "unknown"}`);
assert.equal(inspection.taskText, request.taskText, "task text should survive canonical transport round-trip");
assert.deepEqual(inspection.requiredCapabilities, request.requiredCapabilities, "required capabilities should survive canonical transport round-trip");

const resultFrame = composeSubtaskDelegationResultFrame({
  delegationId: firstFrame.delegation_id,
  taskId: firstFrame.task_id,
  contextId: firstFrame.context_id,
  correlationId: firstFrame.correlation_id,
  senderDid: recipientDid,
  recipientDid: senderDid,
  senderNodeId: request.recipientNodeId,
  senderNodeDid: request.recipientNodeDid,
  recipientNodeId: request.senderNodeId,
  recipientNodeDid: request.senderNodeDid,
  requestHash: firstFrame.request_hash,
  resultText: "Bounded smoke result text",
  resultPreview: "Bounded smoke result text",
  idempotencyKey: "smoke-result",
  expiry: request.expiry,
}, { nowMs });
assert.equal(resultFrame.result_hash, subtaskDelegationResultHash({
  delegationId: resultFrame.delegation_id,
  taskId: resultFrame.task_id,
  requestHash: firstFrame.request_hash,
  resultText: "Bounded smoke result text",
}), "result hash should be canonical");

const resultInspection = inspectSubtaskDelegationFrame(resultFrame.transport, {
  room: resultFrame.room,
  localRecipientDid: senderDid,
  transportSender: recipientDid,
  transportVerified: true,
  nowMs,
});
assert.equal(resultInspection.valid, true, `expected result frame to validate, got ${resultInspection.subtaskRejection || resultInspection.rejection || "unknown"}`);
assert.equal(resultInspection.resultText, "Bounded smoke result text", "result text should survive canonical transport round-trip");

console.log("Subtask delegation smoke passed.");
