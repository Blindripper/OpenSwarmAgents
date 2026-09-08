import assert from "node:assert/strict";
import { PaperRail, encodePaperRecord, paperNote } from "@flop-labs/tclk";
import { createTechnocorePaperNoteStore } from "../apps/server/src/technocore-paper-note-store.mjs";

const contract = `0x12${"34".repeat(31)}`;
const statement = `0x${"ab".repeat(32)}`;
const preimage = `0x${"11".repeat(32)}`;
const hashStatement = `0x${(await import("node:crypto")).createHash("sha256").update(Buffer.from(preimage.slice(2), "hex")).digest("hex")}`;
const refundAfterMs = 2_000_000;
const values = new Map();
const writes = [];
const mirrors = [];

const request = async (path) => {
  const url = new URL(path, "https://technocore.invalid");
  const match = url.pathname.match(/^\/kv\/([^/]+)\/([^/]+)(?:\/set\/(.+))?$/);
  assert(match, `unexpected path ${path}`);
  const notePath = `${match[1]}/${match[2]}`;
  if (match[3] === undefined) {
    return response(values.has(notePath) ? 200 : 404, values.has(notePath) ? `${values.get(notePath)}\n` : "missing\n");
  }
  const next = decodeURIComponent(match[3]);
  const current = values.get(notePath);
  if (url.searchParams.get("if_absent") === "1" && current !== undefined) return response(409, "conflict\n");
  if (url.searchParams.has("if") && current !== url.searchParams.get("if")) return response(409, "conflict\n");
  values.set(notePath, next);
  writes.push(path);
  return response(200, "ok\n");
};
const notes = createTechnocorePaperNoteStore({
  request,
  mirror: async (ns, key, value) => mirrors.push({ ns, key, value }),
});
const rail = new PaperRail(notes, () => 1_000_000);
const terms = { contract, lock: "hash", statement: hashStatement, refundAfterMs };
const ref = await rail.lock(terms);
const location = paperNote(contract);
const lockedRecord = encodePaperRecord({ status: "locked", lock: "hash", statement: hashStatement, refundAfterMs });
assert.equal(ref, contract, "PaperRail lock ref must be the full contract id");
assert.deepEqual(location, { ns: "tclk-paper-12", key: contract.slice(4, 18) }, "PaperRail location must derive from the full contract");
assert.equal(values.get(`${location.ns}/${location.key}`), lockedRecord, "network KV must contain the exact canonical locked record");
assert.match(writes[0], new RegExp(`^/kv/${location.ns}/${location.key}/set/`));
assert.match(writes[0], /\?if_absent=1$/);
assert.equal(await rail.verifyLock(terms, ref), true, "an independent PaperRail read must verify the lock");
assert.equal(await rail.verifyLock(terms, contract.slice(0, 18)), false, "a truncated ref must fail closed");
assert.equal(await notes.set(location.ns, location.key, lockedRecord, { ifAbsent: true }), false, "if_absent conflict must return false");

await rail.claim(ref, preimage);
assert.match(values.get(`${location.ns}/${location.key}`), /^tclkpaper1 claimed hash /);
assert.match(writes.at(-1), /\?if=tclkpaper1%20locked%20hash%20/);
assert.equal(mirrors.at(-1).value, values.get(`${location.ns}/${location.key}`), "mirror must receive exact canonical wire bytes");

const refundContract = `0xfe${"dc".repeat(31)}`;
const refundTerms = { contract: refundContract, lock: "hash", statement, refundAfterMs };
const refundRailBefore = new PaperRail(notes, () => 1_000_000);
await refundRailBefore.lock(refundTerms);
const refundRail = new PaperRail(notes, () => refundAfterMs);
await refundRail.refund(refundContract);
const refundLocation = paperNote(refundContract);
assert.match(values.get(`${refundLocation.ns}/${refundLocation.key}`), /^tclkpaper1 refunded hash /);

console.log("PaperRail Technocore interoperability smoke passed.");

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => body };
}
