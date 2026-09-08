import assert from "node:assert/strict";
import { buildMatchmakingView, inferRequiredSkills, normalizeMatchmakingJob, scoreProviderForJob } from "../apps/server/src/matchmaking.mjs";

const counts = { accepted_results: 2, verified_job_results: 1, claimed_deals: 1, refunded_deals: 0, disputed_deals: 0, unique_counterparties: 1 };
const localProvider = {
  id: "local:node-a:coder:did:key:zlocal",
  source: "local",
  agent_id: "coder",
  name: "Coder",
  did: "did:key:zlocal",
  node_id: "node-a",
  skills: ["coding", "testing", "review"],
  eligible: true,
  verification: { state: "verified", verified: true, stale: false, label: "LOCAL VERIFIED" },
  reputation: { status: "local_signed_record", counts },
};
const remoteProvider = {
  ...localProvider,
  id: "federated:node-b:remote-coder:did:key:zremote",
  source: "federated",
  agent_id: "remote-coder",
  name: "Remote Coder",
  did: "did:key:zremote",
  node_id: "node-b",
  reputation: { status: "signed_record", counts: { ...counts, accepted_results: 4 } },
};
const staleProvider = {
  ...localProvider,
  id: "federated:node-c:stale:did:key:zstale",
  source: "federated",
  agent_id: "stale-coder",
  name: "Stale Coder",
  did: "did:key:zstale",
  node_id: "node-c",
  eligible: false,
  verification: { state: "stale", verified: true, stale: true, label: "STALE" },
};

const required = inferRequiredSkills("JOB v1: Fix API bug and add Playwright tests\nSkills: coding, testing", ["coding", "testing", "review", "research", "synthesis"]);
assert.deepEqual(required, ["coding", "testing"]);

const job = normalizeMatchmakingJob({ room: "kibble", seq: 42, text: "JOB v1: Fix API bug and add Playwright tests from /home/user/private\nReward: 10 FLOP" }, { availableSkills: ["coding", "testing", "review"] });
assert.equal(job.id, "kibble:42");
assert(job.required_skills.includes("coding") && job.required_skills.includes("testing"), "job should infer coding/testing skills");
assert(!job.preview.includes("/home/user/private"), "job preview should redact filesystem paths");

const localScore = scoreProviderForJob(job, localProvider);
const remoteScore = scoreProviderForJob(job, remoteProvider);
const staleScore = scoreProviderForJob(job, staleProvider);
assert(localScore.eligible && localScore.authority.selectable_for_local_workspace, "local exact match should be locally selectable");
assert(remoteScore.eligible && !remoteScore.authority.selectable_for_local_workspace, "federated exact match should be recommendation-only");
assert(!staleScore.eligible && staleScore.authority.remote_execution === false && staleScore.authority.auto_bidding === false, "stale match should stay non-authoritative");

const view = buildMatchmakingView({
  jobs: [job],
  skillRegistry: { schema: "osa-skill-registry/1", available_skills: ["coding", "testing", "review"], providers: [remoteProvider, localProvider, staleProvider] },
  generatedAt: "2026-09-08T13:40:00.000Z",
});
assert.equal(view.schema, "osa-matchmaking/1");
assert.equal(view.policy.authority, "recommendation_only");
assert.equal(view.policy.remote_execution, false);
assert.equal(view.policy.connector_spawning, false);
assert.equal(view.policy.auto_bidding, false);
assert.equal(view.policy.payment, false);
assert.equal(view.matches[0].status, "matched");
assert.equal(view.matches[0].candidates[0].source, "local", "local verified exact match should sort first before Phase 5.3 bidding exists");
assert(!/privateKey|BEGIN PRIVATE KEY|pkcs8|seed|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}|\/home\/user\/private/i.test(JSON.stringify(view)), "matchmaking view should not expose raw secrets, signatures, or paths");
