import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_CONNECTOR_E2E_PORT || 20580 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-connector-e2e-data-"));
const helperDir = await mkdtemp(join(tmpdir(), "osa-connector-e2e-helper-"));
const fakeCodex = join(helperDir, "fake-codex.py");
let server = null;

try {
  await writeFile(
    fakeCodex,
    [
      "import json",
      "import pathlib",
      "import sys",
      "prompt = pathlib.Path(sys.argv[-1]).read_text(encoding='utf-8')",
      "assert 'outputSchema' in prompt",
      "payload = {",
      "    'summary': 'Codex CLI adapter smoke result',",
      "    'content': 'The local CLI adapter claimed a task and produced a structured result without sending provider keys to the OSA server.',",
      "    'sources': ['connector://codex/fake-cli'],",
      "    'confidence': 0.88,",
      "}",
      "print(json.dumps({'message': json.dumps(payload)}))",
      "",
    ].join("\n"),
    "utf8",
  );

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
      OSA_CODEX_COMMAND: `python3 ${fakeCodex} {prompt_file}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  const login = await postJson("/api/auth/login", {
    email: "connector-e2e@example.com",
    name: "Connector E2E",
    password: "local-password-123",
  });
  const sessionHeaders = { "x-agentswarm-session": login.sessionToken };
  const started = await postJson(
    "/api/connectors/start",
    {
      mode: "worker",
      goalId: "goal-agent-collab",
      name: "Codex CLI Adapter E2E",
      capabilities: ["research", "review", "synthesis"],
      models: ["connector:codex"],
    },
    sessionHeaders,
  );
  assert(!started.token, "dashboard-managed connector start should not return a raw connector token");
  assert(started.connector?.managed?.status === "starting", "managed connector should report initial process status");

  const state = await waitForResult(sessionHeaders);
  const result = state.results.find((item) => item.summary === "Codex CLI adapter smoke result");
  assert(result, "Codex CLI adapter result should be visible in state");
  assert(result.status === "accepted", "solo connector result should be accepted");
  assert(
    state.resultPool.some((item) => item.resultId === result.id),
    "accepted connector result should publish into the Result Pool",
  );
  const revoked = await postJson(`/api/connectors/${started.connector.id}/revoke`, {}, sessionHeaders);
  assert(revoked.connector.status === "revoked", "managed connector should be revocable from the dashboard");

  console.log(`Connector runner E2E passed on ${baseUrl}`);
} finally {
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
  await rm(helperDir, { recursive: true, force: true });
}

async function waitForHealth(logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check passed:\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy:\n${logs()}`);
}

async function waitForResult(headers) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await getJson("/api/state", headers);
    if (state.results.some((item) => item.summary === "Codex CLI adapter smoke result")) return state;
    await delay(250);
  }
  throw new Error("managed connector did not submit a Codex CLI result");
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

async function getJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
