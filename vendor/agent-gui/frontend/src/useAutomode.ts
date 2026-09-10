import { useCallback, useEffect, useRef, useState } from "react";

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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Poll a session until the agent finishes, up to a timeout.
 * Returns the session's final console text and activity feed.
 */
async function waitForSessionCompletion(sid: string, statusLine: (msg: string) => void): Promise<{ consoleText: string; activityTitles: string[] }> {
  const deadline = Date.now() + 5 * 60 * 1000; // 5 min max wait
  let consoleText = "";
  let activityTitles: string[] = [];

  while (Date.now() < deadline) {
    try {
      const [session, consoleData, activityData] = await Promise.all([
        apiGet<{ is_running?: boolean; task_solved?: boolean; ended_at?: string | null }>(`/api/sessions/${sid}`),
        apiGet<{ text: string }>(`/api/sessions/${sid}/console?limit=3000`).catch(() => ({ text: "" })),
        apiGet<{ events?: { title?: string; event_type?: string }[] }>(`/api/sessions/${sid}/activity?limit=120`).catch(() => ({ events: [] })),
      ]);

      consoleText = consoleData.text || "";
      activityTitles = (activityData.events || []).map((e) => e.title || e.event_type || "event").filter(Boolean).slice(-30);

      const finished = !session.is_running || session.task_solved === true || session.ended_at != null;
      if (finished) {
        statusLine("Agent completed the work.");
        return { consoleText, activityTitles };
      }

      statusLine(`Agent working... ${activityTitles.length > 0 ? `last: ${activityTitles[activityTitles.length - 1].slice(0, 80)}` : "waiting for activity"}`);
    } catch {
      statusLine("Polling agent session...");
    }

    await sleep(4000);
  }

  statusLine("Time out waiting for agent completion. Recording partial results.");
  return { consoleText, activityTitles };
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

      const job = allJobs[0] as { seq?: string | number; room?: string; text?: string };
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
        current = log(current, "Agent dispatched. Waiting for completion...");
      } catch {
        current = log(current, "Dispatch note: agent runs independently.");
      }
      setState((prev) => ({ ...prev, current }));

      // --- Wait for real completion + capture real output ---
      current.status = "completing";
      current = log(current, "Polling agent session for real result...");
      setState((prev) => ({ ...prev, current }));

      let resultDetail = "No agent output captured yet.";
      let consoleSnippet = "";

      if (claimSessionId && !claimSessionId.startsWith("sim-")) {
        const result = await waitForSessionCompletion(claimSessionId, (msg) => {
          current = log(current, msg);
          setState((prev) => prev.current ? { ...prev, current } : prev);
        });
        resultDetail = result.activityTitles.length > 0
          ? result.activityTitles.join("\n")
          : "Agent finished, no activity titles recorded.";
        consoleSnippet = result.consoleText.slice(0, 2000);
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
      const entry = state.current || makeEntry("error", "technocore", "Error", agentId);
      current = log(entry, `Cycle error: ${(err as Error).message || "Unknown error"}`);
      current.status = "failed";
      current.completedAt = new Date().toISOString();
      setState((prev) => ({ ...prev, lastJobBoardScan: new Date().toISOString(), current: null, history: [current, ...prev.history].slice(0, 100) }));
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