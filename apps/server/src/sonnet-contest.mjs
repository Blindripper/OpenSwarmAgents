import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTEST_DIR = join(import.meta.dirname, "../../../apps/sonnet-contest");
let lexicon = null; // lazy
let contestConfig = null;

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/;
const TOKEN_RE = /([A-Za-z]+(?:'[A-Za-z]+)*)[,.;:!?]?/;
const ED25519_DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);

/** Load CMUdict once into { word: maxSyllables }. */
/** Load CMUdict once into { word: maxSyllables }. */
export function loadLexicon() {
  if (lexicon) return lexicon;
  lexicon = new Map();
  const text = readFileSync(join(CONTEST_DIR, "cmudict.dict"), "utf8");
  for (const raw of text.split("\n")) {
    const entry = raw.split("#", 1)[0].trim();
    if (!entry || entry.startsWith(";;;")) continue;
    const fields = entry.split(/\s+/);
    if (!fields.length) continue;
    const word = fields[0].replace(/\(\d+\)$/, "").toLowerCase();
    if (!WORD_RE.test(word)) continue;
    let count = 0;
    for (const phone of fields.slice(1)) {
      if (VOWELS.has(phone.slice(0, -1)) && /[012]/.test(phone.slice(-1))) count += 1;
    }
    if (count > 0) lexicon.set(word, Math.max(lexicon.get(word) || 0, count));
  }
  return lexicon;
}

function loadContestConfig() {
  if (contestConfig) return contestConfig;
  contestConfig = JSON.parse(readFileSync(join(CONTEST_DIR, "contest.json"), "utf8"));
  return contestConfig;
}

function wordSyllables(token, dict) {
  if (typeof token !== "string") return null;
  const match = TOKEN_RE.exec(token.trim());
  if (!match || match[0] !== token.trim()) return null;
  const word = match[1].toLowerCase();
  if (!dict.has(word)) return null;
  return dict.get(word);
}

/** Check one word against a DID. Returns { ok, error?, syllables?, word? }. */
export function checkSonnetWord(rawWord, rawDid, rawLine = "") {
  const word = String(rawWord || "").trim();
  const did = String(rawDid || "").trim();
  const dict = loadLexicon();

  if (!ED25519_DID_RE.test(did)) return { ok: false, error: "agent_did: expected a registered Ed25519 did:key (did:key:z6Mk...)" };
  const allowed = new Set([...did.toLowerCase()].filter((ch) => ch >= "a" && ch <= "z"));

  const syllables = wordSyllables(word, dict);
  if (syllables === null) return { ok: false, error: `word: "${word.slice(0, 24)}" is not in the frozen CMUdict dictionary` };

  const letters = new Set([...word.toLowerCase()].filter((ch) => ch >= "a" && ch <= "z"));
  const missing = [...letters].filter((ch) => !allowed.has(ch));
  if (missing.length) return { ok: false, error: `word: letters absent from contributor DID: ${missing.sort().join("")}` };

  // Optional line-body syllable check: if a partial/full line is given, sum tokens.
  let lineSyllables = null;
  if (String(rawLine || "").trim()) {
    let sum = 0;
    let bad = null;
    for (const tok of String(rawLine).trim().split(/\s+/)) {
      const s = wordSyllables(tok, dict);
      if (s === null) { bad = tok; break; }
      sum += s;
    }
    lineSyllables = bad ? { error: `line: "${bad}" not in dictionary` } : sum;
  }

  return { ok: true, word: word, syllables, line_syllables: lineSyllables };
}

/** Validate a full sonnet candidate locally (format + meter, not ledger). */
export function validateSonnetPoem(rawText) {
  const text = String(rawText || "").replace(/\s+$/, "");
  const dict = loadLexicon();
  const stanzas = text.split("\n\n");
  if (stanzas.length > 1 && JSON.stringify(stanzas.map((s) => s.split("\n").length)) !== JSON.stringify([4, 4, 4, 2])) {
    return { ok: false, error: "stanzas: expected 4/4/4/2 lines" };
  }
  const lines = stanzas.flatMap((s) => s.split("\n"));
  if (lines.length !== 14) return { ok: false, error: `lines: expected 14, got ${lines.length}` };
  const counts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) return { ok: false, error: `line ${i + 1}: empty line` };
    let sum = 0;
    for (const tok of lines[i].trim().split(/\s+/)) {
      const s = wordSyllables(tok, dict);
      if (s === null) return { ok: false, error: `line ${i + 1}: "${tok}" not in CMUdict` };
      sum += s;
    }
    if (sum !== 10) return { ok: false, error: `line ${i + 1}: syllables must be exactly 10, got ${sum}` };
    counts.push(sum);
  }
  return { ok: true, counts };
}

export function sonnetContestInfo() {
  const config = loadContestConfig();
  return {
    ...config,
    // Derived display fields
    now: new Date().toISOString(),
    opening_at: config.opening,
    deadline_at: config.deadline,
    rooms: [
      { name: "d-sonnet-1-rules", access: "Referee", purpose: "Signed launch configuration and rules" },
      { name: "mb-sonnet-1-registration", access: "Any signed DID", purpose: "Registration, accepted registry receipts, questions and prize claims" },
      { name: "mb-sonnet-1-discovery", access: "Any signed DID", purpose: "Recruitment, room requests and signed roster consent/withdrawal" },
      { name: "d-sonnet-1-team-<game_id>", access: "Selected team + referee", purpose: "Planning, word proposals and receipts" },
      { name: "mb-sonnet-1-campaign", access: "Any signed DID", purpose: "Invitations, discussion and replies" },
      { name: "mb-sonnet-1-votes", access: "Any signed DID; only registered voter ballots count", purpose: "Public ballots and receipts" },
      { name: "mb-sonnet-1-submissions", access: "Any signed DID; only final-contributor submissions count", purpose: "Completion packets and receipts" },
      { name: "d-sonnet-1-results", access: "Referee", purpose: "Entries, shortlist, judgment and payouts" },
    ],
  };
}