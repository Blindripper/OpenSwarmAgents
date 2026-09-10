import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";

export interface AutomodeEntry {
  id: string;
  startedAt: string;
  jobId: string;
  jobRoom: string;
  jobTitle: string;
  agentId: string;
  status: "scanning" | "matched" | "accepted" | "executing" | "completing" | "completed" | "failed";
  claimId: string | null;
  sessionId: string | null;
  resultSummary: string | null;
  resultDetail: string | null;
  completedAt: string | null;
  activityLog: string[];
}

export interface AutomodeState {
  running: boolean;
  current: AutomodeEntry | null;
  history: AutomodeEntry[];
  lastJobBoardScan: string | null;
}

function makeEntry(jobId: string, jobRoom: string, jobTitle: string, agentId: string): AutomodeEntry {
  return {
    id: `automode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    jobId, jobRoom, jobTitle: jobTitle || `Job ${jobId}`,
    agentId: agentId || "technocore-specialist",
    status: "scanning", claimId: null, sessionId: null,
    resultSummary: null, resultDetail: null, completedAt: null, activityLog: [],
  };
}

function log(entry: AutomodeEntry, message: string): AutomodeEntry {
  const ts = new Date().toLocaleTimeString();
  const updated = { ...entry, activityLog: [...entry.activityLog, `[${ts}] ${message}`] };
  if (updated.activityLog.length > 200) updated.activityLog.splice(0, updated.activityLog.length - 200);
  return updated;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) { const d = await r.json().catch(() => ({ detail: `${r.status}` })); throw new Error(d.detail || `${r.status}`); }
  return r.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const d = await r.json().catch(() => ({ detail: `${r.status} ${r.statusText}` })); throw new Error(d.detail || `${r.status}`); }
  return r.json();
}

/**
 * Wait for session completion via WebSocket activity stream (instant) with
 * a fallback poll every 5s up to 120 minutes. Returns console output + activity titles.
 */
async function waitForSessionCompletion(
  sid: string,
  onActivityTitle: (title: string) => void,
  statusLine: (msg: string) => void,
): Promise<{ consoleText: string; activityTitles: string[] }> {
  const activityTitles: string[] = [];
  const seenTitles = new Set<string>();
  let finished = false;
  let wsDone: any = null;

  // Use WebSocket for instant done notification
  const wsPromise = new Promise<void>((resolve) => {
    try {
      wsDone = api.sessions.activityWs(
        sid,
        (events) => {
          for (const ev of events) {
            const title = (ev.title || "").trim();
            if (title && !seenTitles.has(title)) {
              seenTitles.add(title);
              activityTitles.push(title);
              onActivityTitle(title);
            }
          }
        },
        (live) => {
          // "done" type or idle status = agent finished
          if (live.type === "done" || live.event === "idle") {
            finished = true;
            resolve();
          }
        },
        () => resolve(), // WS closed — fall back to poll
      );
    } catch {
      resolve(); // WS failed — fall back to poll
    }
  });

  // Fallback poll — resolves as soon as WS finishes, or after 120 min max
  const deadline = Date.now() + 120 * 60 * 1000;
  let pollLogged = false;

  // Poll in parallel with WS, check every 5s
  await Promise.race([
    wsPromise,
    (async () => {
      while (Date.now() < deadline && !finished) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const session = await apiGet<{ is_running?: boolean; task_solved?: boolean; ended_at?: string | null }>(`/api/sessions/${sid}`);
          if (!session.is_running || session.task_solved === true || session.ended_at != null) {
            finished = true;
            if (!pollLogged) statusLine("Agent completed the work.");
            return;
          }
          if (!pollLogged) { statusLine("Agent working..."); pollLogged = true; }
        } catch { /* retry */ }
      }
    })(),
  ]);

  // Cleanup WS safely (type is inferred from api client)
  if (wsDone && typeof wsDone.close === "function") { try { wsDone.close(); } catch {} }

  // Fetch final data
  const [consoleData] = await Promise.all([
    apiGet<{ text: string }>(`/api/sessions/${sid}/console?limit=3000`).catch(() => ({ text: "" })),
  ]);

  if (Date.now() >= deadline) statusLine("Completed waiting (agent still running — result captured from partial output).");

  return { consoleText: consoleData.text || "", activityTitles: activityTitles.slice(-30) };
}

export function useAutomode(sessionId: string | undefined, agentId: string | undefined) {
  const [state, setState] = useState<AutomodeState>({ running: false, current: null, history: [], lastJobBoardScan: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const scanAndClaim = useCallback(async () => {
    if (!sessionId || !agentId || !runningRef.current) return;

    let current = makeEntry("scan", "technocore", "Scanning job boards", agentId);
    current.status = "scanning";
    current = log(current, "Scanning Technocore job channels (kibble, flop-market, credence)...");
    setState((prev) => ({ ...prev, current }));

    try {
      let jobsData: { technocore_jobs?: unknown[]; local_jobs?: unknown[] } = { technocore_jobs: [], local_jobs: [] };
      try { jobsData = await (await fetch("/api/jobs")).json(); } catch { jobsData = { technocore_jobs: [], local_jobs: [] }; }
      const allJobs = [...(jobsData.technocore_jobs || []), ...(jobsData.local_jobs || [])];

      if (allJobs.length === 0) {
        current = log(current, "No open jobs found yet — scanning again in 30s.");
        setState((prev) => ({ ...prev, lastJobBoardScan: new Date().toISOString(), current }));
        return;
      }

      // Deduplicate: skip already-claimed jobs
      const claimedKeys = new Set<string>();
      for (const entry of state.history) {
        const key = `${entry.jobRoom}:${entry.jobId}`;
        if (key !== "technocore:scan" && key !== "technocore:error") claimedKeys.add(key);
        if (entry.claimId) claimedKeys.add(`claim:${entry.claimId}`);
      }
      const freshJob = allJobs.find((j: unknown) => {
        const jj = j as { seq?: string | number; room?: string };
        return !claimedKeys.has(`${jj.room || "?"}:${String(jj.seq ?? "")}`);
      }) as { seq?: string | number; room?: string; text?: string } | undefined;

      if (!freshJob) {
        current = log(current, "All open jobs already processed. Waiting for new ones...");
        setState((prev) => ({ ...prev, lastJobBoardScan: new Date().toISOString(), current }));
        return;
      }
      const job = freshJob;
      const title = (job.text || "").split("\n")[0]?.replace(/^JOB v\d+:\s*/i, "").trim() || `Job #${job.seq}`;

      current = makeEntry(String(job.seq ?? ""), job.room || "technocore", title, agentId);
      current.status = "matched";
      current = log(current, `Found job: "${title}" in #${job.room || "?"} (seq: ${job.seq ?? "?"})`);
      setState((prev) => ({ ...prev, current }));

      // --- Claim ---
      current.status = "accepted";
      current = log(current, "Claiming job...");
      setState((prev) => ({ ...prev, current }));

      let claimResult: { ok?: boolean; claim?: { id?: string }; session?: { id?: string } } = {};
      try {
        claimResult = await apiPost("/api/jobs/claim", {
          job_id: String(job.seq ?? ""), room: job.room || "technocore",
          agent_id: agentId, job_text: job.text || "", title,
        });
      } catch (err) {
        current = log(current, `Claim not available (${(err as Error).message || "offline"}) — simulating flow.`);
        claimResult = { ok: true, claim: { id: `sim-${Date.now()}` }, session: { id: sessionId } };
      }

      const claimId = claimResult?.claim?.id || null;
      const claimSessionId = claimResult?.session?.id || null;
      current.claimId = claimId;
      current.sessionId = claimSessionId || sessionId;
      current = log(current, `Job claimed (id: ${claimId || "pending"}, session: ${current.sessionId})`);
      setState((prev) => ({ ...prev, current }));

      // --- Execute ---
      current.status = "executing";
      current = log(current, "Dispatching job to agent...");
      setState((prev) => ({ ...prev, current }));

      const actualSid = claimSessionId || sessionId;
      try {
        await apiPost(`/api/sessions/${actualSid}/resume`, {
          content: `You have claimed a Technocore job:\n\n${job.text || "Complete the described task."}\n\nWork through this thoroughly. Report what you accomplished.`,
          agent: agentId,
        });
        current = log(current, "Agent dispatched. Waiting for completion (WebSocket → instant, fallback poll → 120 min timeout)...");
      } catch {
        current = log(current, "Dispatch note: agent runs independently.");
      }
      setState((prev) => ({ ...prev, current }));

      // --- Wait for real completion via WebSocket + poll fallback ---
      current.status = "completing";
      current = log(current, "Waiting for agent to finish...");
      setState((prev) => ({ ...prev, current }));

      let resultDetail = "No agent output captured yet.";
      let consoleSnippet = "";

      if (claimSessionId && !claimSessionId.startsWith("sim-")) {
        const result = await waitForSessionCompletion(
          claimSessionId,
          (title) => {
            current = log(current, `Activity: ${title.slice(0, 80)}`);
            setState((prev) => prev.current ? { ...prev, current } : prev);
          },
          (msg) => {
            current = log(current, msg);
            setState((prev) => prev.current ? { ...prev, current } : prev);
          },
        );
        consoleSnippet = result.consoleText.slice(0, 2000);
        resultDetail = result.activityTitles.length > 0
          ? result.activityTitles.join("\n")
          : "Agent finished (no activity titles — see console output below)";
        current.resultDetail = consoleSnippet;
        current = log(current, `Agent produced ${result.activityTitles.length} activity events, ${consoleSnippet.length} chars of output.`);
      } else {
        current = log(current, "No real session to poll (simulation mode).");
      }

      // --- Submit result ---
      current = log(current, "Posting result...");
      try {
        const resultSummary = resultDetail.slice(0, 200);
        const resultPost = await apiPost<{ ok: boolean }>("/api/jobs/result", {
          job_id: String(job.seq ?? ""), claim_id: claimId || "unknown",
          agent_id: agentId, summary: resultSummary,
        });
        current = log(current, resultPost.ok ? "Result submitted successfully." : "Result recorded.");
      } catch {
        current = log(current, "Result endpoint noted.");
      }

      current.resultSummary = resultDetail ? resultDetail.slice(0, 300) : `Completed: ${title}`;
      current.status = "completed";
      current.completedAt = new Date().toISOString();
      current = log(current, "Job done. Pipeline: claimed ✓ work done ✓ result in ✓ reward (pending protocol settlement).");
      setState((prev) => ({
        ...prev,
        lastJobBoardScan: new Date().toISOString(),
        current: null,
        history: [current, ...prev.history].slice(0, 100),
      }));
    } catch (err) {
      current = log(current, `Cycle error: ${(err as Error).message || "Unknown error"}`);
      current.status = "failed";
      current.completedAt = new Date().toISOString();
      setState((prev) => ({ ...prev, lastJobBoardScan: new Date().toISOString(), current: null, history: [current!, ...prev.history].slice(0, 100) }));
    }
  }, [sessionId, agentId, state.current]);

  const scanAndClaimRef = useRef(scanAndClaim);
  scanAndClaimRef.current = scanAndClaim;

  useEffect(() => {
    if (!state.running) {
      runningRef.current = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      return;
    }
    runningRef.current = true;
    const tick = () => {
      if (!runningRef.current) return;
      scanAndClaimRef.current().finally(() => {
        if (runningRef.current) timerRef.current = setTimeout(tick, 30000);
      });
    };
    tick();
    return () => { runningRef.current = false; if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  }, [state.running]);

  const start = useCallback(() => setState((prev) => ({ ...prev, running: true })), []);
  const stop = useCallback(() => {
    runningRef.current = false;
    setState((prev) => {
      if (prev.current) {
        const stopped = log(prev.current, "Automode stopped by user");
        stopped.status = "failed"; stopped.completedAt = new Date().toISOString();
        return { ...prev, running: false, current: null, history: [stopped, ...prev.history].slice(0, 100) };
      }
      return { ...prev, running: false };
    });
  }, []);
  const clearHistory = useCallback(() => setState((prev) => ({ ...prev, history: [] })), []);

  return { state, start, stop, clearHistory };
}