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
      OSA_OPENCLAW_COMMAND: openClawFixturePath,
      OSA_CODEX_BINARY: join(dataDir, "missing-codex"),
      OSA_CODEX_COMMAND: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  let sessions = await getJson("/api/sessions");
  assert(Array.isArray(sessions) && sessions.length === 1 && sessions[0]?.team_id === "public-projects-room", "fresh dashboard should expose only the public example project");
  let top = await getJson("/api/top-projects?limit=100");
  assert(Array.isArray(top.agents) && top.agents.some((agent) => agent.target_id === "osa-example-reward-engine"), "fresh Top100 should include the example project");
  const balance = await getJson("/api/wallet/balance?address=0x0000000000000000000000000000000000000abc");
  assert(balance.formatted === "0 OSA" && balance.source === "not_deployed", "wallet balance should honestly report undeployed $OSA state");
  let config = await getJson("/api/gui-config");
  const agentIds = config.agents.map((agent) => agent.id);
  for (const id of ["coder", "bugfixer", "info-guy", "coinexpert", "graphicsexpert", "moneymaker", "security-expert", "explorer"]) {
    assert(agentIds.includes(id), `Agent Profiles should include ${id}`);
  }
  assert(config.agents.find((agent) => agent.id === "coder")?.model === "OpenClaw local agent", "Coder should default to OpenClaw in AgentGUI");
  assert(config.agents.find((agent) => agent.id === "bugfixer")?.model === "OpenClaw local agent", "Bugfixer should default to OpenClaw in AgentGUI");
  assert(config.prototypes.length === 0, "legacy built-in Agent Profile prototypes should be removed");
  const openclawStatus = await getJson("/api/openclaw/status");
  assert(openclawStatus.available === true && openclawStatus.install_command, "OpenClaw setup status should expose wizard install diagnostics");
  const openclawInstall = await postJson("/api/openclaw/install", {});
  assert(openclawInstall.installed === false && openclawInstall.status?.available === true, "OpenClaw wizard install should be a no-op when OpenClaw is already available");
  const infoPersona = await getJson("/api/agents/info-guy/persona");
  assert(infoPersona.soul.includes("information-gathering"), "existing specialist profiles should expose useful Soul.md content");
  await putJson("/api/agents/info-guy/persona", {
    ...infoPersona,
    tagline: "Finds sourced facts for OSA tests",
    soul: `${infoPersona.soul}\nBrowser E2E edit marker.`,
    memory: `${infoPersona.memory}\nBrowser E2E memory marker.`
  });
  const editedInfoPersona = await getJson("/api/agents/info-guy/persona");
  assert(editedInfoPersona.tagline === "Finds sourced facts for OSA tests", "existing Agent Profiles should be editable");
  assert(editedInfoPersona.soul.includes("Browser E2E edit marker."), "editing an existing Agent Profile should persist Soul.md");
  assert(editedInfoPersona.memory.includes("Browser E2E memory marker."), "editing an existing Agent Profile should persist Memory.md");
  const customProfile = await postJson("/api/agents", {
    id: "profit-scout",
    clone_from: "coder",
    name: "Profit Scout",
    tagline: "Find useful OpenClaw opportunities"
  });
  assert(customProfile.agent?.id === "profit-scout", "custom OpenClaw profiles should be creatable");
  config = await getJson("/api/gui-config");
  assert(config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should appear in Agent Profiles");
  await deleteJson("/api/agents/profit-scout");
  config = await getJson("/api/gui-config");
  assert(config.rooms.map((room) => room.name).join(",") === "Home,Latest Projects", "dashboard should expose only Home and Latest Projects from start");
  assert(!config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should be deletable");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.ethereum = {
      request: async ({ method }) => {
        if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000abc"];
        if (method === "eth_chainId") return "0x1";
        return null;
      }
    };
    localStorage.setItem("osa-openclaw-onboarding-dismissed", "1");
    localStorage.setItem("osa-workbench-v2", JSON.stringify({
      version: 2,
      teams: [
        { id: "home-room", color: "blue", name: "Home", items: [] },
        { id: "public-room", color: "purple", name: "Public", items: [] },
        { id: "public-rooms-room", color: "orange", name: "Public Rooms", items: [] },
        { id: "public-projects-room", color: "orange", name: "Latest Projects", items: [] }
      ]
    }));
  });

  await page.goto(`${baseUrl}/agent-gui/`, { waitUntil: "networkidle" });
  await expectText(page, "body", "Connect Wallet");
  await expectText(page, "body", "$OSA wallet identity required");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Latest Projects");
  await expectText(page, "body", "Top100 Projects");
  await expectText(page, "body", "Network Activity");
  await expectText(page, "body", "Network Chat");
  await page.locator('button[title="Settings"]').click();
  assert(await page.locator('input[type="number"]').first().inputValue() === "600", "manager patrol interval should default to 600 seconds");
  await page.locator('button[title="Settings"]').click();
  await page.locator('[title="Manager actions"]').first().click();
  await expectText(page, "body", "Run");
  await expectText(page, "body", "View");
  await page.getByRole("button", { name: "View" }).click();
  await expectText(page, "body", "Manager Audits");
  await page.locator('button[title="Close manager audits"]').click();
  let bodyText = await page.locator("body").innerText();
  assert(!bodyText.includes("Top100 AI Agents"), "agent charts should not render");
  assert(!bodyText.includes("Top100 Rooms"), "room charts should not render");
  assert(!bodyText.includes("Public Rooms"), "legacy Public Rooms should not render");
  assert(!bodyText.includes("Agent Chain"), "old Agent Chain label should not render");
  assert(bodyText.includes("Earned Donations"), "topbar should label donation totals clearly");
  assert(bodyText.includes("0 OSA"), "topbar should show connected wallet $OSA balance");
  assert(bodyText.includes("Save Project"), "project save control should replace Load Desk/Snapshots");
  assert(!bodyText.includes("Save/Load Project"), "topbar should not expose the old Save/Load Project wording");
  assert(!bodyText.includes("Snapshots"), "topbar should not expose the old snapshots wording");
  assert(!bodyText.includes("Load desk"), "topbar should not expose the old Load desk wording");
  assert(!(await page.locator("body").innerText()).includes("Open agent voting quality benchmark"), "legacy example tasks should not render");
  assert(await page.getByRole("button", { name: "Copy" }).count() > 0, "Public example project should expose Copy for testing");
  assert(await page.locator('button[title="Delete this room"]').count() === 0, "Home/Latest Projects should not be removable");
  await page.getByRole("button", { name: "+ Room" }).click();
  await expectText(page, "body", "Room 1");
  assert(await page.locator('button[title="Delete this room"]').count() === 1, "custom rooms should expose a remove control");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('button[title="Delete this room"]').click();
  await page.locator("body").filter({ hasNotText: "Room 1" }).waitFor({ state: "visible" });

  const created = await postJson("/api/sessions/new", {
    content: "Build a small market-research agent for weird profitable niches.",
    team_id: "home-room",
    agent: "moneymaker"
  });
  assert(created.session_id?.startsWith("home-"), "new AgentGUI sessions should start in Home");
  const audit = await postJson(`/api/sessions/${encodeURIComponent(created.session_id)}/audit`, {});
  assert(audit.summary?.total > 0, "manager audit should return visible feedback criteria");
  assert(audit.results?.some((item) => item.criterion === "Feedback location is clear"), "manager audit should explain where feedback is visible");
  const managerAudits = await getJson("/api/manager/audits?limit=20");
  assert(managerAudits.audits?.some((item) => item.session_id === created.session_id), "fresh manager audits should be saved to the manager audit history");
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
  const coderFallback = await postJson("/api/sessions/new", {
    content: "Test the default Coder desk through OpenClaw.",
    team_id: "home-room",
    agent: "coder"
  });
  assert(coderFallback.session?.agent === "coder", "Coder profile should remain selected");
  assert(coderFallback.session?.agent_model === "OpenClaw local agent", "Coder should run through OpenClaw in AgentGUI");
  await waitForJson(
    "/api/sessions",
    (items) => items.find((session) => session.id === coderFallback.session_id && session.task_solved === true),
    "Coder session to complete through OpenClaw"
  );

  const legacyShare = await postJsonAllowError(`/api/sessions/${encodeURIComponent(created.session_id)}/share`, { shared: true });
  assert(legacyShare.status === 410, "individual agent sharing should be retired");

  const walletAddress = "0x0000000000000000000000000000000000000abc";
  const wallet = await postJson("/api/wallet/login", { address: walletAddress, chain_id: "0x1" });
  assert(wallet.wallet?.address === walletAddress, "wallet login should store the connected pubkey");
  const legacyRoomShare = await postJsonAllowError("/api/public/rooms/share", {
    team_id: "room-launch",
    team_name: "Launch",
    shared: true
  });
  assert(legacyRoomShare.status === 410, "room sharing should be retired");

  const projectShare = await postJson("/api/public/projects/share", {
    name: "Browser E2E Project",
    share_file_repo: true,
    rooms: [
      { id: "home-room", name: "Home" },
      { id: "room-launch", name: "Launch" }
    ]
  });
  assert(projectShare.project?.id?.startsWith("public-project-"), "projects should be shareable");
  const projectId = projectShare.project.id.replace("public-project-", "");
  assert(projectId !== "project-local", "shared project ids should be scoped to the publishing node");
  let topProjects = await getJson("/api/top-projects?limit=100");
  const sharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(sharedProject?.rank >= 1, "Top100 Projects should rank shared projects");
  assert(sharedProject?.summary?.includes("File Repo"), "shared projects should remember whether the File Repo was included");
  const projectCopy = await postJson(`/api/sessions/${encodeURIComponent(projectShare.project.id)}/copy`, {});
  assert(projectCopy.session_ids?.length >= 2, "copying a Public Project should copy multiple agents");
  topProjects = await getJson("/api/top-projects?limit=100");
  const copiedSharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(copiedSharedProject?.copy_count === 1, "Top100 Projects should count project copies");
  assert(copiedSharedProject?.donation_total_usdc === 0, "Top100 Projects should expose donation totals");
  await postJson("/api/donations", {
    session_id: projectShare.project.id,
    target_type: "project",
    target_id: projectId,
    amount: 1,
    wallet_address: walletAddress,
    chain_id: "0x1"
  });
  const review = await postJson(`/api/public/projects/${encodeURIComponent(projectId)}/reviews`, {
    wallet_address: walletAddress,
    rating: 5,
    title: "Actually useful",
    comment: "Imported cleanly and gave me a sensible project structure."
  });
  assert(review.stats?.review_count === 1, "Public Project reviews should be counted");
  assert(review.stats?.rating_avg === 5, "Public Project reviews should average ratings");
  const projectDetail = await getJson(`/api/public/projects/${encodeURIComponent(projectId)}`);
  assert(projectDetail.project?.title === "Browser E2E Project", "Public Project detail should expose the project title");
  assert(projectDetail.rooms?.some((room) => room.tasks?.some((task) => task.description.includes("market-research agent"))), "Public Project detail should explain included tasks");
  assert(projectDetail.reviews?.some((item) => item.title === "Actually useful"), "Public Project detail should expose readable reviews");
  const explorerReport = await postJson(`/api/public/projects/${encodeURIComponent(projectId)}/explore`, {});
  assert(explorerReport.report?.summary?.includes("Browser E2E Project"), "Explorer should explain the selected public project");
  assert(explorerReport.report?.copy_fit, "Explorer should return a copy-fit recommendation");
  const chatPost = await postJson("/api/network/chat", {
    wallet_address: walletAddress,
    message: "Browser E2E says hello to Network Activity."
  });
  assert(chatPost.message?.message.includes("Network Activity"), "Network chat should accept public messages");
  const chatList = await getJson("/api/network/chat?limit=20");
  assert(chatList.messages?.some((item) => item.message.includes("Network Activity")), "Network chat should list saved messages");
  const activity = await getJson("/api/network/activity?limit=100");
  assert(activity.events?.some((item) => item.type === "network_chat_message"), "Network activity should list chat events");
  topProjects = await getJson("/api/top-projects?limit=100");
  const donatedSharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(donatedSharedProject?.donation_total_usdc === 1, "Top100 Projects should sum project donations");
  assert(donatedSharedProject?.review_count === 1, "Top100 Projects should expose review counts");
  assert(donatedSharedProject?.rating_avg === 5, "Top100 Projects should expose average ratings");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Network Live");
  await expectText(page, "body", "Latest Projects");
  await expectText(page, "body", "Browser E2E Project");
  await expectText(page, "body", "send Explorer before copying");
  await expectText(page, "body", "1 copies");
  await page.getByRole("button", { name: "Save Project" }).click();
  await page.getByPlaceholder("Project save name...").fill("Browser Saved Project");
  await page.locator('button').filter({ hasText: /^Save$/ }).click();
  await expectText(page, "body", "Browser Saved Project");
  await page.getByRole("button", { name: "New Project" }).click();
  await expectText(page, "body", "Browser Saved Project");
  const afterNewProjectSessions = await getJson("/api/sessions");
  assert(afterNewProjectSessions.some((session) => session.id === created.session_id), "New Project should not end the previous private project sessions");
  await page.getByRole("button", { name: "Browser Saved Project" }).click();
  await page.locator('button[title="View what this public project does"]').first().click();
  await expectText(page, "body", "Project Rooms");
  await expectText(page, "body", "Actually useful");
  await expectText(page, "body", "Send Explorer");
  await page.getByRole("button", { name: "Send Explorer" }).click();
  await expectText(page, "body", "Copy fit");
  await page.locator('[aria-label="Public project details"] button[title="Close"]').click();
  await page.getByRole("button", { name: "Top100 Projects" }).click();
  await expectText(page, "body", "Top100 Projects");
  await expectText(page, "body", "Browser E2E Project");
  await expectText(page, "body", "1 USDC earned");
  await expectText(page, "body", "5.0 stars");
  await expectText(page, "body", "Details");
  await expectText(page, "body", "Review");
  await page.getByRole("button", { name: "Network Activity" }).click();
  await expectText(page, "body", "Public OSA shares");
  await expectText(page, "body", "Network chat message");
  await page.getByPlaceholder("Message the network").fill("Browser chat from the floating window.");
  await page.getByRole("button", { name: "Send" }).click();
  await expectText(page, "body", "Browser chat from the floating window.");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset" }).click();
  const afterResetSessions = await waitForJson(
    "/api/sessions",
    (items) => Array.isArray(items) && items.length >= 1 && items.every((session) => session.team_id === "public-projects-room") ? items : null,
    "reset to wipe private sessions while keeping Latest Projects"
  );
  assert(afterResetSessions.length >= 1, "Latest Projects should remain after reset");

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

async function putJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJsonAllowError(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, ok: response.ok, payload };
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
