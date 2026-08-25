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

  const ledger = await getJson("/api/trust-ledger");
  assert(ledger.head, "trust ledger should expose a head hash");
  assert(ledger.count >= 3, "trust ledger should contain proposal, vote, and artifact events");
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

async function expectStatus(path, status, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
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
