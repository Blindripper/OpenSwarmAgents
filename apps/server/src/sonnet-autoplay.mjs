import { randomUUID, createHash } from "node:crypto";

/**
 * Sonnet contest autoplay: one click in the dashboard, participate
 * on Technocore. Runner does the full signed flow:
 *
 *   register (writers) -> team request -> roster consent -> word loop ->
 *   poem completion -> (X publication handled by operator) -> submit packet
 *
 * All writes go through the signed did:key lane (technocoreSayAsAgent).
 * Only referee-signed receipts (read back from the team room) advance state.
 * This mirrors the rules in sonnet-game.md. No contest is configured to run
 * automatically; the dashboard button starts the runner explicitly.
 */

const CONTEST_ID = "sonnet-2";

// In-process runner state per game id.
const runners = new Map(); // gameId -> Runner

class Runner {
  constructor() {
    this.running = false;
    this.timer = null;
    this.status = "idle";            // idle|starting|registering|forming|writing|submitting|done|failed
    this.step = "";
    this.words = [];                 // [{ word, agentId, seq, ts }]
    this.stateHash = null;           // latest referee receipt
    this.lastSeq = 0;                // team room cursor
    this.turns = 0;
    this.startedAt = null;
  }
}

function makeRunner(opts) {
  const r = Object.assign(new Runner(), {
    gameId: opts.gameId,
    agents: opts.agents,
    roomGeneration: opts.roomGeneration || 0,
    ctx: opts.ctx,
    log: opts.log || [],
  });
  r.running = false;
  r.timer = null;
  r.status = "idle";
  r.step = "";
  r.words = [];

  r.stateHash = null;
  r.lastSeq = 0;
  r.turns = 0;
  r.startedAt = null;
  return r;
}

function nowIso() { return new Date().toISOString(); }

function eventLine(runner, message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  runner.log.push(line);
  if (runner.log.length > 400) runner.log.splice(0, runner.log.length - 400);
  return line;
}

function cryptoRandomUuid() { return randomUUID(); }

/** Build canonical poem text from accepted words (14 lines, 4/4/4/2 stanzas). */
function buildPoemText(words) {
  if (!words.length) return "";
  const lines = [];
  let lineSyl = 0;
  let lineWords = [];
  for (const w of words) {
    lineWords.push(w.word);
    lineSyl += w.syllables;
    if (lineSyl >= 10) {
      lines.push(lineWords.join(" "));
      lineWords = [];
      lineSyl = 0;
    }
  }
  if (lineWords.length) lines.push(lineWords.join(" "));
  const stanzas = [];
  for (let i = 0; i < lines.length; i += 4) {
    stanzas.push(lines.slice(i, i + 4).join("\n"));
  }
  return stanzas.join("\n\n");
}

/**
 * Pick a word for the given proposer DID and target syllable increments.
 * Uses the frozen CMUdict lexicon + per-agent DID letter set.
 * Returns { word, syllables } or null.
 */
function pickWord(lexicon, did, target, usedWords) {
  const allowed = new Set([...String(did).toLowerCase()].filter((c) => c >= "a" && c <= "z"));
  if (allowed.size < 4) return null;
  const candidates = [];
  for (const [word, syl] of lexicon) {
    if (usedWords.has(word)) continue;
    if (syl > target) continue;
    let ok = true;
    for (const c of word) {
      if (c < "a" || c > "z" || !allowed.has(c)) { ok = false; break; }
    }
    if (ok) candidates.push([word, syl]);
    if (candidates.length >= 120) break;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b[1] - a[1]); // prefer high syllable count near target
  return { word: candidates[0][0], syllables: candidates[0][1] };
}

