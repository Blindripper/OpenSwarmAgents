import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encodeFrame, makeOffer } from "@flop-labs/tclk";

const require = createRequire(import.meta.url);
const tclkMcpEntry = require.resolve("@flop-labs/tclk-mcp");
const tclkMcpCli = join(dirname(tclkMcpEntry), "cli.js");
const childEnv = { ...process.env, TECHNOCORE_URL: "http://127.0.0.1:9" };
delete childEnv.TECHNOCORE_SIGNING_KEY;
delete childEnv.TCLK_PAYMENT_KEY;

const client = new Client({ name: "osa-tclk-mcp-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [tclkMcpCli],
  env: childEnv
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  for (const requiredTool of [
    "tclk_make_offer",
    "tclk_accept_offer",
    "tclk_make_lock",
    "tclk_make_reveal",
    "tclk_make_receipt",
    "tclk_decode",
    "tclk_apply_transcript",
    "tclk_verify_secret",
    "tclk_whoami"
  ]) {
    assert(toolNames.has(requiredTool), `TCLK MCP should expose ${requiredTool}`);
  }

  const now = Date.now();
  const offerLine = encodeFrame(makeOffer({
    from: "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F",
    role: "payer",
    amount: "1",
    asset: "FLOP",
    lock: "hash",
    rails: ["paper"],
    expiresMs: now + 60_000,
    claimByMs: now + 120_000,
    refundAfterMs: now + 180_000
  }));
  const decoded = await client.callTool({ name: "tclk_decode", arguments: { line: offerLine } });
  assert(decoded.isError !== true, "TCLK MCP should decode a canonical tclk/1 offer frame");

  const whoami = await client.callTool({ name: "tclk_whoami", arguments: {} });
  assert(whoami.isError !== true, "TCLK MCP whoami should work without signing or payment keys");
  const whoamiText = JSON.stringify(whoami);
  assert(!whoamiText.includes("BEGIN PRIVATE KEY"), "TCLK MCP must not expose private-key material");
  assert(!/[0-9a-f]{64}/i.test(whoamiText), "Keyless TCLK MCP must not expose a raw 32-byte key");

  console.log(`TCLK MCP smoke passed (${toolNames.size} tools, keyless frame-tool mode)`);
} finally {
  await client.close().catch(() => {});
}
