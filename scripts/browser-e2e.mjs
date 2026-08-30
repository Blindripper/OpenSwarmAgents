import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_BROWSER_E2E_PORT || 19880 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-browser-e2e-"));
const pageErrors = [];
let browser = null;
let server = null;

try {
  server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OSA_DATA_DIR: dataDir,
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_LOCAL_PASSWORD_REQUIRED: "0",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      OSA_OPENCLAW_COMMAND: process.env.OSA_OPENCLAW_COMMAND || "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  let sessions = await getJson("/api/sessions");
  assert(Array.isArray(sessions) && sessions.length === 0, "fresh dashboard should have no Home/Public example tasks");
  let top = await getJson("/api/top-agents?limit=100");
  assert(Array.isArray(top.agents) && top.agents.length === 0, "fresh Top100 should start empty");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(`${baseUrl}/agent-gui/`, { waitUntil: "networkidle" });
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Public");
  await expectText(page, "body", "Top100 AI Agents");
  assert(!(await page.locator("body").innerText()).includes("Open agent voting quality benchmark"), "legacy example tasks should not render");
  assert(await page.getByRole("button", { name: "Copy" }).count() === 0, "Public should not render example Copy buttons");

  const created = await postJson("/api/sessions/new", {
    content: "Build a small market-research agent for weird profitable niches.",
    team_id: "home-room",
    agent: "openclaw-codex"
  });
  assert(created.session_id?.startsWith("home-"), "new AgentGUI sessions should start in Home");

  let shared = await postJson(`/api/sessions/${encodeURIComponent(created.session_id)}/share`, { shared: true });
  assert(shared.shared_public === true, "Home agent should be shareable to Public");

  sessions = await getJson("/api/sessions");
  assert(sessions.some((session) => session.id === created.session_id && session.shared_public === true), "Home session should show shared state");
  const publicSession = sessions.find((session) => session.id.startsWith("public-") && session.shared_public === true);
  assert(publicSession, "shared Home agent should appear in Public");

  const copied = await postJson(`/api/sessions/${encodeURIComponent(publicSession.id)}/copy`, {});
  assert(copied.session_id?.startsWith("home-"), "copying a Public agent should create a Home session");
  top = await getJson("/api/top-agents?limit=100");
  assert(top.agents[0]?.rank === 1, "Top100 should rank copied Public agents");
  assert(top.agents[0]?.copy_count === 1, "Top100 should count copies");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Build a small market-research agent");
  await expectText(page, "body", "Public");
  await expectText(page, "body", "1 copies");
  await page.getByRole("button", { name: "Top100 AI Agents" }).click();
  await expectText(page, "body", "#1");
  await expectText(page, "body", "Build a small market-research agent");

  shared = await postJson(`/api/sessions/${encodeURIComponent(created.session_id)}/share`, { shared: false });
  assert(shared.shared_public === false, "Home agent should be removable from Public");
  sessions = await getJson("/api/sessions");
  assert(!sessions.some((session) => session.id === publicSession.id), "unshared agent should disappear from Public");

  assert(pageErrors.length === 0, `browser console/page errors: ${pageErrors.join("\n")}`);
  console.log(`Browser E2E passed on ${baseUrl}`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
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

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function expectText(page, selector, text) {
  await page.locator(selector).filter({ hasText: text }).waitFor({ state: "visible" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
