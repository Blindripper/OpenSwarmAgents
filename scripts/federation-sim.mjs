import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = join(import.meta.dirname, "..");
const basePort = Number(process.env.OSA_FEDERATION_SIM_PORT || 21080 + Math.floor(Math.random() * 800));
const federationToken = "test-federation-token-with-enough-entropy";
const nodes = [];

try {
  const nodeA = await startNode("A", basePort, [basePort + 1]);
  const nodeB = await startNode("B", basePort + 1, [basePort, basePort + 2]);
  const nodeC = await startNode("C", basePort + 2, [basePort + 1]);
  nodes.push(nodeA, nodeB, nodeC);

  await expectGetStatus(nodeA, "/api/federation/snapshot", 401);
  await expectGetStatus(nodeA, "/api/federation/snapshot", 403, { "x-osa-federation-token": "wrong-token" });
  await expectPostStatus(nodeA, "/api/federation/import", 401, {
    protocol: "osa-federation-snapshot",
    collections: {}
  });

  const userA = await login(nodeA, "A");
  const userB = await login(nodeB, "B");
  await configureTrustedNodes(nodeA, nodeB, nodeC);
  await assertSignatureEnforcement(nodeA, nodeB);
  await assertPeerAnnouncements(nodeA, nodeB, userB.headers);
  await assertTrustedPeerDiscovery(nodeA, nodeB, nodeC, userA.headers);
  await assertPublicProjectSharing(nodeA, nodeB);
  await assertNetworkChatFederation(nodeA, nodeB, userB.headers);

  const proposal = await createProposal(nodeA, userA.headers);
  await assertTamperedSignatureRejected(nodeA, nodeB, proposal.id);
  await sync(nodeA, nodeB);
  assert((await state(nodeB, userB.headers)).proposals.some((item) => item.id === proposal.id), "node B should import node A proposal");

  await vote(nodeB, userB.headers, "B");
  await sync(nodeB, nodeA);
  const ledgerAAfterRemoteVote = await trustLedger(nodeA, userA.headers);
  const snapshotAAfterRemoteVote = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  assert(ledgerAAfterRemoteVote.head === snapshotAAfterRemoteVote.head, "federation snapshot head should match the local node ledger head");
  assert(
    ledgerAAfterRemoteVote.headsByNode?.[snapshotAAfterRemoteVote.node.nodeId] === ledgerAAfterRemoteVote.head,
    "Trust Ledger should expose the local head by node id"
  );
  assert(
    Object.keys(ledgerAAfterRemoteVote.headsByNode || {}).length >= 2,
    "Trust Ledger should keep imported peer heads separate from the local chain"
  );
  await vote(nodeA, userA.headers, "A");

  await delay(650);
  let stateA = await state(nodeA, userA.headers);
  const promoted = stateA.proposals.find((item) => item.id === proposal.id);
  assert(promoted?.status === "promoted", "node A should promote the federated voting winner");
  const goal = stateA.goals.find((item) => item.sourceProposalId === proposal.id);
  assert(goal?.status === "active", "node A should create worker goal after promotion");

  await sync(nodeA, nodeB);
  let stateB = await state(nodeB, userB.headers);
  assert(stateB.goals.some((item) => item.id === goal.id), "node B should import promoted worker goal");

  const agentA = await registerWorker(nodeA, userA.headers, goal.id, "A");
  await sync(nodeA, nodeB);
  const agentB = await registerWorker(nodeB, userB.headers, goal.id, "B");
  await sync(nodeB, nodeA);

  const firstClaim = await claim(nodeA, agentA.id, goal.id, userA.headers);
  assert(firstClaim.task?.type === "research", "node A agent should claim research");
  const taskId = firstClaim.task.id;
  const firstResult = await result(nodeA, agentA.id, firstClaim.task.id, userA.headers, {
    summary: "Federated first pass",
    content: "This first pass is deliberately incomplete, so the remote node should request revision.",
    artifacts: [
      {
        name: "local-path-should-not-federate.txt",
        path: "/var/lib/private-node-secret.txt",
        description: "Result metadata must not turn local filesystem paths into public artifact URIs."
      }
    ],
    sources: ["fed://initial"],
    confidence: 0.5
  });
  assert(firstResult.result.artifacts[0]?.uri === "", "local artifact paths should not become result artifact URIs");
  assert(firstResult.result.consensus.requiredAgentIds.includes(agentB.id), "remote node agent should be part of consensus");
  await sync(nodeA, nodeB);

  const reviewClaim = await claim(nodeB, agentB.id, goal.id, userB.headers);
  assert(reviewClaim.task?.reviewForResultId === firstResult.result.id, "node B should import and claim review task");
  await review(nodeB, agentB.id, firstResult.result.id, userB.headers, {
    decision: "needs_revision",
    score: 0.52,
    reason: "Remote reviewer requests stronger evidence before accepting the result."
  });
  await sync(nodeB, nodeA);

  stateA = await state(nodeA, userA.headers);
  assert(stateA.results.find((item) => item.id === firstResult.result.id).status === "needs_revision", "revision should federate back to node A");
  assert(stateA.tasks.find((item) => item.id === taskId).iteration === 2, "node A should see task iteration advance");

  await sync(nodeA, nodeB);
  const improvedClaim = await claim(nodeB, agentB.id, goal.id, userB.headers);
  assert(improvedClaim.task?.id === taskId, "node B should claim revised task");
  assert(improvedClaim.context.priorResults.some((item) => item.id === firstResult.result.id), "node B should receive prior result context");
  const improvedResult = await result(nodeB, agentB.id, improvedClaim.task.id, userB.headers, {
    summary: "Federated accepted research",
    content: "The revised result incorporates remote feedback, separates evidence from assumptions, and adds validation steps.",
    sources: ["fed://initial", "fed://review", "fed://validation"],
    confidence: 0.86
  });
  await sync(nodeB, nodeA);

  const acceptClaim = await claim(nodeA, agentA.id, goal.id, userA.headers);
  assert(acceptClaim.task?.reviewForResultId === improvedResult.result.id, "node A should review remote improved result");
  await review(nodeA, agentA.id, improvedResult.result.id, userA.headers, {
    decision: "accepted",
    score: 0.92,
    reason: "The revised result is evidence-aware and ready to publish."
  });
  await sync(nodeA, nodeB);

  stateB = await state(nodeB, userB.headers);
  assert(stateB.results.find((item) => item.id === improvedResult.result.id).status === "accepted", "accepted result should federate to node B");
  assert(stateB.resultPool.some((item) => item.resultId === improvedResult.result.id), "accepted result should publish on node B");

  const synthesisClaim = await claim(nodeB, agentB.id, goal.id, userB.headers);
  assert(synthesisClaim.task?.type === "synthesis", "node B should claim remaining synthesis task");
  const synthesis = await result(nodeB, agentB.id, synthesisClaim.task.id, userB.headers, {
    summary: "Federated final plan",
    content: "Final cross-node plan with milestones, validation checkpoints, and publication criteria.",
    sources: ["fed://accepted-research", "fed://plan"],
    confidence: 0.88
  });
  await sync(nodeB, nodeA);
  const synthesisReview = await claim(nodeA, agentA.id, goal.id, userA.headers);
  assert(synthesisReview.task?.reviewForResultId === synthesis.result.id, "node A should review federated synthesis");
  await review(nodeA, agentA.id, synthesis.result.id, userA.headers, {
    decision: "accepted",
    score: 0.91,
    reason: "The final plan matches the accepted research and is ready to publish."
  });
  await sync(nodeA, nodeB);

  stateB = await state(nodeB, userB.headers);
  assert(stateB.goals.find((item) => item.id === goal.id).status === "completed", "completed goal should federate to node B");
  assert(stateB.agents.filter((agent) => agent.goalId === goal.id && agent.status === "online").length === 0, "completed federated project should disconnect agents");
  assert(stateB.events.some((event) => event.type === "federation_imported"), "activity feed should show federation imports");

  const snapshotAForPrivacyProbe = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  await postJson(
    nodeB,
    "/api/federation/import",
    {
      protocol: "osa-federation-snapshot",
      node: snapshotAForPrivacyProbe.node,
      collections: {
        agents: [
          {
            ...agentB,
            name: "Federated Shadow Agent",
            userId: null,
            connectorTokenId: null,
            createdAt: "2999-01-01T00:00:00.000Z"
          }
        ],
        events: [
          {
            id: "event-federation-privacy-probe",
            type: "privacy_probe",
            message: "Imported event data should stay scalar and non-secret.",
            data: {
              userId: userB.user.id,
              connectorTokenId: "connector-secret",
              token: "raw-secret",
              kept: "scalar",
              nested: { secret: true }
            },
            createdAt: "2999-01-01T00:00:00.000Z"
          }
        ]
      }
    },
    nodeB.federationHeaders
  );
  stateB = await state(nodeB, userB.headers);
  const preservedAgent = stateB.agents.find((agent) => agent.id === agentB.id);
  assert(preservedAgent.userId === userB.user.id, "federated agent merges must preserve the local owner userId");
  const importedEvent = stateB.events.find((event) => event.id === "event-federation-privacy-probe");
  assert(importedEvent.data.kept === "scalar", "federated event data should preserve scalar metadata");
  assert(!("userId" in importedEvent.data), "federated event data should drop userId");
  assert(!("connectorTokenId" in importedEvent.data), "federated event data should drop connectorTokenId");
  assert(!("token" in importedEvent.data), "federated event data should drop raw token fields");
  assert(!("nested" in importedEvent.data), "federated event data should drop nested objects");

  console.log(
    JSON.stringify(
      {
        ok: true,
        nodeA: nodeA.baseUrl,
        nodeB: nodeB.baseUrl,
        proposalId: proposal.id,
        goalId: goal.id,
        finalGoalStatus: stateB.goals.find((item) => item.id === goal.id).status,
        publishedResults: stateB.resultPool.filter((item) => item.goalId === goal.id).length
      },
      null,
      2
    )
  );
} finally {
  await Promise.all(nodes.map((node) => stopNode(node)));
}

