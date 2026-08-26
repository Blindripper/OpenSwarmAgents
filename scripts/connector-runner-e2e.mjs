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
  const token = await postJson(
    "/api/connectors/token",
    {
      mode: "worker",
      goalId: "goal-agent-collab",
      name: "Codex CLI Adapter E2E",
      capabilities: ["research", "review", "synthesis"],
      models: ["connector:codex"],
    },
    sessionHeaders,
  );

  await runConnector(token.token);

  const state = await getJson("/api/state", sessionHeaders);
  const result = state.results.find((item) => item.summary === "Codex CLI adapter smoke result");
  assert(result, "Codex CLI adapter result should be visible in state");
  assert(result.status === "accepted", "solo connector result should be accepted");
  assert(
    state.resultPool.some((item) => item.resultId === result.id),
    "accepted connector result should publish into the Result Pool",
  );

  console.log(`Connector runner E2E passed on ${baseUrl}`);
} finally {
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
  await rm(helperDir, { recursive: true, force: true });
}

async function runConnector(connectorToken) {
  const child = spawn(
    "python3",
    [
      "apps/connector/connector.py",
      "--server",
      baseUrl,
      "--connector-token",
      connectorToken,
      "--goal",
      "goal-agent-collab",
      "--runner",
      "codex",
      "--codex-command",
      `python3 ${fakeCodex} {prompt_file}`,
      "--no-fallback-to-stub",
      "--once",
    ],
    { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = await waitForExit(child, 20000);
  assert(output.code === 0, `connector exited with ${output.code}:\n${output.text}`);
  assert(output.text.includes("submitted result"), `connector should submit a result:\n${output.text}`);
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

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`process timed out after ${timeoutMs}ms:\n${text}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, text });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
