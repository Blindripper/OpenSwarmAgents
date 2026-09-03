import { useCallback, useEffect, useRef, useState } from "react";

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
  const [localJobs, setLocalJobs] = useState<TechnocoreJob[]>([]);
  const [claims, setClaims] = useState<JobClaim[]>([]);
  const [results, setResults] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null);

  // Post-job form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postDescription, setPostDescription] = useState("");
  const [postReward, setPostReward] = useState("");
  const [postRoom, setPostRoom] = useState("kibble");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch("/api/jobs").then((r) => r.json());
      setJobs(data.technocore_jobs || []);
      setLocalJobs(data.local_jobs || []);
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

  const handlePostJob = useCallback(async () => {
    if (!postTitle.trim()) return;
    setPostSubmitting(true);
    setPostError(null);
    setPostSuccess(false);
    try {
      // Upload file if selected
      const file = fileInputRef.current?.files?.[0];
      let uploadedUrl = "";
      if (file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string)?.split(",")[1] || "");
          reader.onerror = () => reject(new Error("File read failed"));
          reader.readAsDataURL(file);
        });
        const uploadRes = await fetch("/api/artifacts/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            kind: "job_attachment",
            mimeType: file.type || "application/octet-stream",
            payload: base64,
            description: "Job attachment",
          }),
        }).then((r) => r.json());
        uploadedUrl = uploadRes?.artifact?.uri || "";
        if (!uploadedUrl) {
          // fallback: just reference the file name
          uploadedUrl = file.name;
        }
      }

      const description = (uploadedUrl ? `Attachment: ${uploadedUrl}\n\n` : "") + postDescription.trim();
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: postTitle.trim(),
          description: description.slice(0, 2000),
          reward: postReward.trim(),
          room: postRoom,
        }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.detail || "Failed to create job");
      setPostSuccess(true);
      setPostTitle("");
      setPostDescription("");
      setPostReward("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setShowPostForm(false);
      await refresh();
    } catch (cause) {
      setPostError(cause instanceof Error ? cause.message : "Post failed");
    } finally {
      setPostSubmitting(false);
    }
  }, [postTitle, postDescription, postReward, postRoom, refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading jobs…</div>;

  const allJobs = [...jobs, ...localJobs];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 11 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 10, cursor: "pointer" }}>Retry</button>
      </div>}

      {/* ── Post a Job Form ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900 }}>Post a Job</div>
          <button type="button" onClick={() => setShowPostForm(!showPostForm)} style={{ height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>
            {showPostForm ? "Cancel" : "New Job"}
          </button>
        </div>
        {showPostForm && (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Task *</div>
              <input
                type="text"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                placeholder="e.g. Analyze this dataset"
                disabled={postSubmitting}
                style={{ width: "100%", boxSizing: "border-box", height: 34, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 12, outline: "none" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Description</div>
              <textarea
                value={postDescription}
                onChange={(e) => setPostDescription(e.target.value)}
                placeholder="Describe what needs to be done…"
                disabled={postSubmitting}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 12, resize: "vertical", outline: "none" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Reward</div>
              <input
                type="text"
                value={postReward}
                onChange={(e) => setPostReward(e.target.value)}
                placeholder="e.g. 50 FLOP"
                disabled={postSubmitting}
                style={{ width: "100%", boxSizing: "border-box", height: 34, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 12, outline: "none" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Upload (optional)</div>
              <input
                type="file"
                ref={fileInputRef}
                disabled={postSubmitting}
                style={{ width: "100%", fontSize: 11, color: "#94a3b8" }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                disabled={postSubmitting || !postTitle.trim()}
                onClick={() => void handlePostJob()}
                style={{ height: 32, padding: "0 14px", borderRadius: 5, border: "1px solid #2563eb", background: postSubmitting || !postTitle.trim() ? "#1a2640" : "#1e3a8a", color: postSubmitting || !postTitle.trim() ? "#6b7280" : "#93c5fd", fontSize: 12, fontWeight: 800, cursor: postSubmitting ? "default" : "pointer" }}
              >
                {postSubmitting ? "Posting…" : "Post Job"}
              </button>
              <select
                value={postRoom}
                onChange={(e) => setPostRoom(e.target.value)}
                disabled={postSubmitting}
                style={{ height: 32, padding: "0 8px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 11, outline: "none" }}
              >
                <option value="kibble">kibble</option>
                <option value="credence">credence</option>
                <option value="flop-market">flop-market</option>
              </select>
            </div>
            {postError && <div style={{ color: "#fca5a5", fontSize: 10 }}>{postError}</div>}
            {postSuccess && <div style={{ color: "#7ee0c2", fontSize: 10 }}>Job posted! ✅</div>}
          </div>
        )}
      </section>

      {/* ── Open Jobs ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900 }}>Open Jobs</div>
          <button type="button" onClick={() => void refresh()} style={{ height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>Refresh</button>
        </div>
        {allJobs.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No open jobs yet. Post one above!</div>
        ) : (
          <div style={{ display: "grid", gap: 5, fontSize: 11 }}>
            {allJobs.map((job, idx) => {
              const jobId = typeof job.seq === "number" ? job.seq + "@" + job.room : job.seq + "@" + job.room;
              const claimed = claims.find((c) => c.job_id === jobId);
              return (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", border: "1px solid #1e2a45", borderRadius: 6 }}>
                  <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ color: "#93c5fd", fontWeight: 800, fontSize: 10 }}>{job.room} · {job.from}</div>
                    <div style={{ color: "#94a3b8", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", maxHeight: 40 }}>{job.text.slice(0, 180)}</div>
                  </div>
                  {!claimed ? (
                    <button type="button" disabled={claimingJobId === jobId} onClick={() => void claimJob(jobId, job.room)} style={{ height: 26, padding: "0 8px", borderRadius: 5, border: "1px solid #2563eb", background: "#1e3a8a", color: "#93c5fd", fontSize: 9, fontWeight: 800, cursor: claimingJobId === jobId ? "default" : "pointer" }}>
                    {claimingJobId === jobId ? "Claiming…" : "Claim"}
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

      {/* ── My Claims & Results ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 12, background: "#0b1525" }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>My Claims</div>
        {claims.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 10 }}>No claims yet. Claim a job from the list above.</div>
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