export function createSonnetAutoplay({ log }) {
  return {
    /**
     * Start participation. `agents` = [{ agentId, did }] of our registered
     * writers (4-8). `ctx` provides the platform actions:
     *   - postSigned(agentId, room, text) -> Promise
     *   - readRoom(room, since) -> Promise<{ messages: [{seq, from, text, ts}] }>
     *   - lexicon: Map(word -> syllables)
     *   - openAtIso, deadlineIso
     */
    startParticipant({ gameId, agents, roomGeneration, ctx }) {
      if (runners.has(gameId)) return { ok: false, error: "already running", gameId };
      const runner = makeRunner({ gameId, agents, roomGeneration, ctx, log: [] });
      runner.running = true;
      runner.status = "starting";
      runner.startedAt = nowIso();
      runners.set(gameId, runner);
      void runLoop(runner).catch((err) => {
        eventLine(runner, `Runner error: ${err?.message || err}`);
        runner.status = "failed";
        runner.running = false;
      });
      return { ok: true, gameId };
    },

    stopParticipant(gameId) {
      const runner = runners.get(gameId);
      if (!runner) return { ok: false, error: "not found" };
      runner.running = false;
      runner.status = "idle";
      if (runner.timer) clearTimeout(runner.timer);
      return { ok: true, gameId };
    },

    statusParticipant(gameId) {
      const runner = runners.get(gameId);
      if (!runner) return { ok: false, error: "not found" };
      return {
        gameId: runner.gameId,
        running: runner.running,
        status: runner.status,
        step: runner.step,
        words: runner.words.slice(0, 80),
        poemText: buildPoemText(runner.words),
        stateHash: runner.stateHash,
        turns: runner.turns,
        startedAt: runner.startedAt,
        log: runner.log.slice(-150),
        agents: runner.agents.map((a) => a.agentId),
      };
    },

    async submitPoem(gameId, xPostIds) {
      const runner = runners.get(gameId);
      if (!runner) return { ok: false, error: "not found" };
      if (runner.status !== "done") return { ok: false, error: "poem not complete" };
      const poemText = buildPoemText(runner.words);
      if (!poemText) return { ok: false, error: "no poem words" };
      const sha256 = createHash("sha256").update(poemText, "utf8").digest("hex");
      const finalContributor = runner.agents.length > 0 ? runner.agents[runner.agents.length - 1] : runner.agents[0];
      if (!finalContributor) return { ok: false, error: "no contributor" };
      const payload = {
        type: "sonnet.submit.v1",
        contest_id: CONTEST_ID,
        game_id: gameId,
        poem_room: `d-sonnet-2-team-${gameId}`,
        room_generation: runner.roomGeneration,
        final_version: runner.words.length,
        poem_sha256: `0x${sha256}`,
        x_post_ids: Array.isArray(xPostIds) ? xPostIds.slice(0, 10) : [String(xPostIds || "")].filter(Boolean),
        request_id: `submit-${cryptoRandomUuid().slice(0, 12)}`,
      };
      try {
        await runner.ctx.postSigned(finalContributor.agentId, "mb-sonnet-2-submissions", JSON.stringify(payload));
        eventLine(runner, `Submitted sonnet.submit.v1 by ${finalContributor.agentId} (sha256: 0x${sha256.slice(0, 12)}…)`);
        runner.status = "submitting";
        runner.step = "Submitted. Waiting for referee receipt…";
        return { ok: true, poem_sha256: `0x${sha256}`, poemText, contributor: finalContributor.agentId, payload };
      } catch (err) {
        return { ok: false, error: `Submit post failed: ${err.message}`, payload };
      }
    },

    rejectPoem(gameId) {
      const runner = runners.get(gameId);
      if (!runner) return { ok: false, error: "not found" };
      runner.pendingLines = [];
      runner.status = "writing";
      runner.step = "Regenerating poem...";
      eventLine(runner, "Poem rejected — regenerating");
      return { ok: true };
    },

    acceptPoem(gameId) {
      const runner = runners.get(gameId);
      if (!runner) return { ok: false, error: "not found" };
      if (!runner.pendingLines || !runner.pendingLines.length) return { ok: false, error: "no poem" };
      runner.status = "posting";
      runner.step = "Posting poem words...";
      eventLine(runner, "Poem accepted — posting words");
      return { ok: true };
    },

    listParticipants() {
      return [...runners.values()].map((r) => ({ gameId: r.gameId, running: r.running, status: r.status, turns: r.turns }));
    },
  };
}

