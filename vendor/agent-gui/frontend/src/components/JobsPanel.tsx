import { useCallback, useEffect, useState } from "react";

interface TechnocoreJob {
  room: string;
  seq: number;
  from: string;
  text: string;
  observed_at: string;
}

interface JobClaim {
  id: string;
  job_id: string;
  room: string;
  claimed_by: string;
  claimed_at: string;
  status: string;
  updated_at: string;
}

interface JobResult {
  id: string;
  job_id: string;
  claim_id: string;
  agent_id: string;
  summary: string;
  output_hash: string;
  submitted_at: string;
  verified: boolean;
}

export function JobsPanel() {
  const [jobs, setJobs] = useState<TechnocoreJob[]>([]);
  const [claims, setClaims] = useState<JobClaim[]>([]);
  const [results, setResults] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch("/api/jobs").then((r) => r.json());
      setJobs(data.technocore_jobs || []);
      setClaims(data.local_claims || []);
      setResults(data.local_results || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Job load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const claimJob = useCallback(async (jobId: string, room: string) => {
    setClaimingJobId(jobId);
    setError(null);
    try {
      await fetch("/api/jobs/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job_id: jobId, room }) }).then((r) => r.json());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim failed");
    } finally {
      setClaimingJobId(null);
    }
  }, [refresh]);

  const submitResult = useCallback(async (jobId: string, claimId: string) => {
    setSubmittingJobId(jobId);
    setError(null);
    try {
      await fetch("/api/jobs/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job_id: jobId, claim_id: claimId, summary: "Completed via local agent." }) }).then((r) => r.json());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submit failed");
    } finally {
      setSubmittingJobId(null);
    }
  }, [refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading jobs…</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 11 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 10, cursor: "pointer" }}>Retry</button>
      </div>}

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900 }}>Technocore Jobs</div>
          <button type="button" onClick={() => void refresh()} style={{ height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>Refresh</button>
        </div>
        {jobs.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No Technocore job announcements found. Jobs use rooms: kibble, flop-market, credence.</div>
        ) : (
          <div style={{ display: "grid", gap: 5, fontSize: 11 }}>
            {jobs.map((job, idx) => {
              const claimed = claims.find((c) => c.job_id === job.seq + "@" + job.room);
              return (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
                  <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ color: "#93c5fd", fontWeight: 800, fontSize: 10 }}>{job.room} seq {job.seq}</div>
                    <div style={{ color: "#94a3b8", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", maxHeight: 40 }}>{job.text.slice(0, 180)}</div>
                    <div style={{ color: "#64748b", fontSize: 8 }}>{job.from}</div>
                  </div>
                  {!claimed ? (
                    <button type="button" disabled={claimingJobId === job.seq + "@" + job.room} onClick={() => void claimJob(job.seq + "@" + job.room, job.room)} style={{ height: 26, padding: "0 8px", borderRadius: 5, border: "1px solid #2563eb", background: "#1e3a8a", color: "#93c5fd", fontSize: 9, fontWeight: 800, cursor: claimingJobId === job.seq + "@" + job.room ? "default" : "pointer" }}>
                    {claimingJobId === job.seq + "@" + job.room ? "Claiming…" : "Claim"}
                  </button>
                  ) : (
                    <span style={{ padding: "2px 6px", borderRadius: 999, background: "#1a3a2a", color: "#7ee0c2", fontSize: 8, fontWeight: 800 }}>{claimed.status}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Local Claims & Results</div>
        {claims.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No local job claims yet. Claim a job from the list above.</div>
        ) : (
          <div style={{ display: "grid", gap: 5, fontSize: 11 }}>
            {claims.map((c) => {
              const hasResult = results.find((r) => r.job_id === c.job_id);
              return (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
                  <div><strong style={{ fontSize: 10 }}>{c.job_id}</strong> <span style={{ color: "#94a3b8", fontSize: 9 }}>{c.room}</span></div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ padding: "2px 6px", borderRadius: 999, background: c.status === "completed" ? "#1a3a2a" : "#1e1b2a", color: c.status === "completed" ? "#7ee0c2" : "#94a3b8", fontSize: 8, fontWeight: 800 }}>{c.status}</span>
                    {!hasResult && c.status === "accepted" && (
                      <button type="button" disabled={submittingJobId === c.job_id} onClick={() => void submitResult(c.job_id, c.id)} style={{ height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontSize: 9, cursor: submittingJobId === c.job_id ? "default" : "pointer" }}>
                        {submittingJobId === c.job_id ? "Submitting…" : "Submit Result"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}