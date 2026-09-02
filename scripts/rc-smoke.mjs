import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_RC_SMOKE_PORT || 19080 + Math.floor(Math.random() * 800));
const technocorePort = port + 1;
const baseUrl = `http://127.0.0.1:${port}`;
const technocoreBaseUrl = `http://127.0.0.1:${technocorePort}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-rc-smoke-"));
const testWalletPrivateKey = Uint8Array.from(Buffer.from("1111111111111111111111111111111111111111111111111111111111111111", "hex"));
const testWalletAddress = ethereumAddressFromPrivateKey(testWalletPrivateKey);
const technocoreWrites = [];
const technocoreReads = [];
let server = null;
let technocoreServer = null;

try {
  await assertProductionLocalValidation();
  technocoreServer = await startTechnocoreFixture();
  server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OSA_DATA_DIR: dataDir,
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_LOCAL_PASSWORD_REQUIRED: "1",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      OSA_TECHNOCORE_ENABLED: "1",
      OSA_TECHNOCORE_URL: technocoreBaseUrl,
      OSA_TECHNOCORE_PUBLIC_ROOM: "osa-network",
      OSA_TECHNOCORE_ROOMS: "osa-lab",
      OSA_TECHNOCORE_ROOM_LIMIT: "2",
      OSA_TECHNOCORE_ANNOUNCE: "1",
      OSA_PUBLIC_URL: "https://osa.example",
      AGENTSWARM_PROPOSAL_VOTING_MS: "1",
      OSA_GITHUB_CLIENT_ID: "rc-smoke-github-client",
      OSA_GITHUB_CLIENT_SECRET: "rc-smoke-github-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  const health = await getJson("/api/health");
  assert(health.ok, "health endpoint should be ok");
  assert(health.runtime.authMode === "local", "auth mode should default to local");
  assert(health.runtime.localLoginEnabled === true, "local login should be enabled in smoke");
  assert(health.runtime.localPasswordRequired === true, "local password should be required in smoke");
  assert(health.runtime.walletNonceLoginEnabled === true, "wallet login should require signed nonce challenges");
  assert(health.runtime.node?.nodeId, "node identity should be public");
  assert(health.runtime.technocoreEnabled === true, "Technocore bridge should be visible in runtime status when enabled");
  assert(health.runtime.technocorePublicRoom === "osa-network", "Technocore public channel room should be visible in runtime status");
  assert(health.runtime.technocoreRooms?.includes("osa-lab"), "Technocore runtime status should expose configured read rooms");
  assert(health.runtime.technocoreRooms?.includes("osa-network"), "Technocore public channel should be included in read rooms");
  assert(health.runtime.technocoreAnnounceEnabled === true, "Technocore announce status should be visible when configured");
  assert(health.runtime.technocoreReadHedgeMs === 1200, "Technocore read hedge timing should be visible in runtime status");
  assert(health.runtime.technocoreSignedMessages === true, "Technocore writes should use the signed DID lane by default");
  assert(String(health.runtime.technocoreDid || "").startsWith("did:key:z6Mk"), "Technocore DID should be derived from the OSA node identity");
  const channels = await getJson("/api/network/channels?limit=10");
  assert(channels.channels.some((item) => item.id === "osa-network" && item.pinned === true), "Channel list should include pinned osa-network");
  assert(channels.channels.some((item) => item.id === "osa-lab"), "Channel list should include available Technocore channels");
  assert(channels.channels.some((item) => item.id === "builders" && item.category === "main"), "Channel list should include known main Technocore channels");
  const bridgedActivity = await getJson("/api/network/activity?limit=10");
  const bridgedEvent = bridgedActivity.events.find((item) => item.type === "technocore_chat_message");
  assert(!bridgedEvent, "OSA Network Activity should not include raw Technocore room messages");
  const publicChannel = await getJson("/api/network/chat?limit=10&channel=osa-network");
  assert(publicChannel.messages.some((item) => item.source === "technocore" && item.room === "osa-network"), "osa-network should include the Technocore OSA room");
  const labChannel = await getJson("/api/network/chat?limit=10&channel=osa-lab");
  assert(labChannel.messages.some((item) => item.source === "technocore" && item.room === "osa-lab"), "Pinned Technocore channels should read their selected room");
  await getJson("/api/network/chat?limit=10&channel=osa-lab&since=41");
  await getJson("/api/network/chat?limit=10&channel=osa-lab&since=41");
  const cursorReads = technocoreReads.filter((item) => item.room === "osa-lab" && item.since === "41");
  assert(cursorReads.length === 2, "Technocore cursor reads should reach the selected room fixture");
  assert(cursorReads.every((item) => /^\d+$/.test(item.cacheBuster) && item.wait === "1"), "Technocore cursor reads should use long polling with an integer cache buster");
  assert(new Set(cursorReads.map((item) => item.cacheBuster)).size === 2, "Technocore cursor reads should never reuse a cache key");
  const labPost = await postJson("/api/network/chat", {
    channel: "osa-lab",
    message: "RC smoke direct Technocore channel write"
  });
  assert(labPost.message?.source === "technocore" && labPost.message?.room === "osa-lab", "Non-public Technocore channel posts should stay external");
  assert(technocoreWrites.some((item) => item.room === "osa-lab" && item.text.includes("RC smoke direct Technocore channel write") && item.from.startsWith("did:key:z6Mk")), "Technocore fixture should receive selected-channel text from the OSA DID");
  const mirroredChat = await postJson("/api/network/chat", {
    message: "RC smoke public channel mirror",
    wallet_address: testWalletAddress
  });
  assert(mirroredChat.technocore_mirrored === true, "osa-network posts should mirror to the Technocore OSA room when enabled");
  assert(technocoreWrites.some((item) => item.room === "osa-network" && item.text.includes("RC smoke public channel mirror") && item.from.startsWith("did:key:z6Mk")), "Technocore fixture should receive mirrored osa-network text from the OSA DID");
  const mirroredChannel = await getJson("/api/network/chat?limit=20");
  assert(
    mirroredChannel.messages.filter((item) => item.message === "RC smoke public channel mirror").length === 1,
    "osa-network should not duplicate local messages mirrored back from Technocore"
  );

  const rootShell = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert(rootShell.status === 302 && rootShell.headers.get("location") === "/osa-network/", "root should redirect to OSA Network");
  const legacyShell = await fetch(`${baseUrl}/agent-gui/`, { redirect: "manual" });
  assert(legacyShell.status === 302 && legacyShell.headers.get("location") === "/osa-network/", "legacy AgentGUI path should redirect to OSA Network");
  const shell = await fetch(`${baseUrl}/osa-network/`);
  const shellText = await shell.text();
  const csp = shell.headers.get("content-security-policy") || "";
  const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) || "";
  assert(shell.ok, "app shell should be served");
  assert(csp.includes("script-src 'self'"), "CSP should restrict scripts to same origin");
  assert(!scriptSrc.includes("unsafe-inline"), "CSP should not allow inline scripts");
  assert(shellText.includes("<title>OSA</title>"), "AgentGUI app shell should be served");
  const appScriptPath = shellText.match(/<script[^>]+src=\"([^\"]+)\"/)?.[1];
  assert(appScriptPath, "AgentGUI app shell should load an external JS bundle");
  const appJs = await (await fetch(`${baseUrl}${appScriptPath}`)).text();
  assert(!appJs.includes("agentswarmWorkerConnectorToken"), "browser app should not persist raw connector tokens");

  const lockedState = await getJson("/api/state");
  assert(!lockedState.viewer, "unauthenticated state should not include a viewer");
  assert(lockedState.goals.length === 0, "unauthenticated state should not expose goals");
  assert(lockedState.tasks.length === 0, "unauthenticated state should not expose tasks");
  assert(lockedState.proposals.length === 0, "unauthenticated state should not expose proposals");
  assert(lockedState.stats.users === 0, "unauthenticated state should not expose user counts");
  await expectGetStatus("/api/trust-ledger", 401);
  await expectGetStatus("/api/events/stream", 401);
  await expectStatus("/api/agents/register", 401, {
    name: "Unauthenticated Agent",
    goalId: "goal-agent-collab",
    capabilities: ["research"],
    models: ["smoke"]
  });
  await expectStatus("/api/voting/connect", 401, {
    name: "Unauthenticated Voting Agent"
  });
  const oauthStart = await fetch(`${baseUrl}/api/auth/oauth/github/start?redirect=/`, { redirect: "manual" });
  assert(oauthStart.status === 302, "OAuth start should redirect when provider credentials are configured");
  const oauthCookie = oauthStart.headers.get("set-cookie") || "";
  const oauthLocation = oauthStart.headers.get("location") || "";
  assert(oauthCookie.includes("osa_oauth_state="), "OAuth start should bind state to an HttpOnly cookie");
  assert(oauthCookie.includes("HttpOnly"), "OAuth state cookie should be HttpOnly");
  assert(oauthCookie.includes("SameSite=Strict"), "OAuth state cookie should use SameSite=Strict");
  const oauthState = new URL(oauthLocation).searchParams.get("state");
  assert(oauthState && oauthCookie.includes(encodeURIComponent(oauthState)), "OAuth cookie should match redirect state");
  const oauthCallbackWithoutCookie = await fetch(`${baseUrl}/api/auth/oauth/github/callback?code=fake-code&state=${encodeURIComponent(oauthState)}`, {
    redirect: "manual"
  });
  assert(oauthCallbackWithoutCookie.status === 302, "OAuth callback without state cookie should redirect");
  assert(
    (oauthCallbackWithoutCookie.headers.get("location") || "").includes("error=invalid_callback"),
    "OAuth callback without state cookie should be rejected before provider exchange"
  );

  await expectStatus("/api/auth/login", 400, {
    email: "rc@example.com",
    name: "RC",
    password: "short"
  });

  await expectStatus("/api/wallet/login", 400, {
    address: testWalletAddress,
    chain_id: "0x1"
  });
  const walletChallenge = await postJson("/api/wallet/challenge", {
    address: testWalletAddress,
    chain_id: "0x1"
  });
  assert(walletChallenge.challenge?.message?.includes("OpenSwarmAgents wallet login"), "wallet challenge should return the exact signable message");
  await expectStatus("/api/wallet/login", 403, {
    address: testWalletAddress,
    chain_id: "0x1",
    challenge_id: walletChallenge.challenge.id,
    message: walletChallenge.challenge.message,
    signature: signPersonalMessage("wrong message")
  });
  const walletLogin = await postJson("/api/wallet/login", {
    address: testWalletAddress,
    chain_id: "0x1",
    challenge_id: walletChallenge.challenge.id,
    message: walletChallenge.challenge.message,
    signature: signPersonalMessage(walletChallenge.challenge.message)
  });
  assert(walletLogin.sessionToken, "verified wallet login should return a local OSA session token");
  assert(walletLogin.wallet?.verified === true, "verified wallet login should mark the wallet session verified");
  await expectStatus("/api/wallet/login", 400, {
    address: testWalletAddress,
    chain_id: "0x1",
    challenge_id: walletChallenge.challenge.id,
    message: walletChallenge.challenge.message,
    signature: signPersonalMessage(walletChallenge.challenge.message)
  });

  const firstLogin = await postJson("/api/auth/login", {
    email: "rc@example.com",
    name: "RC",
    password: "local-password-123"
  });
  assert(firstLogin.sessionToken, "first login should return a session token");

  await expectStatus("/api/auth/login", 403, {
    email: "rc@example.com",
    name: "RC",
    password: "local-password-999"
  });

  const login = await postJson("/api/auth/login", {
    email: "rc@example.com",
    name: "RC",
    password: "local-password-123"
  });
  const headers = { "x-agentswarm-session": login.sessionToken };
  const realtime = await openSse(headers);
  await realtime.waitFor("connected");

  const proposal = await postJson(
    "/api/proposals",
    {
      title: "RC Trust Ledger Proposal",
      description:
        "This release-candidate smoke proposal is intentionally long enough to verify local auth, signed proposal creation, and Trust Ledger append behavior."
    },
    headers
  );
  assert(proposal.proposal.signature?.signature, "proposal should be signed");
  const proposalEvent = await realtime.waitFor("activity");
  assert(proposalEvent.type === "proposal_created", "realtime stream should broadcast proposal creation");

  const vote = await postJson(
    "/api/voting/connect",
    {
      name: "RC Voting Agent",
      provider: "openai",
      providers: ["openai"]
    },
    headers
  );
  assert(vote.vote.signature?.signature, "proposal vote should be signed");
  await expectStatus(`/api/agents/${vote.agent.id}/heartbeat`, 401, {});
  await expectStatus(`/api/proposals/${proposal.proposal.id}/vote`, 401, {
    agentId: vote.agent.id,
    score: 1,
    reason: "Bare agent IDs must not authorize proposal votes."
  });
  await expectStatus(`/api/agents/${vote.agent.id}/heartbeat`, 200, {}, headers);

  const votingConnector = await postJson(
    "/api/connectors/token",
    {
      mode: "voting",
      name: "RC Voting Connector",
      models: ["connector:stub"]
    },
    headers
  );
  assert(votingConnector.token.startsWith("osa_conn_"), "voting connector token should be returned once");
  const votingConnectorHeaders = { "x-osa-connector-token": votingConnector.token };
  await postJson(
    "/api/voting/connect",
    {
      name: "RC Voting Connector",
      models: ["connector:stub"]
    },
    votingConnectorHeaders
  );
  await delay(5);
  const connectorAuditState = await getJson("/api/state", headers);
  const usedVotingConnector = connectorAuditState.viewerConnectors.find((item) => item.id === votingConnector.connector.id);
  assert(usedVotingConnector?.useCount >= 1, "connector audit should count scoped token use");
  assert(usedVotingConnector?.lastUsedPath === "/api/voting/connect", "connector audit should record the last used API path");
  const workerGoalId = connectorAuditState.goals.find((goal) => goal.sourceProposalId === proposal.proposal.id)?.id;
  assert(workerGoalId, "smoke proposal should promote into a worker goal");
  const rotatedVotingConnector = await postJson(`/api/connectors/${votingConnector.connector.id}/rotate`, {}, headers);
  assert(rotatedVotingConnector.token.startsWith("osa_conn_"), "rotated connector should return a fresh raw token once");
  assert(rotatedVotingConnector.connector.rotatedFromId === votingConnector.connector.id, "rotated connector should link to previous token");
  assert(rotatedVotingConnector.previousConnector.revokedReason === "rotated", "previous connector should record rotation as the revoke reason");
  await expectStatus("/api/voting/connect", 401, { name: "Old voting connector should fail" }, votingConnectorHeaders);

  const workerToken = await postJson(
    "/api/connectors/token",
    {
      mode: "worker",
      goalId: workerGoalId,
      name: "RC Worker Agent",
      capabilities: ["research", "review"],
      models: ["connector:stub"]
    },
    headers
  );
  assert(workerToken.token.startsWith("osa_conn_"), "connector token should be returned once");
  const connectorHeaders = { "x-osa-connector-token": workerToken.token };
  const worker = await postJson(
    "/api/agents/register",
    {
      name: "RC Worker Agent",
      goalId: workerGoalId,
      capabilities: ["research", "review"],
      models: ["connector:stub"]
    },
    connectorHeaders
  );
  const claimed = await postJson(
    "/api/tasks/claim",
    {
      agentId: worker.agent.id,
      goalId: "goal-does-not-belong-to-this-agent"
    },
    connectorHeaders
  );
  assert(claimed.task?.goalId === workerGoalId, "task claim should stay scoped to the agent goal");
  await expectStatus("/api/artifacts/upload", 403, {
    agentId: vote.agent.id,
    goalId: workerGoalId,
    taskId: claimed.task.id,
    name: "spoofed.md",
    kind: "code",
    mimeType: "text/markdown",
    dataBase64: Buffer.from("spoofed").toString("base64")
  }, connectorHeaders);
  const scopedArtifact = await postJson(
    "/api/artifacts/upload",
    {
      agentId: worker.agent.id,
      goalId: workerGoalId,
      taskId: claimed.task.id,
      name: "scoped-worker.md",
      kind: "code",
      mimeType: "text/markdown",
      dataBase64: Buffer.from("scoped").toString("base64")
    },
    connectorHeaders
  );
  assert(scopedArtifact.artifact.agentId === worker.agent.id, "connector artifact should be attributed to its agent");
  assert(scopedArtifact.artifact.goalId === workerGoalId, "connector artifact should stay in its scoped goal");

  await expectStatus(`/api/tasks/${claimed.task.id}/result`, 400, {
    agentId: worker.agent.id,
    summary: "Fake artifact result",
    content: "Result submission must reject unknown local artifact download references.",
    artifacts: [
      {
        name: "fake.md",
        kind: "code",
        uri: "/api/artifacts/artifact-does-not-exist/download"
      }
    ]
  }, connectorHeaders);

  const votingArtifact = await postJson(
    "/api/artifacts/upload",
    {
      agentId: vote.agent.id,
      goalId: "voting-pool",
      name: "voting-agent.md",
      kind: "code",
      mimeType: "text/markdown",
      dataBase64: Buffer.from("voting").toString("base64")
    },
    headers
  );
  await expectStatus(`/api/tasks/${claimed.task.id}/result`, 403, {
    agentId: worker.agent.id,
    summary: "Cross agent artifact result",
    content: "Result submission must reject artifacts uploaded by another agent scope.",
    artifacts: [
      {
        name: "stolen.md",
        kind: "code",
        uri: votingArtifact.artifact.uri
      }
    ]
  }, connectorHeaders);

  const result = await postJson(
    `/api/tasks/${claimed.task.id}/result`,
    {
      agentId: worker.agent.id,
      summary: "Scoped artifact result",
      content: "The connector may attach only artifacts that match its agent, goal, and leased task scope.",
      artifacts: [
        {
          name: "renamed.md",
          kind: "code",
          uri: scopedArtifact.artifact.uri
        }
      ],
      sources: ["local-smoke"],
      confidence: 0.82
    },
    connectorHeaders
  );
  assert(result.result.artifacts[0]?.id === scopedArtifact.artifact.id, "result should canonicalize uploaded artifact metadata");
  assert(result.result.artifacts[0]?.sha256 === scopedArtifact.artifact.sha256, "result artifact should keep uploaded artifact hash");
  assert(result.result.signature?.signature, "result should be signed");

  const artifact = await postJson(
    "/api/artifacts/upload",
    {
      name: "rc-smoke.txt",
      kind: "file",
      mimeType: "text/plain",
      description: "RC smoke artifact",
      dataBase64: Buffer.from("OpenSwarmAgents RC smoke artifact\n").toString("base64")
    },
    headers
  );
  assert(artifact.artifact.sha256, "artifact should have sha256");
  assert(artifact.artifact.signature?.signature, "artifact should be signed");

  const download = await fetch(`${baseUrl}${artifact.artifact.uri}`, { headers });
  assert(download.ok, "artifact download should be authorized");
  assert(download.headers.get("x-osa-artifact-sha256") === artifact.artifact.sha256, "artifact download should expose matching hash");
  assert(download.headers.get("content-disposition")?.startsWith("inline;"), "safe text artifacts may render inline");

  const svgArtifact = await postJson(
    "/api/artifacts/upload",
    {
      name: "rc-smoke.svg",
      kind: "image",
      mimeType: "image/svg+xml",
      description: "RC smoke SVG artifact",
      dataBase64: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>").toString("base64")
    },
    headers
  );
  const svgDownload = await fetch(`${baseUrl}${svgArtifact.artifact.uri}`, { headers });
  assert(svgDownload.ok, "svg artifact download should be authorized");
  assert(svgDownload.headers.get("content-disposition")?.startsWith("attachment;"), "active artifact types should download as attachments");

  const ledger = await getJson("/api/trust-ledger", headers);
  assert(ledger.head, "trust ledger should expose a head hash");
  assert(ledger.count >= 4, "trust ledger should contain proposal, vote, and artifact events");
  assert(ledger.entries[0].eventHash === ledger.head, "first ledger entry should be the head");
  assert(isHashChainValid(ledger.entries), "trust ledger entries should be hash-linked");
  assert(ledger.entries.some((entry) => entry.type === "proposal"), "ledger should include proposal event");
  assert(ledger.entries.some((entry) => entry.type === "proposal_vote"), "ledger should include proposal vote event");
  assert(ledger.entries.some((entry) => entry.type === "artifact_upload"), "ledger should include artifact upload event");

  const state = await getJson("/api/state", headers);
  assert(state.stats.trustEvents >= 3, "state stats should include trust events");
  assert(state.stats.trustHead === ledger.head, "state trust head should match ledger endpoint");

  const identity = JSON.parse(await readFile(join(dataDir, "node-identity.json"), "utf8"));
  assert(identity.privateKeyPem && identity.publicKeyPem, "node identity should persist locally");
  realtime.close();

  console.log(`RC smoke passed on ${baseUrl}`);
} finally {
  if (server) server.kill("SIGTERM");
  if (technocoreServer) await closeServer(technocoreServer);
  await rm(dataDir, { recursive: true, force: true });
}

function startTechnocoreFixture() {
  const fixture = createServer((req, res) => {
    const url = new URL(req.url || "/", technocoreBaseUrl);
    if (url.pathname === "/rooms") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        rooms: [
          { room: "osa-network", count: 2, last_seq: 42, idle_seconds: 4 },
          { room: "osa-lab", count: 1, last_seq: 41, idle_seconds: 8 },
          { room: "credence", count: 3, last_seq: 45, idle_seconds: 12 }
        ]
      }));
      return;
    }
    if ((url.pathname === "/r/osa-lab" || url.pathname === "/r/osa-network") && req.method === "GET") {
      const room = url.pathname.split("/").at(-1);
      technocoreReads.push({
        room,
        since: url.searchParams.get("since") || "",
        wait: url.searchParams.get("wait") || "",
        cacheBuster: url.searchParams.get("n") || ""
      });
      const baseMessages = [{
        seq: 41,
        ts: "2026-09-01T06:00:00.000Z",
        from: "did:key:z6MkRcSmokeTechnocoreFixture",
        text: room === "osa-network" ? "OSA public channel fixture message" : "External bridge fixture message"
      }];
      const mirroredMessages = technocoreWrites
        .filter((item) => item.room === room)
        .map((item, index) => ({
          seq: 42 + index,
          ts: "2026-09-01T06:00:10.000Z",
          from: item.from,
          nonce: item.nonce,
          sig: item.sig,
          text: item.text
        }));
      const messages = [...baseMessages, ...mirroredMessages];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        room,
        count: messages.length,
        first_seq: 41,
        last_seq: messages.at(-1)?.seq || 41,
        generation: 0,
        messages
      }));
      return;
    }
    if ((url.pathname === "/r/osa-lab" || url.pathname === "/r/osa-network") && req.method === "POST") {
      const room = url.pathname.split("/").at(-1);
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        if (!isValidTechnocoreSignedWrite(room, parsed)) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("bad signed technocore fixture write\n");
          return;
        }
        technocoreWrites.push({
          room,
          from: parsed.did,
          sig: parsed.sig,
          nonce: parsed.nonce,
          text: parsed.text
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, room }));
      });
      return;
    }
    const sayMatch = url.pathname.match(/^\/r\/([^/]+)\/say\/osa-node\/(.+)$/);
    if (sayMatch) {
      technocoreWrites.push({
        room: sayMatch[1],
        from: "osa-node",
        text: decodeURIComponent(sayMatch[2])
      });
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
  });
  return new Promise((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(technocorePort, "127.0.0.1", () => {
      fixture.off("error", reject);
      resolve(fixture);
    });
  });
}

function isValidTechnocoreSignedWrite(room, message) {
  try {
    const did = String(message.did || "");
    if (!did.startsWith("did:key:z6Mk") || !message.sig || !message.nonce || !message.text) return false;
    const decoded = base58btcDecode(did.slice("did:key:z".length));
    if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), decoded.subarray(2)]),
      format: "der",
      type: "spki"
    });
    return verifySignature(
      null,
      Buffer.from(`${room}|${message.nonce}|${message.text}`, "utf8"),
      publicKey,
      Buffer.from(message.sig, "base64url")
    );
  } catch {
    return false;
  }
}

function base58btcDecode(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let decoded = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid base58btc character");
    decoded = decoded * 58n + BigInt(digit);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const leadingZeroes = value.length - value.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function closeServer(instance) {
  return new Promise((resolve) => instance.close(resolve));
}

async function assertProductionLocalValidation() {
  const validationDir = await mkdtemp(join(tmpdir(), "osa-prod-validation-"));
  try {
    const result = await runNode(["apps/server/src/server.mjs"], {
      NODE_ENV: "production",
      OSA_AUTH_MODE: "local",
      OSA_LOCAL_PASSWORD_REQUIRED: "1",
      OSA_DATA_DIR: validationDir,
      OSA_IDENTITY_PATH: join(validationDir, "node-identity.json")
    });
    assert(result.code !== 0, "production without DATABASE_URL should fail fast");
    assert(result.output.includes("DATABASE_URL is required"), "production validation should require DATABASE_URL");
    assert(!/OSA_PUBLIC_URL|OAuth provider|OSA_COOKIE_SECURE/.test(result.output), "local production mode should not require domain or OAuth");
  } finally {
    await rm(validationDir, { recursive: true, force: true });
  }
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

function collectLogs(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

async function waitForHealth(logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check passed:\n${logs()}`);
    }
    try {
      const health = await getJson("/api/health");
      if (health.ok) return;
    } catch {
      // Keep waiting.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy:\n${logs()}`);
}