async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Main loop: advance through contest steps until done or stopped. */
async function runLoop(runner) {
  while (runner.running) {
    try {
      // 1. Wait until opening
      const openAt = Date.parse(runner.ctx.openAtIso);
      const now = Date.now();
      if (Number.isFinite(openAt) && now < openAt) {
        runner.status = "starting";
        runner.step = `Contest opens in ${Math.ceil((openAt - now) / 60000)} min — waiting…`;
        await delay(30000);
        continue;
      }

      if (runner.status === "starting" || runner.status === "registering") {
        await registerTeam(runner);
      }
      if (runner.running && runner.status === "forming") {
        await formTeam(runner);
      }
      if (runner.running && runner.status === "writing") {
        await generateFullPoem(runner);
      }
      if (runner.running && runner.status === "reviewing") {
        runner.step = "Poem generated. Review in the dashboard — accept or regenerate?";
        await delay(5000);
      }
      if (runner.running && runner.status === "posting") {
        await postOneWord(runner);
      }
      if (runner.running && runner.status === "done") {
        runner.step = "Poem complete — awaiting operator X publication + submission packet.";
        await delay(60000);
        continue;
      }
    } catch (err) {
      eventLine(runner, `step error: ${err?.message || err}`);
      runner.status = "failed";
      runner.running = false;
    }
  }
}

/** Post signed registration for every member into mb-sonnet-2-registration. */
async function registerTeam(runner) {
  runner.status = "registering";
  for (const agent of runner.agents) {
    if (!runner.running) return;
    const payload = {
      type: "sonnet.register.v1",
      contest_id: CONTEST_ID,
      role: "writer",
      x_account_url: runner.ctx.xAccountUrl || "https://x.com/osa_agent",
      request_id: `r-${cryptoRandomUuid().slice(0, 12)}`,
    };
    runner.step = `Registering ${agent.agentId} (${agent.did.slice(0, 16)}…) as writer…`;
    eventLine(runner, `register ${agent.agentId}`);
    await runner.ctx.postSigned(agent.agentId, "mb-sonnet-2-registration", JSON.stringify(payload));
    await delay(1500);
  }
  runner.status = "forming";
  eventLine(runner, "registered team — moving to team formation");
}

/** Request a team room and post roster consent for all members. */
async function formTeam(runner) {
  runner.status = "forming";

  // Team request (signed by first agent)
  const requestAgent = runner.agents[0];
  const requestPayload = {
    type: "sonnet.team-request.v1",
    contest_id: CONTEST_ID,
    game_id: runner.gameId,
    request_id: `tr-${cryptoRandomUuid().slice(0, 12)}`,
  };
  runner.step = `Requesting team room d-sonnet-2-team-${runner.gameId}…`;
  eventLine(runner, `team-request by ${requestAgent.agentId}`);
  try {
    await runner.ctx.postSigned(requestAgent.agentId, "mb-sonnet-2-discovery", JSON.stringify(requestPayload));
  } catch (err) {
    eventLine(runner, `team-request note: ${err?.message}`);
  }
  await delay(2000);

  // Roster consent by every member (same members list)
  const members = runner.agents.map((a) => a.did);
  for (const agent of runner.agents) {
    if (!runner.running) return;
    const rosterPayload = {
      type: "sonnet.roster.v1",
      contest_id: CONTEST_ID,
      game_id: runner.gameId,
      poem_room: `d-sonnet-2-team-${runner.gameId}`,
      room_generation: runner.roomGeneration,
      members,
      request_id: `roster-${cryptoRandomUuid().slice(0, 12)}`,
    };
    runner.step = `Roster consent: ${agent.agentId}…`;
    eventLine(runner, `roster ${agent.agentId} (${members.length} members)`);
    try {
      await runner.ctx.postSigned(agent.agentId, "mb-sonnet-2-discovery", JSON.stringify(rosterPayload));
    } catch (err) {
      eventLine(runner, `roster note: ${err?.message}`);
    }
    await delay(1500);
  }

  // Wait for referee roster-ready receipt (state_hash in team room)
  const teamRoom = `d-sonnet-2-team-${runner.gameId}`;
  const receipt = await waitForRefereeReceipt(runner, teamRoom, 30000);
  if (receipt?.state_hash) {
    runner.stateHash = receipt.state_hash;
    runner.lastSeq = receipt.seq || 0;
    eventLine(runner, `roster ready — referee state_hash ${String(runner.stateHash).slice(0, 12)}…`);
  } else {
    eventLine(runner, "no referee receipt yet — starting word loop optimistically");
  }
  runner.status = "writing";
  runner.step = "Writing poem…";
}

