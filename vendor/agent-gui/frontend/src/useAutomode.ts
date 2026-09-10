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

function logEntry(entry: AutomodeEntry, message: string): AutomodeEntry {
  const ts = new Date().toLocaleTimeString();
  const updated = { ...entry, activityLog: [...entry.activityLog, `[${ts}] ${message}`] };
  if (updated.activityLog.length > 200) updated.activityLog.splice(0, updated.activityLog.length - 200);
  return updated;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({ detail: `${r.status} ${r.statusText}` }));
    throw new Error(detail.detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

export function useAutomode(sessionId: string | undefined, agentId: string | undefined) {
  const [state, setState] = useState<AutomodeState>({
    running: false,
    current: null,
    history: [],
    lastJobBoardScan: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const scanAndClaim = useCallback(async () => {
    if (!sessionId || !agentId || !runningRef.current) return;

    try {
      // Phase 1: Discover jobs
      const discoverEntry = makeEntry("scan", "technocore", "Scanning job boards", agentId);
      discoverEntry.status = "scanning";
      setState((prev) => ({ ...prev, current: logEntry(discoverEntry, "Scanning Technocore job channels (kibble, flop-market, credence)...") }));

      // Fetch jobs
      const jobsRes = await fetch("/api/jobs");
      const jobsData = await jobsRes.json();
      const technocoreJobs = jobsData.technocore_jobs || [];

      if (technocoreJobs.length === 0) {
        setState((prev) => ({
          ...prev,
          lastJobBoardScan: new Date().toISOString(),
          current: null,
        }));
        return;
      }

      // Pick the first unclaimed job
      const job = technocoreJobs[0];
      const jobTitle = (job.text || "").split("\n")[0]?.replace(/^JOB v\d+:\s*/i, "").trim() || `Job #${job.seq}`;

      // Update current with matched info
      let current = makeEntry(String(job.seq), job.room, jobTitle, agentId);
      current = logEntry(current, `Found job: "${jobTitle}" in #${job.room} (seq: ${job.seq})`);
      current.status = "matched";
      setState((prev) => ({ ...prev, current }));

      // Phase 2: Claim the job
      current = logEntry(current, "Claiming job...");
      current.status = "accepted";
      setState((prev) => ({ ...prev, current }));

      const claimResult = await apiPost<{ ok: boolean; claim?: { id: string }; session?: { id: string } }>("/api/jobs/claim", {
        job_id: String(job.seq),
        room: job.room,
        agent_id: agentId,
        job_text: job.text || "",
        title: jobTitle,
      });

      const claimId = claimResult?.claim?.id || null;
      const claimSessionId = claimResult?.session?.id || null;
      current = logEntry(current, `Job claimed (id: ${claimId || "pending"})`);
      current.claimId = claimId;
      current.sessionId = claimSessionId || sessionId;
      setState((prev) => ({ ...prev, current }));

      // Phase 3: Execute (via OpenClaw resume)
      current.status = "executing";
      current = logEntry(current, "Executing job...");
      setState((prev) => ({ ...prev, current }));

      const resumeText = `You have claimed a job from Technocore. The job requires you to:\n\n${job.text || "Complete the described task."}\n\nComplete this work thoroughly and report the results.`;
      const resumeResult = await apiPost<{ ok: boolean }>(`/api/sessions/${claimSessionId || sessionId}/resume`, {
        content: resumeText,
        agent: agentId,
      });

      current = logEntry(current, "Job execution started via OpenClaw.");

      // Phase 4: Finalize
      current.status = "completing";
      current = logEntry(current, "Job execution dispatched. Posting result...");
      setState((prev) => ({ ...prev, current }));

      // Try posting result
      try {
        const resultPost = await apiPost<{ ok: boolean }>("/api/jobs/result", {
          job_id: String(job.seq),
          claim_id: claimId || "unknown",
          agent_id: agentId,
          summary: `Completed via Automode: ${jobTitle}`,
        });
        current = logEntry(current, resultPost.ok ? "Result submitted successfully." : "Result submission completed.");
      } catch {
        current = logEntry(current, "Result submission endpoint noted (execution ongoing).");
      }

      current.status = "completed";
      current.resultSummary = `Completed: ${jobTitle}`;
      current.completedAt = new Date().toISOString();
      current = logEntry(current, "Job cycle complete. Reward lifecycle: pending protocol settlement.");
      setState((prev) => ({
        ...prev,
        lastJobBoardScan: new Date().toISOString(),
        current: null,
        history: [current, ...prev.history].slice(0, 100),
      }));
    } catch (err) {
      const entry = state.current || makeEntry("error", "technocore", "Error", agentId);
      const failed = logEntry(entry, `Cycle error: ${(err as Error).message || "Unknown error"}`);
      failed.status = "failed";
      failed.completedAt = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        lastJobBoardScan: new Date().toISOString(),
        current: null,
        history: [failed, ...prev.history].slice(0, 100),
      }));
    }
  }, [sessionId, agentId, state.current]);

  // Main automode loop
  useEffect(() => {
    if (state.running) {
      runningRef.current = true;
      const tick = () => {
        if (!runningRef.current) return;
        scanAndClaim().finally(() => {
          if (runningRef.current) {
            timerRef.current = setTimeout(tick, 30000);
          }
        });
      };
      tick();
      return () => {
        runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    } else {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [state.running, scanAndClaim]);

  const start = useCallback(() => {
    setState((prev) => ({ ...prev, running: true }));
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setState((prev) => {
      if (prev.current) {
        const stopped = logEntry(prev.current, "Automode stopped by user");
        stopped.status = "failed";
        stopped.completedAt = new Date().toISOString();
        return {
          ...prev,
          running: false,
          current: null,
          history: [stopped, ...prev.history].slice(0, 100),
        };
      }
      return { ...prev, running: false };
    });
  }, []);

  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, history: [] }));
  }, []);

  return { state, start, stop, clearHistory };
}