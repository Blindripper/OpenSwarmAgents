import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const tokenomics = await readFile(join(root, "docs", "TOKENOMICS.md"), "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");
const app = await readFile(join(root, "vendor", "agent-gui", "frontend", "src", "App.tsx"), "utf8");
const header = await readFile(join(root, "vendor", "agent-gui", "frontend", "src", "components", "Header.tsx"), "utf8");
const server = await readFile(join(root, "apps", "server", "src", "server.mjs"), "utf8");

const required = [
  ["official FLOP source", `${tokenomics}\n${readme}`, "https://flop.finance/teaser/"],
  ["draft disclosure", tokenomics, "status **Draft**"],
  ["testnet target", `${tokenomics}\n${app}`, "Q4 2026"],
  ["mainnet target", `${tokenomics}\n${app}`, "Q1 2027"],
  ["prelaunch dashboard", `${app}\n${header}`, "Prelaunch"],
  ["FLOP pledge totals", `${header}\n${server}`, "donation_total_flop"],
  ["zero fee", server, "const flopDonationFeePercent = 0"],
  ["prelaunch API status", server, 'source: "flop_prelaunch"'],
  ["no OSA coin decision", readme, "will not issue or use its own `$OSA` coin"],
  ["mandatory wallet", readme.toLowerCase(), "wallet login is mandatory"],
];

for (const [label, haystack, needle] of required) {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

for (const [label, haystack, forbidden] of [
  ["dashboard OSA token copy", `${app}\n${header}`, "$OSA"],
  ["dashboard USDC donation copy", `${app}\n${header}`, "USDC"],
  ["README fixed-supply claim", readme, "10,000,000,000 OSA"],
]) {
  if (haystack.includes(forbidden)) {
    throw new Error(`Retired ${label} remains: ${forbidden}`);
  }
}

console.log("FLOP integration check passed");