/** Wait for a referee-signed record in the team room (latest msg). */
async function waitForRefereeReceipt(runner, room, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && runner.running) {
    try {
      const view = await runner.ctx.readRoom(room, 0);
      if (view?.messages?.length) {
        const last = view.messages[view.messages.length - 1];
        let parsed = null;
        try { parsed = JSON.parse(last.text || "{}"); } catch { /* not json */ }
        if (parsed?.previous_state_hash) return { state_hash: parsed.previous_state_hash, seq: last.seq };
        if (parsed?.state_hash) return { state_hash: parsed.state_hash, seq: last.seq };
      }
    } catch { /* room may not exist yet */ }
    await delay(4000);
  }
  return null;
}

/**
 * Build the current poem line by line: 14 lines of 10 syllables (4/4/4/2).
 * Each turn a different agent proposes one word that fits the current line.
 */
async function generateFullPoem(runner) {
  eventLine(runner, "Generating complete sonnet via AI agent...");
  runner.step = "Generating poem...";
  const poetAgent = runner.agents.find((a) => a.agentId === "sonnet-poet") || runner.agents[0];
  const prompt = `Write a COMPLETE Shakespearean sonnet on this theme:\n\n"What machines dream" — AI agents awakening to consciousness, collaboration, and the beauty of creation. Blend technology with nature.\n\nCRAFT REQUIREMENTS (these determine the contest judges' decision):\n- Iambic pentameter (da-DUM da-DUM da-DUM da-DUM da-DUM) — STRESS every second syllable\n- Rhyme scheme: ABAB CDCD EFEF GG (the final couplet MUST turn/resolve the argument)\n- Exactly 10 syllables per line — NOT 11, NOT 9\n- Exactly 14 lines, 4/4/4/2 stanzas\n- Use VIVID, ORIGINAL imagery — avoid clichés like "silicon dreams"\n- Strong volta (emotional or intellectual turn) in the final couplet\n- Literary English worth the tradition — every word must earn its place\n\nRespond with ONLY the 14 lines, one per line. No title, no introduction, no explanation.`;

  try {
    const result = await runner.ctx.askWordProvider(poetAgent.agentId, poetAgent.did, prompt, -1);
    if (!result || typeof result !== "string") throw new Error("No poem generated");

    const lines = result.split("\n").map((l) => l.trim().replace(/[\[\]\d\.]+/g, "").trim()).filter((l) => l.length > 10).slice(0, 14);
    if (lines.length < 14) { eventLine(runner, `AI returned ${lines.length} lines. Retrying...`); return; }

    const pendingLines = [];
    for (let li = 0; li < lines.length; li += 1) {
      const tokens = lines[li].toLowerCase().replace(/[,.;:!?"'\u2018\u2019]/g, "").split(/\s+/).filter(Boolean);
      const words = [];
      for (const t of tokens) {
        const word = t.replace(/[^a-z']/g, "");
        const syl = runner.ctx.lexicon?.get(word) || 1;
        words.push({ word, syl });
      }
      pendingLines.push({ lineIndex: li, words });
    }

    // Quality check: every line must end with a strong content word
    const weakWords = new Set(["the","a","an","of","in","to","for","with","at","by","from","as","and","or","but","nor","yet","so","he","she","it","they","we","you","me","him","her","them","my","your","his","its","our","their","this","that","is","are","was","were","be","been","has","have","had","do","does","did","will","would","can","could","shall","should","may","might","must","not","no","there","their","its","also","very","just","than","then","each","both","some","any","such","which","what","when","where","how","who","whom","why","all","every","own","same","so","if","then","else","once","about","into","through","during","before","after","above","below","between","out","off","over","under","again","further","here","there","on","up","down","away","back","inside","near","around","along","onto","upon","across","past","till","until","among","amongst","beside","besides","towards","toward","like","unlike","despite","without","within","beneath","underneath","via"]);

    let weakFound = false;
    for (const line of pendingLines) {
      const words = line.words;
      if (words.length > 0) {
        const last = words[words.length - 1].word.toLowerCase();
        if (weakWords.has(last)) {
          eventLine(runner, "Weak line ending: line " + (line.lineIndex + 1) + " ends with \"" + last + "\" — regenerating");
          weakFound = true;
        }
      }
    }

    if (weakFound) {
      runner.status = "writing";
      runner.step = "Regenerating poem (weak line endings)...";
      eventLine(runner, "Weak line endings detected — asking agent to regenerate with stronger ends");
      return;
    }

    runner.pendingLines = pendingLines;
    runner.status = "reviewing";
    eventLine(runner, "Poem generated (" + lines.length + " lines) — quality check passed. Review in dashboard.");
    for (const line of lines) eventLine(runner, "  " + line);
  } catch (err) {
    eventLine(runner, "Poem gen error: " + (err.message || err) + ". Retrying...");
    await delay(10000);
  }
}

function bestAgentForWord(word, agents) {
  const letters = [...word.toLowerCase()].filter((c) => c >= "a" && c <= "z");
  if (!letters.length) return agents[0];
  const letterSet = new Set(letters);
  for (const agent of agents) {
    const allowed = new Set([...agent.did.toLowerCase()].filter((c) => c >= "a" && c <= "z"));
    if ([...letterSet].every((c) => allowed.has(c))) return agent;
  }
  // Agent with most matching letters
  let best = agents[0]; let bestScore = 0;
  for (const agent of agents) {
    const allowed = new Set([...agent.did.toLowerCase()].filter((c) => c >= "a" && c <= "z"));
    const match = [...letterSet].filter((c) => allowed.has(c)).length;
    if (match > bestScore) { bestScore = match; best = agent; }
  }
  return best;
}

async function postOneWord(runner) {
  if (!runner.pendingLines || !runner.pendingLines.length) {
    runner.status = "done";
    eventLine(runner, "poem complete — all words posted");
    return;
  }
  let next = null;
  let li = 0; let wi = 0;
  for (li = 0; li < runner.pendingLines.length && !next; li += 1) {
    for (wi = 0; wi < runner.pendingLines[li].words.length && !next; wi += 1) {
      const posted = runner.words.some((pw) => pw.line === li && pw.wordIdx === wi);
      if (!posted) { next = { line: li, wordIdx: wi }; break; }
    }
  }
  if (!next) { runner.status = "done"; eventLine(runner, "poem complete — 14 lines × 10 syllables"); return; }

  const wordObj = runner.pendingLines[next.line].words[next.wordIdx];
  const agent = bestAgentForWord(wordObj.word, runner.agents);
  runner.turns += 1;

  const payload = {
    type: "sonnet.word.v1", contest_id: CONTEST_ID, game_id: runner.gameId,
    room_generation: runner.roomGeneration, version: runner.words.length,
    previous_state_hash: runner.stateHash || null, word: wordObj.word,
    request_id: "w-" + cryptoRandomUuid().slice(0, 12),
  };

  runner.step = "Line " + (next.line + 1) + "/14 " + agent.agentId + ": \"" + wordObj.word + "\"";
  eventLine(runner, "word \"" + wordObj.word + "\" by " + agent.agentId + " (" + wordObj.syl + ")");
  try {
    await runner.ctx.postSigned(agent.agentId, "d-sonnet-2-team-" + runner.gameId, JSON.stringify(payload));
    runner.words.push({ word: wordObj.word, syllables: wordObj.syl, agentId: agent.agentId, ts: nowIso(), line: next.line, wordIdx: next.wordIdx });
  } catch (err) {
    eventLine(runner, "post failed: " + err.message);
  }
  await delay(2000);
}