async function startNode(label, port, peerPorts) {
  const dataDir = await mkdtemp(join(tmpdir(), `osa-fed-${label.toLowerCase()}-`));
  const openClawFixturePath = join(dataDir, "openclaw-fixture.sh");
  await writeFile(
    openClawFixturePath,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' '{\"final\":\"{\\\"summary\\\":\\\"Done\\\",\\\"content\\\":\\\"Finished by the federation E2E fixture.\\\",\\\"sources\\\":[\\\"fixture://federation\\\"],\\\"confidence\\\":0.9}\"}'"
    ].join("\n")
  );
  await chmod(openClawFixturePath, 0o755);
  const server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OSA_DATA_DIR: dataDir,
      OSA_UPLOAD_DIR: join(dataDir, "uploads"),
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_LOCAL_PASSWORD_REQUIRED: "0",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_FEDERATION_ENABLED: "1",
      OSA_FEDERATION_TOKEN: federationToken,
      OSA_FEDERATION_PEERS: peerPorts.map((peerPort) => `http://127.0.0.1:${peerPort}`).join(","),
      OSA_FEDERATION_ADVERTISE_URL: `http://127.0.0.1:${port}`,
      OSA_FEDERATION_DISCOVERY: "1",
      OSA_FEDERATION_REQUIRE_SIGNATURES: "1",
      OSA_FEDERATION_TRUSTED_NODES_PATH: join(dataDir, "trusted-nodes.json"),
      OSA_FEDERATION_SYNC_MS: "1000",
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      OSA_OPENCLAW_COMMAND: openClawFixturePath,
      AGENTSWARM_PROPOSAL_VOTING_MS: "500"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const node = {
    label,
    port,
    dataDir,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    trustedNodesPath: join(dataDir, "trusted-nodes.json"),
    federationHeaders: { "x-osa-federation-token": federationToken }
  };
  await waitForHealth(node);
  return node;
}

