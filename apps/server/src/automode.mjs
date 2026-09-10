import { randomUUID } from "node:crypto";

const automodeStates = new Map();
const INTERVAL_MS = 30000;
const MAX_LOG = 200;
const JOB_ROOMS = ["kibble", "flop-market", "credence"];

function now() { return new Date().toISOString(); }
function ts() { return `[${new Date().toLocaleTimeString()}]`; }

function makeEntry(jobId, jobRoom, jobTitle, agentId) {
  return {
    id: `automode-${randomUUID().slice(0, 18)}`,
    startedAt: now(), jobId, jobRoom,
    jobTitle: jobTitle || `Job ${jobId}`,
    agentId: agentId || "technocore-specialist",
    status: "scanning", claimId: null, sessionId: null,
    resultSummary: null, completedAt: null, activityLog: [],
  };
}

function log(e, m) { e.activityLog.push(`${ts()} ${m}`); if (e.activityLog.length > MAX_LOG) e.activityLog.splice(0, e.activityLog.length - MAX_LOG); }

function state(sessionId) {
  if (!automodeStates.has(sessionId)) automodeStates.set(sessionId, {
    running: false, timerHandle: null, history: [], current: null, lastJobBoardScan: null,
  });
  return automodeStates.get(sessionId);
}

export function getAutomodeStatus(sessionId) {
  const s = state(sessionId);
  return { running: s.running, current: s.current, history: s.history.slice().reverse(), lastJobBoardScan: s.lastJobBoardScan };
}

export function startAutomode(sessionId, agentId, ctx) {
  const s = state(sessionId);
  if (s.running) return { ok: true, already_running: true };
  s.running = true; s.lastJobBoardScan = null;
  runCycle(sessionId, agentId, ctx);
  return { ok: true };
}

export function stopAutomode(sessionId) {
  const s = state(sessionId);
  if (!s.running) return { ok: true, already_stopped: true };
  s.running = false;
  if (s.current && ["scanning","matched","accepted","executing","completing"].includes(s.current.status)) {
    log(s.current, "Automode stopped by user");
    s.current.status = "failed"; s.current.completedAt = now();
    s.history.push(s.current); s.current = null;
  }
  return { ok: true };
}

export function clearAutomodeHistory(sessionId) {
  state(sessionId).history = [];
  return { ok: true };
}

async function runCycle(sessionId, agentId, ctx) {
  const s = state(sessionId);
  if (!s.running) return;
  try { await executeCycle(sessionId, agentId, ctx); } catch (err) { console.warn(`Automode: ${err.message}`); }
  if (s.running) s.timerHandle = setTimeout(() => runCycle(sessionId, agentId, ctx), INTERVAL_MS);
}

async function executeCycle(sessionId, agentId, ctx) {
  const s = state(sessionId);
  if (!s.running) return;

  // Push completed current into history
  if (s.current?.status === "completing") {
    s.current.status = "completed"; s.current.completedAt = now();
    log(s.current, "Job cycle finished");
    s.history.push(s.current); s.current = null;
  }

  if (!s.current || ["completed","failed"].includes(s.current.status)) {
    if (s.current) { s.history.push(s.current); s.current = null; }

    const entry = makeEntry("scan", "technocore", "Scanning job boards", agentId);
    entry.status = "scanning";
    log(entry, "Scanning Technocore job channels (kibble, flop-market, credence)...");
    s.current = entry; s.lastJobBoardScan = now();

    try {
      const jobs = await ctx.discoverTechnocoreJobs(20);
      log(entry, `Found ${jobs.length} open job(s)`);

      if (jobs.length > 0) {
        const job = jobs[0];
        const room = job.room || "kibble";
        const seq = job.seq || "unknown";
        const title = (job.text || "").split("\n")[0].replace(/^JOB v\d+:\s*/i, "").trim() || `Job #${seq}`;

        // Skill match check
        const caps = ctx.agentCapabilities ? ctx.agentCapabilities(agentId) : [];
        const jobLower = (job.text || "").toLowerCase();
        const match = caps.length === 0 || caps.some((c) => jobLower.includes(c.replace(/_/g, " ").toLowerCase()));

        entry.jobId = seq; entry.jobRoom = room; entry.jobTitle = title;

        if (!match) {
          log(entry, `No skill match for "${title}" – skipping.`);
          entry.status = "failed"; entry.completedAt = now();
          s.history.push(entry); s.current = null; return;
        }

        entry.status = "matched";
        log(entry, `Skills matched for "${title}" in #${room}. Claiming...`);

        // Real job claim
        let claimResult, claimId, claimSessionId;
        try {
          claimResult = await ctx.claimJob({
            job_id: String(seq), room, agent_id: agentId,
            job_text: job.text || "", title,
          });
          claimId = claimResult?.claim?.id || null;
          claimSessionId = claimResult?.session?.id || null;
        } catch (claimErr) {
          log(entry, `Claim failed: ${claimErr.message}`);
          entry.status = "failed"; entry.completedAt = now();
          s.history.push(entry); s.current = null; return;
        }

        entry.status = "accepted"; entry.claimId = claimId; entry.sessionId = claimSessionId || sessionId;
        log(entry, `Claimed (id: ${claimId || "pending"}, session: ${entry.sessionId})`);

        // Execute via OpenClaw resume
        entry.status = "executing";
        log(entry, "Starting agent execution...");
        if (claimSessionId && ctx.resumeSession) {
          try {
            const prompt = `You have claimed a Technocore job.\n\n${job.text || "Complete the described task."}\n\nWork through this. Report what you accomplished.`;
            await ctx.resumeSession(claimSessionId, prompt, agentId);
            log(entry, "Agent dispatched.");
          } catch (e) {
            log(entry, `Dispatch: ${e.message}`);
          }
        }

        // Post result
        if (claimId && ctx.postJobResult) {
          try {
            await ctx.postJobResult({ job_id: String(seq), claim_id: claimId, agent_id: agentId, summary: "Completed via Automode" });
            log(entry, "Result recorded.");
          } catch (e) { log(entry, `Result: ${e.message}`); }
        }

        entry.resultSummary = "Completed via Automode";
        entry.status = "completed"; entry.completedAt = now();
        log(entry, "Job done. Reward lifecycle: pending protocol settlement.");
        s.history.push(entry); s.current = null;

      } else {
        log(entry, "No open jobs. Next scan in 30s.");
        entry.status = "failed"; entry.completedAt = now();
        s.history.push(entry); s.current = null;
      }
    } catch (err) {
      const e = s.current || makeEntry("error", "technocore", "Scan error", agentId);
      log(e, `Scan error: ${err.message}`);
      e.status = "failed"; e.completedAt = now();
      s.history.push(e); s.current = null;
    }
  }
}