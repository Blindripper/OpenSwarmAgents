import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_POSTGRES_SMOKE_PORT || 21080 + Math.floor(Math.random() * 800));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-postgres-smoke-"));
const externalDatabaseUrl = process.env.DATABASE_URL || "";
const postgresPassword = "osa-smoke-password";
const containerName = `osa-postgres-smoke-${process.pid}-${Date.now()}`;

let server = null;
let databaseUrl = externalDatabaseUrl;
let startedContainer = false;

try {
  if (!databaseUrl) {
    databaseUrl = await startPostgresContainer();
    startedContainer = true;
  }

  await waitForPostgres();

  server = await startServer();
  await runProductionFlow();
  await stopServer();

  server = await startServer();
  await verifyRestartPersistence();

  console.log(`Postgres production smoke passed on ${baseUrl}`);
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
  if (startedContainer) {
    await run("docker", ["rm", "-f", containerName], { allowFailure: true });
  }
}

async function startPostgresContainer() {
  const result = await run("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-e",
    "POSTGRES_DB=osa",
    "-e",
    "POSTGRES_USER=osa",
    "-e",
    `POSTGRES_PASSWORD=${postgresPassword}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine"
  ]);
  assert(result.output.trim(), "docker should return a Postgres container id");

  const portResult = await run("docker", ["port", containerName, "5432/tcp"]);
  const mapped = portResult.output.trim().match(/127\.0\.0\.1:(\d+)/);
  assert(mapped, `could not determine mapped Postgres port: ${portResult.output}`);
  return `postgres://osa:${postgresPassword}@127.0.0.1:${mapped[1]}/osa`;
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { Pool } from "pg";
          const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
          });
          await pool.query("select 1");
          await pool.end();
        `
      ],
      {
        allowFailure: true,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PGSSLMODE: process.env.PGSSLMODE || "disable"
        }
      }
    );
    if (result.code === 0) return;
    await delay(250);
  }
  const logs = startedContainer ? await run("docker", ["logs", containerName], { allowFailure: true }) : { output: "" };
  throw new Error(`Postgres did not accept Node pg connections:\n${logs.output}`);
}

async function startServer() {
  const child = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      PGSSLMODE: process.env.PGSSLMODE || "disable",
      OSA_DATA_DIR: dataDir,
      OSA_UPLOAD_DIR: join(dataDir, "uploads"),
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_AUTH_MODE: "local",
      OSA_LOCAL_PASSWORD_REQUIRED: "1",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = collectLogs(child);
  server = child;
  await waitForHealth(logs);
  return child;
}

async function runProductionFlow() {
  const health = await getJson("/api/health");
  assert(health.ok, "health endpoint should be ok");
  assert(health.runtime.nodeEnv === "production", "server should run in production mode");
  assert(health.runtime.storageMode === "postgres-snapshot", "server should use Postgres snapshot storage");
  assert(health.runtime.authMode === "local", "server should use local auth for the local-first RC path");
  assert(health.runtime.localPasswordRequired === true, "production local auth should require a password");
  assert(health.runtime.demoEndpointsEnabled === false, "production smoke should keep demo endpoints disabled");
  assert(health.runtime.rateLimitsEnabled === true, "production smoke should keep rate limits enabled");
  assert(health.runtime.productionReady === true, "runtime readiness should pass with Postgres local auth");

  const lockedState = await getJson("/api/state");
  assert(!lockedState.viewer, "unauthenticated state should not include a viewer");
  assert(lockedState.goals.length === 0, "unauthenticated state should not expose goals");
  assert(lockedState.proposals.length === 0, "unauthenticated state should not expose proposals");

  await expectStatus("/api/auth/login", 400, {
    email: "postgres-smoke@example.com",
    name: "Postgres Smoke"
  });

  const login = await postJson("/api/auth/login", {
    email: "postgres-smoke@example.com",
    name: "Postgres Smoke",
    password: "local-password-123"
  });
  assert(login.sessionToken, "login should return a CLI session token");
  const headers = { "x-agentswarm-session": login.sessionToken };

  const proposal = await postJson(
    "/api/proposals",
    {
      title: "Postgres RC persistence proposal",
      description:
        "This production-mode smoke proposal verifies that the release candidate can persist authenticated user state and signed Trust Ledger events through Postgres."
    },
    headers
  );
  assert(proposal.proposal.id, "proposal should be created");
  assert(proposal.proposal.signature?.signature, "proposal should be signed");

  const ledger = await getJson("/api/trust-ledger", headers);
  assert(ledger.entries.some((entry) => entry.type === "proposal"), "Trust Ledger should include the proposal event");
}

async function verifyRestartPersistence() {
  const login = await postJson("/api/auth/login", {
    email: "postgres-smoke@example.com",
    name: "Postgres Smoke",
    password: "local-password-123"
  });
  const headers = { "x-agentswarm-session": login.sessionToken };
  const state = await getJson("/api/state", headers);
  assert(
    state.proposals.some((proposal) => proposal.title === "Postgres RC persistence proposal"),
    "Postgres snapshot should retain proposals across server restarts"
  );
  assert(state.stats.trustEvents >= 1, "Postgres snapshot should retain Trust Ledger events across server restarts");
}

async function waitForHealth(logs) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check passed:\n${logs()}`);
    }
    try {
      const health = await getJson("/api/health");
      if (health.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy:\n${logs()}\nLast health error: ${lastError?.message || "none"}`);
}

async function getJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`${path} should return HTTP 2xx, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function expectStatus(path, status, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  assert(response.status === status, `${path} should return ${status}, got ${response.status}: ${await response.text()}`);
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

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({ code: 1, output: error.message });
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, output });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with ${code}:\n${output}`));
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
