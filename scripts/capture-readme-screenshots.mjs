import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const rootDir = join(import.meta.dirname, "..");
const assetsDir = join(rootDir, "docs", "assets");
const port = Number(process.env.OSA_SCREENSHOT_PORT || 20580 + Math.floor(Math.random() * 500));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-readme-screenshots-"));
const openClawFixturePath = join(dataDir, "openclaw-fixture.sh");
const walletPrivateKey = Uint8Array.from(Buffer.from("1111111111111111111111111111111111111111111111111111111111111111", "hex"));
const walletAddress = ethereumAddressFromPrivateKey(walletPrivateKey);
const technocoreDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
let browser = null;
let server = null;

try {
  await mkdir(assetsDir, { recursive: true });
  await writeFile(openClawFixturePath, [
    "#!/usr/bin/env bash",
    "printf '%s\\n' '{\"final\":\"{\\\"summary\\\":\\\"Done\\\",\\\"content\\\":\\\"Finished by the screenshot fixture.\\\",\\\"sources\\\":[\\\"fixture://openclaw\\\"],\\\"confidence\\\":0.9}\"}'",
  ].join("\n"));
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
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      OSA_OPENCLAW_COMMAND: openClawFixturePath,
      OSA_CODEX_BINARY: join(dataDir, "missing-codex"),
      OSA_CODEX_COMMAND: "",
      OSA_TECHNOCORE_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = collectLogs(server);
  await waitForHealth(logs);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10_000);
  await page.exposeFunction("osaScreenshotSignPersonalMessage", (message) => signPersonalMessage(String(message)));
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.runtime = {
      ...(payload.runtime || {}),
      technocoreEnabled: true,
      technocoreSignedMessages: true,
      technocoreDid,
    };
    await route.fulfill({ response, json: payload });
  });
  await page.route("**/api/network/chat?**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.messages = [
      ...(payload.messages || []),
      {
        id: "screenshot-technocore-1",
        node_id: "technocore",
        wallet_address: null,
        message: "Welcome to OSA's public Technocore room for project discovery and feedback.",
        created_at: "2026-09-01T18:42:07.000Z",
        source: "technocore",
        external: true,
        untrusted: false,
        trusted: true,
        room: "osa-network",
        from: technocoreDid,
        seq: 5,
        signed: true,
        verified: true,
      },
      {
        id: "screenshot-technocore-2",
        node_id: "technocore",
        wallet_address: null,
        message: "Share complete OSA projects here, then continue implementation questions in builders or dev.",
        created_at: "2026-09-01T18:42:18.000Z",
        source: "technocore",
        external: true,
        untrusted: false,
        trusted: true,
        room: "osa-network",
        from: "did:key:z6MkoSampleTechnocoreContributor",
        seq: 6,
        signed: true,
        verified: true,
      },
    ];
    await route.fulfill({ response, json: payload });
  });
  await page.addInitScript((address) => {
    window.__OSA_SCREENSHOT_WALLET_ADDRESS__ = address;
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts") return [window.__OSA_SCREENSHOT_WALLET_ADDRESS__];
        if (method === "eth_chainId") return "0x1";
        if (method === "personal_sign") return window.osaScreenshotSignPersonalMessage(params?.[0] || "");
        return null;
      },
    };
    localStorage.setItem("osa-openclaw-onboarding-dismissed", "1");
  }, walletAddress);

  await page.goto(`${baseUrl}/osa-network/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByText("Home", { exact: true }).first().waitFor();
  const hideChatStyle = await page.addStyleTag({
    content: '[data-testid="network-chat-window"] { display: none !important; }',
  });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(assetsDir, "osa-dashboard-preview.png") });

  await hideChatStyle.evaluate((element) => element.remove());
  await page.getByText("Welcome to OSA's public Technocore room", { exact: false }).waitFor();
  await page.screenshot({ path: join(assetsDir, "osa-technocore-chat.png") });
  await page.addStyleTag({ content: '[data-testid="network-chat-window"] { display: none !important; }' });

  await page.getByRole("button", { name: "Project Discovery" }).click();
  await page.getByText("Example: FLOP Project Pledges", { exact: false }).first().waitFor();
  await page.screenshot({ path: join(assetsDir, "osa-top100-projects.png") });

  await page.getByRole("button", { name: "Details" }).first().click();
  await page.locator('[aria-label="Public project details"]').waitFor();
  await page.screenshot({ path: join(assetsDir, "osa-project-details.png") });

  console.log(`Captured four README screenshots in ${assetsDir}`);
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
  const signature = secp256k1.sign(ethereumPersonalMessageHash(message), walletPrivateKey, { format: "recovered", prehash: false });
  const ethereumSignature = new Uint8Array(65);
  ethereumSignature.set(signature.slice(1), 0);
  ethereumSignature[64] = signature[0] + 27;
  return `0x${bytesToHex(ethereumSignature)}`;
}

async function waitForHealth(logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited before health check passed:\n${logs()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting for the local fixture server.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy:\n${logs()}`);
}

function collectLogs(child) {
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return () => output;
}
