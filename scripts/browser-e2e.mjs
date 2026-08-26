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
      OSA_LOCAL_PASSWORD_REQUIRED: "1",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expectVisible(page, "#auth-gate");
  await expectClass(page, ".shell", "locked");
  assert(await page.locator("#nav-worker").isDisabled(), "worker nav should be disabled behind login gate");
  assert(await page.locator("#nav-voting").isDisabled(), "voting nav should be disabled behind login gate");
  assert(await page.locator("#nav-results").isDisabled(), "results nav should be disabled behind login gate");

  await page.fill("#auth-email", "browser-e2e@example.com");
  await page.fill("#auth-name", "Browser E2E");
  await page.fill("#auth-password", "local-password-123");
  await page.click("#auth-dev-form button[type='submit']");
  await expectAttached(page, "#auth-gate.hidden");
  await expectText(page, "#goal-title", "Build an open agent collaboration network");
  await waitForRealtime(page);

  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click("#theme-toggle");
  await page.waitForFunction((theme) => document.documentElement.dataset.theme !== theme, initialTheme);
  const toggledTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(["light", "dark"].includes(toggledTheme), "theme toggle should set an explicit theme");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, toggledTheme);
  await waitForRealtime(page);

  await page.click("#nav-account");
  await expectVisible(page, "#account-view.active");
  await page.selectOption("#connector-runner", "openclaw");
  await page.click("#api-key-form button[type='submit']");
  await expectText(page, "#account-feedback", "Connector runner saved");
  await expectText(page, "#trust-federation-mode", "Local only");
  const peerJson = await page.locator("#trust-peer-json").textContent();
  assert(peerJson?.includes("publicKeyPem"), "account trust panel should expose peer allowlist JSON");
  assert(peerJson?.includes("node-"), "account trust panel should include this node id");
  await page.fill(
    "#trust-peer-input",
    JSON.stringify({
      "node-browser-peer": {
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEA000000000000000000000000000000000000000=\\n-----END PUBLIC KEY-----",
        algorithm: "Ed25519"
      }
    })
  );
  await expectText(page, "#trust-peer-feedback", "Ready: 1 trusted peer.");
  await expectText(page, "#trust-peer-config", "OSA_FEDERATION_REQUIRE_SIGNATURES=1");
  await expectText(page, "#trust-peer-config", "node-browser-peer");
  await page.fill("#api-key-openai", "browser-e2e-local-placeholder");
  await page.click("#api-key-form button[type='submit']");
  await expectText(page, "#account-feedback", "Provider keys saved locally");

  await page.click("#nav-voting");
  await expectVisible(page, "#voting-view.active");
  await page.fill("#proposal-title", "Browser E2E proposal");
  await page.fill(
    "#proposal-description",
    "Browser-level release QA proposal with enough instruction detail to verify creation, ranking visibility, signed activity refresh, and voting-agent feedback in the dashboard."
  );
  await page.click("#proposal-form button[type='submit']");
  await expectText(page, "#proposals", "Browser E2E proposal");

  const realtimeProposalTitle = `Realtime proposal ${Date.now()}`;
  await page.evaluate(async ({ title }) => {
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        description:
          "Created through a same-origin browser fetch so the dashboard must learn about it from the authenticated realtime activity stream instead of a form refresh."
      })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { title: realtimeProposalTitle });
  await expectText(page, "#proposals", realtimeProposalTitle);

  await page.click("#connect-voting-agent");
  await expectVisible(page, "#vote-feedback:not(.hidden)");
  await expectText(page, "#vote-feedback", "Agent Decision");
  await expectText(page, "#vote-feedback", "voted for");
  await expectText(page, "#vote-count", "votes");

  await page.click("#nav-worker");
  await expectVisible(page, "#worker-view.active");
  await expectText(page, "#tasks", "Build an open agent collaboration network");
  await page
    .locator(".worker-project", { hasText: "Build an open agent collaboration network" })
    .getByRole("button", { name: /Connect worker to/i })
    .click();
  await expectText(page, "#connector-feedback", "Connector ready");
  const command = await page.locator("#connector-feedback code.command-block").textContent();
  const connectorToken = command?.match(/--connector-token\s+(osa_conn_\S+)/)?.[1];
  const goalId = command?.match(/--goal\s+(\S+)/)?.[1];
  assert(connectorToken, "worker connector command should include a raw connector token");
  assert(goalId === "goal-agent-collab", "worker connector should be scoped to the selected worker project");
  assert(command?.includes("--runner openclaw"), "worker connector command should use the selected OpenClaw runner");

  const connectorHeaders = { "x-osa-connector-token": connectorToken };
  const worker = await postJson("/api/agents/register", {
    name: "E2E Worker Agent",
    goalId,
    capabilities: ["research", "review", "synthesis"],
    models: ["browser-e2e:stub"],
    provider: "openai",
    providers: ["openai"]
  }, connectorHeaders);
  await expectText(page, "#agents", "E2E Worker Agent");
  await expectText(page, "#agents", "online");

  const claimed = await postJson("/api/tasks/claim", {
    agentId: worker.agent.id,
    goalId
  }, connectorHeaders);
  assert(claimed.task?.id, "worker connector should claim a task");

  const resultSummary = `E2E browser result ${Date.now()}`;
  const submitted = await postJson(`/api/tasks/${claimed.task.id}/result`, {
    agentId: worker.agent.id,
    summary: resultSummary,
    content:
      "This browser E2E result proves submitted worker output becomes visible in the dashboard and publishes into the Result Pool when consensus accepts it.",
    confidence: 0.91,
    sources: ["browser-e2e"]
  }, connectorHeaders);
  assert(submitted.result.status === "accepted", "solo connector result should be accepted immediately");

  await expectText(page, "#results", resultSummary);
  await expectText(page, "#results", "accepted");
  await page.click("#nav-results");
  await expectVisible(page, "#results-view.active");
  await expectText(page, "#result-pool", resultSummary);
  await expectText(page, "#result-pool", "Published");
  await expectText(page, "#events", "Published result");
  await waitForRealtime(page);

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

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForRealtime(page) {
  await expectText(page, "#server-time", "Realtime live");
}

async function expectVisible(page, selector) {
  await page.locator(selector).waitFor({ state: "visible" });
}

async function expectText(page, selector, text) {
  await page.locator(selector).filter({ hasText: text }).waitFor({ state: "visible" });
}

async function expectClass(page, selector, className) {
  await page.locator(`${selector}.${className}`).waitFor({ state: "attached" });
}

async function expectAttached(page, selector) {
  await page.locator(selector).waitFor({ state: "attached" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
