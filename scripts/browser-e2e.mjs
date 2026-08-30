import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_BROWSER_E2E_PORT || 19880 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-browser-e2e-"));
const openClawFixturePath = join(dataDir, "openclaw-fixture.sh");
const pageErrors = [];
let browser = null;
let server = null;

try {
  await writeFile(
    openClawFixturePath,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' '{\"final\":\"{\\\"summary\\\":\\\"Done\\\",\\\"content\\\":\\\"Finished by the browser E2E fixture.\\\",\\\"sources\\\":[\\\"fixture://openclaw\\\"],\\\"confidence\\\":0.9}\"}'"
    ].join("\n")
  );
  await chmod(openClawFixturePath, 0o755);

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
      OSA_OPENCLAW_COMMAND: process.env.OSA_OPENCLAW_COMMAND || openClawFixturePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  let sessions = await getJson("/api/sessions");
  assert(Array.isArray(sessions) && sessions.length === 0, "fresh dashboard should have no Home/Public example tasks");
  let top = await getJson("/api/top-agents?limit=100");
  assert(Array.isArray(top.agents) && top.agents.length === 0, "fresh Top100 should start empty");
  let config = await getJson("/api/gui-config");
  assert(config.agents.map((agent) => agent.id).join(",") === "openclaw-codex,codex-cli", "Agent Profiles should start with OpenClaw/Codex templates only");
  const customProfile = await postJson("/api/agents", {
    id: "profit-scout",
    clone_from: "openclaw-codex",
    name: "Profit Scout",
    tagline: "Find useful OpenClaw opportunities"
  });
  assert(customProfile.agent?.id === "profit-scout", "custom OpenClaw profiles should be creatable");
  config = await getJson("/api/gui-config");
  assert(config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should appear in Agent Profiles");
  await deleteJson("/api/agents/profit-scout");
  config = await getJson("/api/gui-config");
  assert(!config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should be deletable");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("osa-openclaw-onboarding-dismissed", "1");
  });

  await page.goto(`${baseUrl}/agent-gui/`, { waitUntil: "networkidle" });
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Public");
  await expectText(page, "body", "Top100 AI Agents");
  await expectText(page, "body", "Top100 Rooms");
  await expectText(page, "body", "Top100 Projects");
  assert(!(await page.locator("body").innerText()).includes("Open agent voting quality benchmark"), "legacy example tasks should not render");
  assert(await page.getByRole("button", { name: "Copy" }).count() === 0, "Public should not render example Copy buttons");
  assert(await page.locator('button[title="Delete this room"]').count() === 0, "Home/Public should not be removable");
  await page.getByRole("button", { name: "+ Room" }).click();
  await expectText(page, "body", "Room 1");
  assert(await page.locator('button[title="Delete this room"]').count() === 1, "custom rooms should expose a remove control");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('button[title="Delete this room"]').click();
  await page.locator("body").filter({ hasNotText: "Room 1" }).waitFor({ state: "visible" });

  const created = await postJson("/api/sessions/new", {
    content: "Build a small market-research agent for weird profitable niches.",
    team_id: "home-room",
    agent: "openclaw-codex"
  });
  assert(created.session_id?.startsWith("home-"), "new AgentGUI sessions should start in Home");
  const completed = await waitForJson(
    "/api/sessions",
    (items) => items.find((session) => session.id === created.session_id && session.task_solved === true),
    "completed Home session to stay visible"
  );
  assert(completed.ended_at, "completed Home session should expose an end timestamp");

  const roomCreated = await postJson("/api/sessions/new", {
    content: "Create a compact launch plan for a private room.",
    team_id: "room-launch",
    team_name: "Launch"
  });
  assert(roomCreated.session?.team_id === "room-launch", "private room sessions should keep their team id");

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
  assert(top.agents[0]?.donation_total_usdc === 0, "Top100 should expose donation totals");

  const walletAddress = "0x0000000000000000000000000000000000000abc";
  const wallet = await postJson("/api/wallet/login", { address: walletAddress, chain_id: "0x1" });
  assert(wallet.wallet?.address === walletAddress, "wallet login should store the connected pubkey");
  const donation = await postJson("/api/donations", {
    session_id: publicSession.id,
    amount: 5,
    wallet_address: walletAddress,
    chain_id: "0x1"
  });
  assert(donation.donation?.currency === "USDC", "donations should be denominated in USDC");
  top = await getJson("/api/top-agents?limit=100");
  assert(top.agents[0]?.donation_count === 1, "Top100 should count donations");
  assert(top.agents[0]?.donation_total_usdc === 5, "Top100 should sum USDC donations");
  assert(top.agents[0]?.osa_fee_total_usdc === 0.25, "Top100 should expose the OSA donation fee total");

  const roomShare = await postJson("/api/public/rooms/share", {
    team_id: "room-launch",
    team_name: "Launch",
    shared: true
  });
  assert(roomShare.room?.id?.startsWith("public-room-"), "rooms should be shareable to Public Rooms");
  let topRooms = await getJson("/api/top-rooms?limit=100");
  assert(topRooms.agents[0]?.rank === 1, "Top100 Rooms should rank shared rooms");
  const roomCopy = await postJson(`/api/sessions/${encodeURIComponent(roomShare.room.id)}/copy`, {});
  assert(roomCopy.session_ids?.length === 1, "copying a Public Room should copy its agents into a private room");
  topRooms = await getJson("/api/top-rooms?limit=100");
  assert(topRooms.agents[0]?.copy_count === 1, "Top100 Rooms should count room copies");

  const projectShare = await postJson("/api/public/projects/share", {
    name: "Browser E2E Project",
    rooms: [
      { id: "home-room", name: "Home" },
      { id: "room-launch", name: "Launch" }
    ]
  });
  assert(projectShare.project?.id?.startsWith("public-project-"), "projects should be shareable to Public Projects");
  let topProjects = await getJson("/api/top-projects?limit=100");
  assert(topProjects.agents[0]?.rank === 1, "Top100 Projects should rank shared projects");
  const projectCopy = await postJson(`/api/sessions/${encodeURIComponent(projectShare.project.id)}/copy`, {});
  assert(projectCopy.session_ids?.length >= 2, "copying a Public Project should copy multiple agents");
  await postJson("/api/donations", {
    session_id: projectShare.project.id,
    amount: 1,
    wallet_address: walletAddress,
    chain_id: "0x1"
  });
  const projectId = projectShare.project.id.replace("public-project-", "");
  const review = await postJson(`/api/public/projects/${encodeURIComponent(projectId)}/reviews`, {
    wallet_address: walletAddress,
    rating: 5,
    title: "Actually useful",
    comment: "Imported cleanly and gave me a sensible project structure."
  });
  assert(review.stats?.review_count === 1, "Public Project reviews should be counted");
  assert(review.stats?.rating_avg === 5, "Public Project reviews should average ratings");
  topProjects = await getJson("/api/top-projects?limit=100");
  assert(topProjects.agents[0]?.donation_total_usdc === 1, "Top100 Projects should sum project donations");
  assert(topProjects.agents[0]?.review_count === 1, "Top100 Projects should expose review counts");
  assert(topProjects.agents[0]?.rating_avg === 5, "Top100 Projects should expose average ratings");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Network Live");
  await expectText(page, "body", "Build a small market-research agent");
  await expectText(page, "body", "Public");
  await expectText(page, "body", "Public Rooms");
  await expectText(page, "body", "Public Projects");
  await expectText(page, "body", "Latest public agents.");
  await expectText(page, "body", "Latest public rooms.");
  await expectText(page, "body", "Latest public projects.");
  await expectText(page, "body", "1 copies");
  await page.getByRole("button", { name: "Top100 AI Agents" }).click();
  await expectText(page, "body", "#1");
  await expectText(page, "body", "Build a small market-research agent");
  await expectText(page, "body", "Donate");
  await expectText(page, "body", "5 USDC");
  await page.getByRole("button", { name: "Top100 Rooms" }).click();
  await expectText(page, "body", "Top100 Rooms");
  await expectText(page, "body", "Launch");
  await page.getByRole("button", { name: "Top100 Projects" }).click();
  await expectText(page, "body", "Top100 Projects");
  await expectText(page, "body", "Browser E2E Project");
  await expectText(page, "body", "1 USDC earned");
  await expectText(page, "body", "5.0 stars");
  await expectText(page, "body", "Review");

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

async function deleteJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
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

async function waitForJson(path, predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const payload = await getJson(path);
    const match = predicate(payload);
    if (match) return match;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
