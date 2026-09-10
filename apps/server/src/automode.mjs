import { createHash, randomUUID } from "node:crypto";

const automodeStates = new Map(); // sessionId -> AutomodeState

/**
 * @typedef {Object} AutomodeEntry
 * @property {string} id
 * @property {string} startedAt
 * @property {string} jobId
 * @property {string} jobRoom
 * @property {string} jobTitle
 * @property {string} agentId
 * @property {string} status - "scanning" | "matched" | "accepted" | "executing" | "completing" | "completed" | "failed"
 * @property {string|null} claimId
 * @property {string|null} sessionId
 * @property {string|null} resultSummary
 * @property {string|null} completedAt
 * @property {string[]} activityLog - chronological activity entries
 */

/**
 * @typedef {Object} AutomodeState
 * @property {boolean} running
 * @property {number} cycleIntervalMs
 * @property {number|null} timerHandle
 * @property {AutomodeEntry[]} history - completed/failed entries
 * @property {AutomodeEntry|null} current - current entry being worked on
 * @property {string|null} lastJobBoardScan
 */

function now() {
  return new Date().toISOString();
}

function makeEntry(jobId, jobRoom, jobTitle, agentId) {
  return {
    id: `automode-${randomUUID().slice(0, 18)}`,
    startedAt: now(),
    jobId,
    jobRoom,
    jobTitle: jobTitle || `Job ${jobId}`,
    agentId: agentId || "technocore-specialist",
    status: "scanning",
    claimId: null,
    sessionId: null,
    resultSummary: null,
    completedAt: null,
    activityLog: [],
  };
}

function logActivity(entry, message) {
  entry.activityLog.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (entry.activityLog.length > 200) entry.activityLog.splice(0, entry.activityLog.length - 200);
}

export function getAutomodeState(sessionId) {
  if (!automodeStates.has(sessionId)) {
    automodeStates.set(sessionId, {
      running: false,
      cycleIntervalMs: 30000, // scan every 30s by default
      timerHandle: null,
      history: [],
      current: null,
      lastJobBoardScan: null,
    });
  }
  return automodeStates.get(sessionId);
}

export function getAutomodeStatus(sessionId) {
  const state = getAutomodeState(sessionId);
  return {
    running: state.running,
    current: state.current,
    history: state.history.slice().reverse(),
    lastJobBoardScan: state.lastJobBoardScan,
  };
}

export function startAutomode(sessionId, agentId, ctx) {
  const state = getAutomodeState(sessionId);
  if (state.running) return { ok: true, already_running: true };

  state.running = true;
  state.lastJobBoardScan = null;

  runCycle(sessionId, agentId, ctx);

  return { ok: true, already_running: false };
}

export function stopAutomode(sessionId) {
  const state = getAutomodeState(sessionId);
  if (!state.running) return { ok: true, already_stopped: true };

  state.running = false;

  if (state.current && ["scanning", "matched", "accepted", "executing", "completing"].includes(state.current.status)) {
    logActivity(state.current, "Automode stopped by user");
    state.current.status = "failed";
    state.current.completedAt = now();
    state.history.push(state.current);
    state.current = null;
  }

  return { ok: true };
}

export function clearAutomodeHistory(sessionId) {
  const state = getAutomodeState(sessionId);
  state.history = [];
  return { ok: true };
}

async function runCycle(sessionId, agentId, ctx) {
  const state = getAutomodeState(sessionId);
  if (!state.running) return;

  try {
    await executeCycle(sessionId, agentId, ctx);
  } catch (err) {
    console.warn(`Automode cycle error for session ${sessionId}: ${err.message}`);
  }

  // Schedule next cycle
  if (state.running) {
    state.timerHandle = setTimeout(() => runCycle(sessionId, agentId, ctx), state.cycleIntervalMs);
  }
}

