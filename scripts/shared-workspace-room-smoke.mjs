import assert from "node:assert/strict";
import {
  composeSharedWorkspaceNote,
  composeSharedWorkspaceOpen,
  inspectSharedWorkspaceFrame,
  sharedWorkspaceRoom,
} from "../apps/server/src/shared-workspace-room.mjs";

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const ownerDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
const memberDid = "did:key:z6MktCjMnQxY8SdzpQwL2oCePJqBM2SYA11vngd4D2fa5g9Z";
const nowMs = Date.parse("2026-09-08T07:00:00.000Z");
const expiresAt = "2026-09-15T07:00:00.000Z";
const members = [
  { key: `local:node-owner:owner:${ownerDid}`, agentId: "owner", name: "Owner", did: ownerDid, nodeId: "node-owner", nodeDid: ownerDid, source: "local" },
  { key: `remote:node-member:member:${memberDid}`, agentId: "member", name: "Member", did: memberDid, nodeId: "node-member", nodeDid: memberDid, source: "federated" },
];
const open = composeSharedWorkspaceOpen({ workspaceId, sessionId: "home-task-workspace-1", title: "Shared release room", ownerNodeId: "node-owner", ownerNodeDid: ownerDid, senderDid: ownerDid, members, expiresAt }, { nowMs });
assert.equal(open.room, `p-osa-ws-${workspaceId}`);
assert.equal(open.wire.includes("private"), false);
assert.equal(inspectSharedWorkspaceFrame(open.wire, { room: open.room, transportSender: ownerDid, transportVerified: true, nowMs }).valid, true);
assert.equal(inspectSharedWorkspaceFrame(open.wire, { room: "p-osa-ws-223e4567-e89b-42d3-a456-426614174000", transportSender: ownerDid, transportVerified: true, nowMs }).rejection, "wrong_shared_workspace_room");
assert.equal(inspectSharedWorkspaceFrame(open.wire, { room: open.room, transportSender: memberDid, transportVerified: true, nowMs }).rejection, "transport_sender_mismatch");

const note = composeSharedWorkspaceNote({ workspaceId, sessionId: "home-task-workspace-1", senderDid: memberDid, text: "Review is complete; two bounded issues remain.", idempotencyKey: "note-release-1", expiresAt }, { nowMs });
const inspectedNote = inspectSharedWorkspaceFrame(note.wire, { room: sharedWorkspaceRoom(workspaceId), transportSender: memberDid, transportVerified: true, nowMs });
assert.equal(inspectedNote.valid, true);
assert.equal(inspectedNote.frame.text, "Review is complete; two bounded issues remain.");
assert.equal(inspectSharedWorkspaceFrame(note.wire, { room: note.room, transportSender: memberDid, transportVerified: false, nowMs }).rejection, "signature_unverified");
assert.equal(inspectSharedWorkspaceFrame(note.wire, { room: note.room, transportSender: memberDid, transportVerified: true, nowMs: Date.parse(expiresAt) }).rejection, "expired");
assert.throws(() => composeSharedWorkspaceNote({ workspaceId, sessionId: "home-task-workspace-1", senderDid: memberDid, text: "password=do-not-publish", idempotencyKey: "note-bad", expiresAt }, { nowMs }), /invalid_text/);
assert.throws(() => sharedWorkspaceRoom("not-a-uuid"), /invalid_workspace_id/);
console.log("Shared workspace room protocol smoke passed.");
