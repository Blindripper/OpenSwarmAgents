import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_BROWSER_E2E_PORT || 19880 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-browser-e2e-"));
const openClawFixturePath = join(dataDir, "openclaw-fixture.sh");
const testWalletPrivateKey = Uint8Array.from(Buffer.from("1111111111111111111111111111111111111111111111111111111111111111", "hex"));
const testWalletAddress = ethereumAddressFromPrivateKey(testWalletPrivateKey);
const testTechnocoreDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
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
  const balance = await getJson(`/api/wallet/balance?address=${testWalletAddress}`);
  assert(balance.balance_flop === null && balance.formatted === "Prelaunch" && balance.source === "flop_prelaunch", "wallet endpoint should honestly report FLOP prelaunch state");
  let config = await getJson("/api/gui-config");
  const agentIds = config.agents.map((agent) => agent.id);
  for (const id of ["technocore-specialist", "coder", "bugfixer", "info-guy", "coinexpert", "graphicsexpert", "moneymaker", "security-expert", "explorer"]) {
    assert(agentIds.includes(id), `Agent Profiles should include ${id}`);
  }
  assert(config.default_agent_id === "technocore-specialist", "Technocore Specialist should be the default AgentGUI profile");
  const defaultPersona = await getJson("/api/agents/technocore-specialist/persona");
  assert(defaultPersona.soul.includes("technocore.chat"), "default Technocore Specialist should include Technocore protocol context");
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

  for (let index = 1; index <= 12; index += 1) {
    await postJson("/api/network/chat", {
      wallet_address: testWalletAddress,
      message: `Search marker ${String(index).padStart(2, "0")}: browser chat viewport fixture with enough text to verify scrolling.`
    });
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(8000);
  await page.exposeFunction("osaE2eSignPersonalMessage", (message) => signPersonalMessage(String(message)));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  let chatGetRequestCount = 0;
  let sentChatFixture = null;
  await page.route("**/api/network/chat**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body?.message !== "Browser signed DID delivery") return route.continue();
      sentChatFixture = {
        id: "network-chat-browser-signed",
        node_id: "browser-fixture-node",
        wallet_address: testWalletAddress,
        message: body.message,
        created_at: "2026-09-02T05:30:00.000Z",
        source: "osa",
        external: false,
        untrusted: false,
        room: "osa-network",
        from: testTechnocoreDid,
        seq: 9001,
        signed: true,
        delivery_status: "sent"
      };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, technocore_mirrored: true, message: sentChatFixture }) });
    }
    if (route.request().method() !== "GET") return route.continue();
    chatGetRequestCount += 1;
    if (chatGetRequestCount === 3) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{" });
    }
    const response = await route.fetch();
    if (!sentChatFixture) return route.fulfill({ response });
    const payload = await response.json();
    payload.messages = [
      ...(payload.messages || []),
      { ...sentChatFixture, id: "technocore-chat-osa-network-9001", source: "technocore", external: true, untrusted: true },
      sentChatFixture
    ];
    return route.fulfill({ response, json: payload });
  });
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.runtime = {
      ...(payload.runtime || {}),
      technocoreEnabled: true,
      technocoreSignedMessages: true,
      technocoreDid: testTechnocoreDid
    };
    await route.fulfill({ response, json: payload });
  });
  await page.addInitScript((walletAddress) => {
    window.__OSA_E2E_WALLET_ADDRESS__ = walletAddress;
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts") return [window.__OSA_E2E_WALLET_ADDRESS__];
        if (method === "eth_chainId") return "0x1";
        if (method === "personal_sign") return window.osaE2eSignPersonalMessage(params?.[0] || "");
        return null;
      }
    };
    localStorage.setItem("osa-openclaw-onboarding-dismissed", "1");
    if (!localStorage.getItem("osa-workbench-v2")) {
      localStorage.setItem("osa-workbench-v2", JSON.stringify({
        version: 2,
        teams: [
          { id: "home-room", color: "blue", name: "Home", items: [] },
          { id: "public-room", color: "purple", name: "Public", items: [] },
          { id: "public-rooms-room", color: "orange", name: "Public Rooms", items: [] },
          { id: "public-projects-room", color: "orange", name: "Latest Projects", items: [] }
        ]
      }));
    }
  }, testWalletAddress);

  await page.goto(`${baseUrl}/osa-network/`, { waitUntil: "domcontentloaded" });
  await expectText(page, "body", "Connect Wallet");
  await expectText(page, "body", "Wallet identity required");
  await expectText(page, "body", "$FLOP is not live yet");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Latest Projects");
  await expectText(page, "body", "Top100 Projects");
  await expectText(page, "body", "OSA Network Activity");
  await expectText(page, "body", "osa-network");
  await expectText(page, "body", "TC DID");
  await expectText(page, "body", "z6MkvG");
  assert(await page.getByRole("button", { name: "Copy Technocore DID" }).count() === 1, "topbar should expose a copyable Technocore DID when signing is active");
  const chatWindow = page.getByTestId("network-chat-window");
  const initialChatBox = await chatWindow.boundingBox();
  assert(initialChatBox && initialChatBox.width >= 560 && initialChatBox.height >= 600, "network chat should open as a large default window");
  const resizeHandle = page.getByTestId("network-chat-resize");
  const resizeBox = await resizeHandle.boundingBox();
  assert(resizeBox, "network chat should expose a resize handle");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 120, resizeBox.y + resizeBox.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const resizedChatBox = await chatWindow.boundingBox();
  assert(
    resizedChatBox && resizedChatBox.width > initialChatBox.width + 80 && resizedChatBox.height > initialChatBox.height + 20,
    "network chat should be resizable by dragging the corner handle"
  );
  const chatMessages = page.getByTestId("network-chat-messages");
  await expectText(page, '[data-testid="network-chat-messages"]', "Search marker 12");
  for (let attempt = 0; attempt < 24 && chatGetRequestCount < 4; attempt += 1) await delay(250);
  assert(chatGetRequestCount >= 4, "network chat polling should recover after a transient third refresh failure");
  assert(await page.getByRole("checkbox", { name: "Slow mode" }).isChecked(), "network chat slow mode should be enabled by default");
  assert(
    await chatMessages.evaluate((element) => getComputedStyle(element).overflowY === "scroll" && element.scrollHeight > element.clientHeight),
    "network chat messages should have a stable, scrollable viewport"
  );
  assert(/\d{1,2}:\d{2}:\d{2}/.test(await chatMessages.innerText()), "network chat timestamps should include seconds");
  await page.getByRole("textbox", { name: "Search messages" }).fill("Search marker 07");
  await expectText(page, '[data-testid="network-chat-messages"]', "Search marker 07");
  assert(!(await chatMessages.innerText()).includes("Search marker 08"), "message search should filter the cached channel messages");
  await page.getByRole("textbox", { name: "Search messages" }).fill("");
  const chatPollCountBeforeSend = chatGetRequestCount;
  await page.getByPlaceholder("Message osa-network").fill("Browser signed DID delivery");
  await page.getByRole("button", { name: "Send" }).click();
  await expectText(page, '[data-testid="network-chat-messages"]', "Browser signed DID delivery");
  for (let attempt = 0; attempt < 24 && chatGetRequestCount <= chatPollCountBeforeSend; attempt += 1) await delay(250);
  assert(chatGetRequestCount > chatPollCountBeforeSend, "network chat should reconcile the sent record with a later room poll");
  assert(await chatMessages.getByText("Browser signed DID delivery", { exact: true }).count() === 1, "a signed osa-network message and its Technocore mirror should render only once");
  await expectText(page, '[data-testid="network-chat-messages"]', "z6MkvG23xu...");
  await expectText(page, '[data-testid="network-chat-messages"]', "signed DID");
  await page.getByRole("button", { name: "#" }).click();
  await expectText(page, "body", "Main channels");
  await expectText(page, "body", "Other channels");
  await expectText(page, "body", "builders");
  await page.getByRole("textbox", { name: "Search channels" }).fill("validators");
  await expectText(page, "body", "validators");
  assert(await page.getByRole("button", { name: /builders/i }).count() === 0, "channel search should filter the # channel picker");
  await page.getByRole("button", { name: "#" }).click();
  await expectText(page, "body", "Canvas");
  await expectText(page, "body", "Start a desk to show project results.");
  await page.locator('button[title="Collapse canvas"]').click();
  await page.locator('button[title="Open result canvas"]').click();
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
  assert(bodyText.includes("FLOP PLEDGES"), "topbar should label prelaunch FLOP pledge totals clearly");
  assert(bodyText.includes("Prelaunch"), "topbar should show the honest FLOP prelaunch state");
  assert(!bodyText.includes("0 OSA"), "topbar should not present a retired OSA token balance");
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
  assert(roomCreated.session?.agent === "technocore-specialist", "sessions without an explicit agent should use Technocore Specialist");
  assert(roomCreated.session?.agent_model === "OpenClaw local agent", "Technocore Specialist should run through OpenClaw in AgentGUI");
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
  await page.evaluate(({ createdId, roomId, coderId }) => {
    localStorage.setItem("osa-workbench-v2", JSON.stringify({
      version: 2,
      teams: [
        {
          id: "home-room",
          color: "blue",
          name: "Home",
          items: [
            { type: "session", id: createdId },
            { type: "session", id: coderId }
          ]
        },
        {
          id: "room-launch",
          color: "green",
          name: "Launch",
          items: [{ type: "session", id: roomId }]
        },
        { id: "public-projects-room", color: "orange", name: "Latest Projects", items: [] }
      ]
    }));
  }, {
    createdId: created.session_id,
    roomId: roomCreated.session_id,
    coderId: coderFallback.session_id
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Launch");
  await expectText(page, "body", "Build a small market-research agent");
  await expectText(page, "body", "Create a compact launch plan");
  await expectText(page, "body", "Test the default Coder desk");

  const legacyShare = await postJsonAllowError(`/api/sessions/${encodeURIComponent(created.session_id)}/share`, { shared: true });
  assert(legacyShare.status === 410, "individual agent sharing should be retired");

  const walletAddress = testWalletAddress;
  const wallet = await signedWalletLogin(walletAddress, "0x1");
  assert(wallet.wallet?.address === walletAddress, "wallet login should store the connected pubkey");
  const legacyRoomShare = await postJsonAllowError("/api/public/rooms/share", {
    team_id: "room-launch",
    team_name: "Launch",
    shared: true
  });
  assert(legacyRoomShare.status === 410, "room sharing should be retired");

  const projectShare = await postJson("/api/public/projects/share", {
    name: "Browser E2E Project",
    owner_wallet_address: walletAddress,
    share_file_repo: true,
    technocore_channels: ["osa-network"],
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
  assert(copiedSharedProject?.donation_total_flop === 0, "Top100 Projects should expose FLOP pledge totals");
  const pledge = await postJson("/api/donations", {
    session_id: projectShare.project.id,
    target_type: "project",
    target_id: projectId,
    amount: 1,
    wallet_address: walletAddress,
    chain_id: "0x1"
  });
  assert(pledge.donation?.currency === "FLOP" && pledge.donation?.feeAmount === 0, "donations should be zero-fee FLOP prelaunch pledges");
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
  assert(!activity.events?.some((item) => item.type === "agent_registered"), "Network activity should not leak private Home agent registrations");
  topProjects = await getJson("/api/top-projects?limit=100");
  const donatedSharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(donatedSharedProject?.donation_total_flop === 1, "Top100 Projects should sum FLOP pledge intents");
  assert(donatedSharedProject?.review_count === 1, "Top100 Projects should expose review counts");
  assert(donatedSharedProject?.rating_avg === 5, "Top100 Projects should expose average ratings");

  await page.reload({ waitUntil: "domcontentloaded" });
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
  await expectText(page, "body", "1 FLOP pledged");
  await expectText(page, "body", "5.0 stars");
  await expectText(page, "body", "Details");
  await expectText(page, "body", "Review");
  await page.getByRole("button", { name: "OSA Network Activity" }).click();
  await expectText(page, "body", "OSA shares");
  await expectText(page, "body", "Network chat message");
  await page.getByPlaceholder("Message osa-network").fill("Browser chat from the floating window.");
  await page.getByRole("button", { name: "Send" }).click();
  await expectText(page, "body", "Browser chat from the floating window.");

  const deletedProject = await deleteJson(`/api/public/projects/${encodeURIComponent(projectId)}`, {
    owner_wallet_address: walletAddress
  });
  assert(deletedProject.deleted === true, "owner wallet should be able to delete a shared public project");
  const afterDeleteTopProjects = await getJson("/api/top-projects?limit=100");
  assert(!afterDeleteTopProjects.agents.some((agent) => agent.target_id === projectId), "deleted projects should disappear from Top100 Projects");
  const afterDeleteSessions = await getJson("/api/sessions");
  assert(!afterDeleteSessions.some((session) => session.id === projectShare.project.id), "deleted projects should disappear from Latest Projects");

  assert(await page.getByRole("button", { name: "Reset" }).count() === 0, "Reset should not be exposed in the topbar");
  await expectText(page, "body", "PEERS");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Project" }).click();
  const afterDeleteProjectSessions = await waitForJson(
    "/api/sessions",
    (items) => Array.isArray(items) && items.length >= 1 && items.every((session) => session.team_id === "public-projects-room") ? items : null,
    "Delete Project to wipe private sessions while keeping Latest Projects"
  );
  assert(afterDeleteProjectSessions.length >= 1, "Latest Projects should remain after Delete Project");

  assert(pageErrors.length === 0, `browser console/page errors: ${pageErrors.join("\n")}`);
  console.log(`Browser E2E passed on ${baseUrl}`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
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

async function signedWalletLogin(address, chainId = "0x1") {
  const challenge = await postJson("/api/wallet/challenge", { address, chain_id: chainId });
  return postJson("/api/wallet/login", {
    address,
    chain_id: chainId,
    challenge_id: challenge.challenge.id,
    message: challenge.challenge.message,
    signature: signPersonalMessage(challenge.challenge.message)
  });
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

async function deleteJson(path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function expectText(page, selector, text) {
  try {
    await page.locator(selector).filter({ hasText: text }).waitFor({ state: "visible" });
  } catch (error) {
    let body = "";
    try {
      body = (await page.locator("body").innerText()).slice(0, 3000);
    } catch {
      body = "<body unavailable>";
    }
    throw new Error(`Expected visible text ${JSON.stringify(text)}. Body was:\n${body}\n\n${error.message}`);
  }
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