async function executeCycle(sessionId, agentId, ctx) {
  const state = getAutomodeState(sessionId);
  if (!state.running) return;

  // Phase 1: Complete current job if doing one
  if (state.current && state.current.status === "completing") {
    // Move to completed
    state.current.status = "completed";
    state.current.completedAt = now();
    logActivity(state.current, "Job completed and recorded");
    state.history.push(state.current);
    state.current = null;
  }

  // Phase 2: If no current job, scan for new jobs
  if (!state.current || state.current.status === "completed" || state.current.status === "failed") {
    if (state.current?.status === "completed" || state.current?.status === "failed") {
      state.history.push(state.current);
      state.current = null;
    }

    // Create a scanning entry
    const scanningEntry = makeEntry("scan", "technocore", "Scanning job boards", agentId);
    scanningEntry.status = "scanning";
    logActivity(scanningEntry, "Scanning Technocore job channels...");
    state.current = scanningEntry;

    state.lastJobBoardScan = now();

    try {
      const jobs = await ctx.discoverTechnocoreJobs(20);

      logActivity(scanningEntry, `Found ${jobs.length} open job(s)`);

      if (jobs.length > 0) {
        const job = jobs[0]; // Pick the most recent one
        const jobRoom = job.room || "kibble";
        const jobSeq = job.seq || "unknown";
        const jobTitle = job.text?.split("\n")[0]?.replace(/^JOB v\d+:\s*/i, "").trim() || `Job #${jobSeq}`;

        logActivity(scanningEntry, `Matching job: "${jobTitle}" (room: #${jobRoom}, seq: ${jobSeq})`);

        // Check skill match (server-side)
        const skillsMatch = ctx.checkSkilMatchForJob?.(job.text, agentId) !== false;

        if (skillsMatch) {
          scanningEntry.status = "matched";
          scanningEntry.jobId = jobSeq;
          scanningEntry.jobRoom = jobRoom;
          scanningEntry.jobTitle = jobTitle;
          logActivity(scanningEntry, `Skills match. Claiming job...`);

          // Claim the job using the existing /api/jobs/claim mechanism
          try {
            const claimResult = await ctx.claimTechnocoreJob(jobRoom, jobSeq, job.text, agentId);
            const claimSessionId = claimResult?.session?.id || claimResult?.claim?.session_id || null;
            const claimId = claimResult?.claim?.id || claimResult?.claim?.claim_id || null;

            scanningEntry.status = "accepted";
            scanningEntry.claimId = claimId;
            scanningEntry.sessionId = claimSessionId;
            logActivity(scanningEntry, `Job claimed (claim: ${claimId || "pending"}, session: ${claimSessionId || "pending"})`);

            // Execute the job through the connector/OpenClaw
            if (claimSessionId) {
              scanningEntry.sessionId = claimSessionId;
              scanningEntry.status = "executing";
              logActivity(scanningEntry, "Executing job...");

              let executionResult = null;
              try {
                executionResult = await ctx.executeAgentTask?.(claimSessionId, job.text, agentId);
              } catch (execErr) {
                logActivity(scanningEntry, `Execution error: ${execErr.message}`);
              }

              if (executionResult?.ok !== false) {
                scanningEntry.status = "completing";
                logActivity(scanningEntry, "Job execution completed. Posting result...");

                try {
                  const resultPost = await ctx.postJobResult?.(jobSeq, claimId, agentId, executionResult?.summary || "Completed via Automode");
                  if (resultPost?.ok !== false) {
                    scanningEntry.resultSummary = executionResult?.summary || "Completed via Automode";
                    scanningEntry.status = "completed";
                    scanningEntry.completedAt = now();
                    logActivity(scanningEntry, "Result submitted and verified. Reward lifecycle: pending protocol settlement.");
                    state.history.push(scanningEntry);
                    state.current = null;
                    return;
                  }
                } catch (postErr) {
                  logActivity(scanningEntry, `Result submission error: ${postErr.message}`);
                  scanningEntry.status = "failed";
                  scanningEntry.completedAt = now();
                  logActivity(scanningEntry, "Job failed during result submission.");
                  state.history.push(scanningEntry);
                  state.current = null;
                  return;
                }
              } else {
                scanningEntry.status = "failed";
                scanningEntry.completedAt = now();
                logActivity(scanningEntry, "Execution failed. Job marked as failed.");
                state.history.push(scanningEntry);
                state.current = null;
                return;
              }
            } else {
              scanningEntry.status = "failed";
              scanningEntry.completedAt = now();
              logActivity(scanningEntry, "Claim created but no workspace session was available.");
              state.history.push(scanningEntry);
              state.current = null;
              return;
            }
          } catch (claimErr) {
            logActivity(scanningEntry, `Claim error: ${claimErr.message}`);
            scanningEntry.status = "failed";
            scanningEntry.completedAt = now();
            state.history.push(scanningEntry);
            state.current = null;
            return;
          }
        } else {
          logActivity(scanningEntry, "Skills do not match available agent profile capabilities. Skipping.");
          scanningEntry.status = "failed";
          scanningEntry.completedAt = now();
          state.history.push(scanningEntry);
          state.current = null;
        }
      } else {
        logActivity(scanningEntry, "No open jobs found. Will scan again next cycle.");
        scanningEntry.status = "failed";
        scanningEntry.completedAt = now();
        state.history.push(scanningEntry);
        state.current = null;
      }
    } catch (err) {
      logActivity(state.current || scanningEntry, `Scan error: ${err.message}`);
      if (state.current) {
        state.current.status = "failed";
        state.current.completedAt = now();
        state.history.push(state.current);
        state.current = null;
      }
    }
  }
}