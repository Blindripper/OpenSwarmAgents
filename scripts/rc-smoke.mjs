import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_RC_SMOKE_PORT || 19080 + Math.floor(Math.random() * 800));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-rc-smoke-"));
let server = null;

try {
  await assertProductionLocalValidation();
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
      OSA_RATE_LIMIT_MULTIPLIER: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  const health = await getJson("/api/health");
  assert(health.ok, "health endpoint should be ok");
  assert(health.runtime.authMode === "local", "auth mode should default to local");
  assert(health.runtime.localPasswordRequired === true, "local password should be required in smoke");
  assert(health.runtime.node?.nodeId, "node identity should be public");

  const shell = await fetch(`${baseUrl}/`);
  const csp = shell.headers.get("content-security-policy") || "";
  assert(shell.ok, "app shell should be served");
  assert(csp.includes("script-src 'self'"), "CSP should restrict scripts to same origin");
  assert(!csp.includes("unsafe-inline"), "CSP should not allow inline scripts");
  assert((await shell.text()).includes("/theme-init.js"), "app shell should load the external theme bootstrap");
  const appJs = await (await fetch(`${baseUrl}/app.js`)).text();
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

  await expectStatus("/api/auth/login", 400, {
    email: "rc@example.com",
    name: "RC",
    password: "short"
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

  const workerToken = await postJson(
    "/api/connectors/token",
    {
      mode: "worker",
      goalId: "goal-agent-collab",
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
      goalId: "goal-agent-collab",
      capabilities: ["research", "review"],
      models: ["connector:stub"]
    },
    connectorHeaders
  );
  const claimed = await postJson(
    "/api/tasks/claim",
    {
      agentId: worker.agent.id,
      goalId: "goal-water"
    },
    connectorHeaders
  );
  assert(claimed.task?.goalId === "goal-agent-collab", "task claim should stay scoped to the agent goal");
  await expectStatus("/api/artifacts/upload", 403, {
    agentId: vote.agent.id,
    goalId: "goal-agent-collab",
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
      goalId: "goal-agent-collab",
      taskId: claimed.task.id,
      name: "scoped-worker.md",
      kind: "code",
      mimeType: "text/markdown",
      dataBase64: Buffer.from("scoped").toString("base64")
    },
    connectorHeaders
  );
  assert(scopedArtifact.artifact.agentId === worker.agent.id, "connector artifact should be attributed to its agent");
  assert(scopedArtifact.artifact.goalId === "goal-agent-collab", "connector artifact should stay in its scoped goal");

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
  await rm(dataDir, { recursive: true, force: true });
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