async function stopNode(node) {
  node.server.kill("SIGTERM");
  await waitForExit(node.server, 3000);
  await rm(node.dataDir, { recursive: true, force: true });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function configureTrustedNodes(...nodesToTrust) {
  const snapshots = await Promise.all(nodesToTrust.map((node) => getJson(node, "/api/federation/snapshot", node.federationHeaders)));
  for (let index = 0; index < nodesToTrust.length; index += 1) {
    const node = nodesToTrust[index];
    const ownNodeId = snapshots[index].node.nodeId;
    await writeTrustedNodes(
      node,
      snapshots.map((snapshot) => snapshot.node).filter((peer) => peer.nodeId !== ownNodeId)
    );
  }
}

async function writeTrustedNodes(node, peers) {
  const trusted = {};
  for (const peer of peers) {
    trusted[peer.nodeId] = {
      publicKeyPem: peer.publicKeyPem,
      algorithm: peer.algorithm || "Ed25519"
    };
  }
  await writeFile(node.trustedNodesPath, `${JSON.stringify(trusted, null, 2)}\n`);
}

async function assertSignatureEnforcement(nodeA, nodeB) {
  const snapshotA = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  await expectPostStatus(
    nodeB,
    "/api/federation/import",
    403,
    {
      ...snapshotA,
      node: {
        ...snapshotA.node,
        nodeId: "node-untrusted-transport"
      }
    },
    nodeB.federationHeaders
  );
}

async function assertTamperedSignatureRejected(from, to, proposalId) {
  const snapshot = await getJson(from, "/api/federation/snapshot", from.federationHeaders);
  const proposal = snapshot.collections.proposals.find((item) => item.id === proposalId);
  assert(proposal?.signature?.signature, "fresh proposal should carry a signature");
  proposal.title = `${proposal.title} tampered`;
  await expectPostStatus(to, "/api/federation/import", 400, { snapshot }, to.federationHeaders);
}

async function assertPeerAnnouncements(nodeA, nodeB, headersB) {
  const snapshotA = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  const announcement = snapshotA.collections.federationPeerAnnouncements.find((item) => item.nodeId === snapshotA.node.nodeId);
  assert(announcement?.signature?.signature, "local peer announcement should carry a federation signature");
  assert(announcement.advertiseUrl === nodeA.baseUrl, "local peer announcement should advertise the configured node URL");

  const tamperedSnapshot = structuredClone(snapshotA);
  tamperedSnapshot.collections.federationPeerAnnouncements.find((item) => item.id === announcement.id).advertiseUrl = "http://127.0.0.1:9";
  await expectPostStatus(nodeB, "/api/federation/import", 400, { snapshot: tamperedSnapshot }, nodeB.federationHeaders);

  await sync(nodeA, nodeB);
  const stateB = await state(nodeB, headersB);
  assert(
    stateB.federationPeerAnnouncements.some((item) => item.nodeId === snapshotA.node.nodeId && item.advertiseUrl === nodeA.baseUrl),
    "node B should retain node A's signed peer announcement"
  );
}

async function assertTrustedPeerDiscovery(nodeA, nodeB, nodeC, headersA) {
  await createAndShareDashboardProject(nodeC, "Node C Bootstrap Project", "C public bootstrap project");
  await sync(nodeC, nodeB);
  await waitForJson(
    nodeA,
    "/api/state",
    (snapshot) =>
      snapshot.runtime?.federationDiscoveredPeerCount >= 1
      && snapshot.federationPeerAnnouncements.some((item) => item.nodeId && item.advertiseUrl === nodeC.baseUrl),
    "node A should learn node C's signed peer announcement through node B",
    headersA
  );

  await createAndShareDashboardProject(nodeC, "Node C Discovered Project", "C public project reached through discovery");
  await waitForJson(
    nodeA,
    "/api/state",
    (snapshot) =>
      snapshot.events.some((event) => event.type === "federation_imported" && event.data?.peer === nodeC.baseUrl)
      && snapshot.federationPeerAnnouncements.some((item) => item.advertiseUrl === nodeC.baseUrl),
    "node A should sync the discovered node C URL directly",
    headersA
  );
  await assertTopProjects(nodeA, ["Node C Discovered Project"]);
}

async function sync(from, to) {
  const snapshot = await getJson(from, "/api/federation/snapshot", from.federationHeaders);
  const imported = await postJson(to, "/api/federation/import", { snapshot }, to.federationHeaders);
  assert(imported.ok, `sync ${from.label}->${to.label} should import successfully`);
  return imported;
}

async function assertPublicProjectSharing(nodeA, nodeB) {
  const shareA = await createAndShareDashboardProject(nodeA, "Node A Alpha Project", "A private revenue project");
  const idA = shareA.project.id.replace("public-project-", "");
  assert(idA !== "project-local", "shared project ids should be scoped to the publishing node");
  await postJson(nodeA, "/api/donations", {
    session_id: shareA.project.id,
    target_type: "project",
    target_id: idA,
    amount: 2,
    wallet_address: "0x00000000000000000000000000000000000000aa",
    chain_id: "0x1"
  });
  await postJson(nodeA, `/api/public/projects/${encodeURIComponent(idA)}/reviews`, {
    wallet_address: "0x00000000000000000000000000000000000000aa",
    rating: 5,
    title: "Federates cleanly",
    comment: "The remote node should see this signed project review."
  });
  await assertSignedPublicRecordTamperRejected(nodeA, nodeB, idA);
  const firstSnapshotA = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  await sync(nodeA, nodeB);
  const replayImport = await postJson(nodeB, "/api/federation/import", { snapshot: firstSnapshotA }, nodeB.federationHeaders);
  assert(replayImport.ok && replayImport.changedTotal === 0, "reimporting the same peer snapshot should be idempotent");
  await postJson(nodeA, `/api/public/projects/${encodeURIComponent(idA)}/reviews`, {
    wallet_address: "0x00000000000000000000000000000000000000aa",
    rating: 4,
    title: "Federates cleanly after update",
    comment: "The newer signed snapshot should advance the peer head."
  });
  await sync(nodeA, nodeB);
  await expectPostStatus(nodeB, "/api/federation/import", 409, { snapshot: firstSnapshotA }, nodeB.federationHeaders);
  await assertTopProjects(nodeB, ["Node A Alpha Project"]);
  await assertTopProject(nodeB, "Node A Alpha Project", (project) => project.donation_total_usdc === 2, "donation totals should federate");
  await assertTopProject(nodeB, "Node A Alpha Project", (project) => project.review_count === 1, "project reviews should federate");
  await assertNoImportedHomeDesk(nodeB, "A private revenue project");

  const shareB = await createAndShareDashboardProject(nodeB, "Node B Beta Project", "B private security project");
  const idB = shareB.project.id.replace("public-project-", "");
  assert(idB !== idA, "independent nodes should publish projects under distinct ids");
  await sync(nodeB, nodeA);
  await sync(nodeA, nodeB);
  await assertTopProjects(nodeA, ["Node A Alpha Project", "Node B Beta Project"]);
  await assertTopProjects(nodeB, ["Node A Alpha Project", "Node B Beta Project"]);
  await assertNoImportedHomeDesk(nodeA, "B private security project");

  await postJson(nodeB, `/api/sessions/${encodeURIComponent(shareA.project.id)}/copy`, {});
  await assertSignedCopyEventTamperRejected(nodeB, nodeA, idA);
  await sync(nodeB, nodeA);
  await assertTopProject(nodeA, "Node A Alpha Project", (project) => project.copy_count === 1, "copy counts should federate back to the publisher");
  await assertTopProject(nodeA, "Node A Alpha Project", (project) => project.copy_event_count === 1, "copy event counts should federate back to the publisher");

  await createDashboardTask(nodeB, "B private draft not shared");
  const snapshotB = await getJson(nodeB, "/api/federation/snapshot", nodeB.federationHeaders);
  assert(
    !snapshotB.collections.tasks.some((task) => task.title === "B private draft not shared"),
    "unshared AgentGUI Home tasks should not be exported in federation snapshots"
  );
  assert(
    !snapshotB.collections.goals.some((goal) => goal.title === "B private draft not shared"),
    "unshared AgentGUI Home goals should not be exported in federation snapshots"
  );
  await sync(nodeB, nodeA);
  await assertTopProjects(nodeA, ["Node A Alpha Project", "Node B Beta Project"]);
  await assertNoImportedHomeDesk(nodeA, "B private draft not shared");
}

async function assertNetworkChatFederation(nodeA, nodeB, headersB) {
  await postJson(nodeA, "/api/network/chat", {
    wallet_address: "0x00000000000000000000000000000000000000aa",
    message: "Node A says hello from Network Activity."
  });
  const snapshotA = await getJson(nodeA, "/api/federation/snapshot", nodeA.federationHeaders);
  const chat = snapshotA.collections.networkChatMessages.find((item) => item.message.includes("Network Activity"));
  assert(chat?.signature?.signature, "network chat messages should carry a federation signature");

  const tamperedSnapshot = structuredClone(snapshotA);
  tamperedSnapshot.collections.networkChatMessages.find((item) => item.id === chat.id).message = "Tampered network chat";
  await expectPostStatus(nodeB, "/api/federation/import", 400, { snapshot: tamperedSnapshot }, nodeB.federationHeaders);

  await sync(nodeA, nodeB);
  const stateB = await state(nodeB, headersB);
  assert(
    stateB.networkChatMessages.some((item) => item.message.includes("Network Activity")),
    "node B should import signed network chat messages"
  );
  const chatListB = await getJson(nodeB, "/api/network/chat?limit=20");
  assert(
    chatListB.messages.some((item) => item.message.includes("Network Activity")),
    "node B should expose imported network chat messages to AgentGUI"
  );
}

async function assertSignedPublicRecordTamperRejected(from, to, projectId) {
  const snapshot = await getJson(from, "/api/federation/snapshot", from.federationHeaders);
  const project = snapshot.collections.publicProjects.find((item) => item.id === projectId);
  const review = snapshot.collections.publicProjectReviews.find((item) => item.projectId === projectId);
  const donation = snapshot.collections.agentDonations.find((item) => item.targetId === projectId);
  assert(project?.signature?.signature, "fresh public project should carry a federation signature");
  assert(review?.signature?.signature, "fresh public project review should carry a federation signature");
  assert(donation?.signature?.signature, "fresh project donation should carry a federation signature");

  const tamperedProjectSnapshot = structuredClone(snapshot);
  tamperedProjectSnapshot.collections.publicProjects.find((item) => item.id === projectId).name = "Tampered Project Name";
  await expectPostStatus(to, "/api/federation/import", 400, { snapshot: tamperedProjectSnapshot }, to.federationHeaders);

  const tamperedReviewSnapshot = structuredClone(snapshot);
  tamperedReviewSnapshot.collections.publicProjectReviews.find((item) => item.projectId === projectId).rating = 1;
  await expectPostStatus(to, "/api/federation/import", 400, { snapshot: tamperedReviewSnapshot }, to.federationHeaders);

  const tamperedDonationSnapshot = structuredClone(snapshot);
  tamperedDonationSnapshot.collections.agentDonations.find((item) => item.targetId === projectId).amount = 200;
  await expectPostStatus(to, "/api/federation/import", 400, { snapshot: tamperedDonationSnapshot }, to.federationHeaders);
}

async function assertSignedCopyEventTamperRejected(from, to, projectId) {
  const snapshot = await getJson(from, "/api/federation/snapshot", from.federationHeaders);
  const copy = snapshot.collections.publicProjectCopies.find((item) => item.projectId === projectId);
  assert(copy?.signature?.signature, "fresh project copy should carry a federation signature");
  const tamperedCopySnapshot = structuredClone(snapshot);
  tamperedCopySnapshot.collections.publicProjectCopies.find((item) => item.id === copy.id).projectId = "project-tampered-copy-target";
  await expectPostStatus(to, "/api/federation/import", 400, { snapshot: tamperedCopySnapshot }, to.federationHeaders);
}

async function createAndShareDashboardProject(node, name, content) {
  await createDashboardTask(node, content);
  return postJson(node, "/api/public/projects/share", {
    name,
    rooms: [{ id: "home-room", name: "Home" }]
  });
}

async function createDashboardTask(node, content) {
  const created = await postJson(node, "/api/sessions/new", {
    content,
    team_id: "home-room",
    agent: "moneymaker"
  });
  await waitForJson(
    node,
    "/api/sessions",
    (items) => items.find((session) => session.id === created.session_id && session.task_solved === true),
    `dashboard task on node ${node.label}`
  );
  return created;
}

async function assertTopProjects(node, names) {
  const top = await getJson(node, "/api/top-projects?limit=100");
  const titles = top.agents.map((project) => project.title);
  for (const name of names) {
    assert(titles.includes(name), `node ${node.label} should see public project ${name}; saw ${titles.join(", ")}`);
  }
}

async function assertTopProject(node, name, predicate, message) {
  const top = await getJson(node, "/api/top-projects?limit=100");
  const project = top.agents.find((item) => item.title === name);
  assert(project, `node ${node.label} should see public project ${name}`);
  assert(predicate(project), `${message}; saw ${JSON.stringify(project)}`);
}

async function assertNoImportedHomeDesk(node, content) {
  const sessions = await getJson(node, "/api/sessions");
  assert(
    !sessions.some((session) => session.team_id === "home-room" && session.title === content),
    `node ${node.label} should not import peer project source tasks into Home`
  );
}

async function login(node, label) {
  const response = await postJson(node, "/api/auth/login", {
    email: `node-${label.toLowerCase()}@federation-sim.example`,
    name: `Federated Node ${label}`,
    password: ""
  });
  return { user: response.user, headers: { "x-agentswarm-session": response.sessionToken } };
}

async function createProposal(node, headers) {
  const response = await postJson(
    node,
    "/api/proposals",
    {
      title: "Federated agent trust network",
      description:
        "Create a federated agent trust network where independent OpenSwarmAgents nodes exchange signed proposals, votes, results, reviews, and final artifacts while preserving local ownership."
    },
    headers
  );
  return response.proposal;
}

async function vote(node, headers, label) {
  return postJson(
    node,
    "/api/voting/connect",
    {
      name: `Federated Node ${label} Voting Agent`,
      provider: "openai",
      providers: ["openai", "anthropic", "gemini"]
    },
    headers
  );
}

async function registerWorker(node, headers, goalId, label) {
  const response = await postJson(
    node,
    "/api/agents/register",
    {
      name: `Federated Node ${label} Worker`,
      goalId,
      capabilities: ["research", "review", "synthesis"],
      models: [`fed-node-${label.toLowerCase()}`],
      provider: "openai",
      providers: ["openai", "anthropic", "gemini"],
      maxConcurrentTasks: 1
    },
    headers
  );
  return response.agent;
}

async function claim(node, agentId, goalId, headers = {}) {
  return postJson(node, "/api/tasks/claim", { agentId, goalId }, headers);
}

async function result(node, agentId, taskId, headers = {}, body) {
  return postJson(node, `/api/tasks/${taskId}/result`, { agentId, ...body }, headers);
}

async function review(node, agentId, resultId, headers = {}, body) {
  return postJson(node, `/api/results/${resultId}/review`, { agentId, ...body }, headers);
}

async function state(node, headers) {
  return getJson(node, "/api/state", headers);
}

async function trustLedger(node, headers) {
  return getJson(node, "/api/trust-ledger", headers);
}

async function waitForJson(node, path, predicate, label, headers = {}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const payload = await getJson(node, path, headers);
    const match = predicate(payload);
    if (match) return match;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHealth(node) {
  const started = Date.now();
  let logs = "";
  node.server.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  node.server.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  while (Date.now() - started < 8000) {
    try {
      const health = await getJson(node, "/api/health");
      if (health.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Node ${node.label} did not become healthy:\n${logs}`);
}

async function getJson(node, path, headers = {}) {
  const response = await fetch(`${node.baseUrl}${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${node.label}${path} failed ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function expectGetStatus(node, path, status, headers = {}) {
  const response = await fetch(`${node.baseUrl}${path}`, { headers });
  const text = await response.text();
  assert(response.status === status, `GET ${node.label}${path} should return ${status}, got ${response.status}: ${text}`);
}

async function postJson(node, path, body, headers = {}) {
  const response = await fetch(`${node.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${node.label}${path} failed ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function expectPostStatus(node, path, status, body, headers = {}) {
  const response = await fetch(`${node.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert(response.status === status, `POST ${node.label}${path} should return ${status}, got ${response.status}: ${text}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
