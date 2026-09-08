import assert from "node:assert/strict";
import {
  federatedWorkbenchQuarantineFromSnapshot,
  federatedWorkbenchRecordsFromSnapshot,
  publicFederatedWorkbenchOverview,
} from "../apps/server/src/federated-workbench.mjs";

const snapshot = {
  protocol: "osa-federation-snapshot",
  node: { nodeId: "node-smoke-remote", did: "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F" },
  head: "head-smoke-1",
};

const verified = federatedWorkbenchRecordsFromSnapshot(snapshot, {
  goals: [{ id: "goal-remote", title: "Remote goal", description: "Goal body" }],
  agents: [{ id: "agent-remote", name: "Remote Agent" }],
  tasks: [{
    id: "task-remote",
    goalId: "goal-remote",
    type: "research",
    title: "Remote inspectable task",
    description: "Inspect this public task without using /home/node/private.txt or C:\\secret\\file.txt.",
    requiredCapabilities: ["research", "research", "Synthesis"],
    priority: 91,
    status: "open",
    assignedAgentId: "agent-remote",
    createdAt: "2026-09-08T10:00:00.000Z",
    updatedAt: "2026-09-08T10:01:00.000Z",
  }],
}, { verified: true, observedAt: "2026-09-08T10:02:00.000Z" });

assert.equal(verified.length, 1, "verified task should project");
assert.equal(verified[0].trust.state, "verified", "trusted snapshot should produce verified Workbench task");
assert.equal(verified[0].importable, true, "fresh verified task should be importable");
assert.deepEqual(verified[0].required_capabilities, ["research", "synthesis"], "capabilities should be bounded and deduplicated");
assert(!verified[0].summary.includes("/home/node/private.txt") && !verified[0].summary.includes("C:\\secret"), "browser summary must redact filesystem paths");
assert(!/signature|publicKeyPem|privateKey|secret/i.test(JSON.stringify(verified[0])), "Workbench records must not expose raw signatures or key material");
assert.equal(verified[0].identity_binding.node_id, "node-smoke-remote", "identity binding should include the exact origin node");
assert.equal(verified[0].identity_binding.agent_id, "agent-remote", "identity binding should include the exact origin agent");
assert.equal(verified[0].identity_binding.task_id, "task-remote", "identity binding should include the exact origin task");

const untrusted = federatedWorkbenchRecordsFromSnapshot(snapshot, {
  tasks: [{ id: "task-untrusted", title: "Untrusted task", description: "Public text", status: "open" }],
}, { verified: false, observedAt: "2026-09-08T10:03:00.000Z" });
assert.equal(untrusted[0].trust.state, "untrusted", "token-only or unverified snapshots should remain untrusted in the Workbench");
assert.equal(untrusted[0].importable, false, "untrusted tasks should not be importable");

const privateBody = federatedWorkbenchRecordsFromSnapshot(snapshot, {
  tasks: [{ id: "task-private", title: "Private marked task", description: "hidden private body", agentGuiRoom: "home", status: "open" }],
}, { verified: true, observedAt: "2026-09-08T10:04:00.000Z" });
assert.equal(privateBody[0].summary, "Private task body withheld by source protocol.", "private-marked task bodies should not enter browser payloads");

const staleOverview = publicFederatedWorkbenchOverview([{ ...verified[0], last_seen_at: "2026-09-08T09:00:00.000Z" }], {
  enabled: true,
  staleAfterMs: 1000,
  nowMs: Date.parse("2026-09-08T10:05:00.000Z"),
});
assert.equal(staleOverview.tasks[0].trust.state, "stale", "old verified records should become stale in public view");
assert.equal(staleOverview.tasks[0].importable, false, "stale records should not be importable");

const quarantine = federatedWorkbenchQuarantineFromSnapshot(snapshot, "stale_snapshot_rejected", { observedAt: "2026-09-08T10:06:00.000Z" });
assert.equal(quarantine.kind, "quarantine", "rejected snapshot should produce quarantine record");
assert.equal(quarantine.reason, "stale_snapshot_rejected", "quarantine reason should be bounded and machine-readable");
assert.equal(quarantine.remote_execution, false, "quarantine records must never imply execution authority");

console.log("Federated Workbench smoke passed.");