async function getJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  assert(response.ok, `${path} should return HTTP 2xx, got ${response.status}`);
  return response.json();
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function ethereumPersonalMessageHash(message) {
  const messageBytes = utf8ToBytes(String(message || ""));
  const prefixBytes = utf8ToBytes(`\x19Ethereum Signed Message:\n${messageBytes.length}`);
  return keccak_256(new Uint8Array([...prefixBytes, ...messageBytes]));
}

function ethereumAddressFromPrivateKey(privateKey) {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`.toLowerCase();
}

function signPersonalMessage(message) {
  const signature = secp256k1.sign(ethereumPersonalMessageHash(message), testWalletPrivateKey, { format: "recovered", prehash: false });
  const ethereumSignature = new Uint8Array(65);
  ethereumSignature.set(signature.slice(1), 0);
  ethereumSignature[64] = signature[0] + 27;
  return `0x${bytesToHex(ethereumSignature)}`;
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }
  return response.json();
}

async function openSse(headers = {}) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events/stream`, {
    headers,
    signal: controller.signal
  });
  assert(response.ok, `/api/events/stream should return HTTP 2xx, got ${response.status}`);
  assert(response.headers.get("content-type")?.includes("text/event-stream"), "realtime stream should use text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function waitFor(eventName) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const parsed = consumeSseEvent(eventName);
      if (parsed) return parsed;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    throw new Error(`timed out waiting for SSE event ${eventName}`);
  }

  function consumeSseEvent(eventName) {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventLine = raw.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
      const currentEvent = eventLine?.slice("event:".length).trim();
      if (currentEvent === eventName) {
        return dataLine ? JSON.parse(dataLine.slice("data:".length).trim()) : {};
      }
      boundary = buffer.indexOf("\n\n");
    }
    return null;
  }

  return {
    waitFor,
    close: () => controller.abort()
  };
}

async function expectStatus(path, status, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  assert(response.status === status, `${path} should return ${status}, got ${response.status}`);
}

async function expectGetStatus(path, status, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  assert(response.status === status, `${path} should return ${status}, got ${response.status}`);
}

function isHashChainValid(entries) {
  for (let index = 0; index < entries.length - 1; index += 1) {
    if (entries[index].previousHash !== entries[index + 1].eventHash) return false;
  }
  return true;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
