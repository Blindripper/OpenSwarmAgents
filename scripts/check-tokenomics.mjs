import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const contract = await readFile(join(root, "contracts", "OSAToken.sol"), "utf8");
const tokenomics = await readFile(join(root, "docs", "TOKENOMICS.md"), "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");

const required = [
  ["contract total supply", contract, "10_000_000_000 ether"],
  ["contract reward pool", contract, "5_000_000_000 ether"],
  ["contract reward duration", contract, "1095 days"],
  ["tokenomics total supply", tokenomics, "10,000,000,000 OSA"],
  ["tokenomics reward pool", tokenomics, "5,000,000,000 OSA"],
  ["fee/reward wallet", `${tokenomics}\n${readme}`, "0x0D92d175943336E3Ad099e55FBe4248dC6fA947b"],
  ["experimental disclaimer", readme.toLowerCase(), "worthless"],
  ["mandatory wallet", readme.toLowerCase(), "wallet login is mandatory"],
];

for (const [label, haystack, needle] of required) {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

console.log("tokenomics check passed");
