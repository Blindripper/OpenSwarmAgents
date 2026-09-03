import { useCallback, useEffect, useRef, useState } from "react";

interface AgentProfile {
  id: string;
  name: string;
  tagline?: string;
  model?: string;
  did?: string;
  color?: string;
  available?: boolean;
}

interface JobClaim {
  id: string;
  job_id: string;
  room: string;
  claimed_by: string;
  claimed_at: string;
  status: string;
  updated_at: string;
  session_id?: string | null;
  task_id?: string | null;
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
  const [localJobs, setLocalJobs] = useState<{ room: string; seq: string; from: string; text: string; observed_at: string }[]>([]);
  const [claims, setClaims] = useState<JobClaim[]>([]);
  const [results, setResults] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null);

  // Agent selector state
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [showAgentSelector, setShowAgentSelector] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("coder");

  // Post-job form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postDescription, setPostDescription] = useState("");
  const [postReward, setPostReward] = useState("");
  const [postRoom, setPostRoom] = useState("osa-network");
  const [postToTechnocore, setPostToTechnocore] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch("/api/jobs").then((r) => r.json());
      setLocalJobs(data.local_jobs || []);
      setClaims(data.local_claims || []);
      setResults(data.local_results || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Job load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load agents on mount
  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then((data) => {
      setAgents((data.agents || []).filter((a: AgentProfile) => a.available !== false));
    }).catch(() => {});
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const claimJob = useCallback(async (jobId: string, agentId: string, title: string) => {
    setClaimingJobId(jobId);
    setError(null);
    setShowAgentSelector(null);
    try {
      const data = await fetch("/api/jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: jobId, room: "local", agent_id: agentId, title })
      }).then((r) => r.json());
      if (data.session) {
        window.dispatchEvent(new CustomEvent("osa:claim-job", { detail: { sessionId: data.session.id, claim: data.claim } }));
      }
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
        uploadedUrl = uploadRes?.artifact?.uri || file.name;
      }

      const description = (uploadedUrl ? `Attachment: ${uploadedUrl}\n\n` : "") + postDescription.trim();
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: postTitle.trim(),
          description: description.slice(0, 2000),
          reward: postReward.trim(),
          room: postToTechnocore ? postRoom : "local",
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
  }, [postTitle, postDescription, postReward, postRoom, postToTechnocore, refresh]);

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading jobs…</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 12 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 24, padding: "0 8px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}>Retry</button>
      </div>}

      {/* ── Post a Job Form ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 14, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Post a Job</div>
          <button type="button" onClick={() => setShowPostForm(!showPostForm)} style={{ height: 28, padding: "0 12px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>
            {showPostForm ? "Cancel" : "New Job"}
          </button>
        </div>
        {showPostForm && (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Task *</div>
              <input
                type="text"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                placeholder="e.g. Analyze this dataset"
                disabled={postSubmitting}
                style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, outline: "none" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Description</div>
              <textarea
                value={postDescription}
                onChange={(e) => setPostDescription(e.target.value)}
                placeholder="Describe what needs to be done…"
                disabled={postSubmitting}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, resize: "vertical", outline: "none" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Reward (optional)</div>
                <input
                  type="text"
                  value={postReward}
                  onChange={(e) => setPostReward(e.target.value)}
                  placeholder="e.g. 50 FLOP"
                  disabled={postSubmitting}
                  style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, outline: "none" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Upload (optional)</div>
                <input
                  type="file"
                  ref={fileInputRef}
                  disabled={postSubmitting}
                  style={{ width: "100%", fontSize: 12, color: "#94a3b8", paddingTop: 6 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={postSubmitting || !postTitle.trim()}
                onClick={() => void handlePostJob()}
                style={{ height: 34, padding: "0 16px", borderRadius: 5, border: "1px solid #2563eb", background: postSubmitting || !postTitle.trim() ? "#1a2640" : "#1e3a8a", color: postSubmitting || !postTitle.trim() ? "#6b7280" : "#93c5fd", fontSize: 13, fontWeight: 800, cursor: postSubmitting ? "default" : "pointer" }}
              >
                {postSubmitting ? "Posting…" : "Post Job"}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}>
                <input type="checkbox" checked={postToTechnocore} onChange={(e) => setPostToTechnocore(e.target.checked)} style={{ accentColor: "#7ee0c2" }} />
                Publish to Technocore
              </label>
              {postToTechnocore && (
                <select
                  value={postRoom}
                  onChange={(e) => setPostRoom(e.target.value)}
                  disabled={postSubmitting}
                  style={{ height: 32, padding: "0 8px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 11, outline: "none" }}
                >
                  <option value="osa-network">osa-network</option>
                  <option value="kibble">kibble</option>
                  <option value="credence">credence</option>
                  <option value="flop-market">flop-market</option>
                </select>
              )}
            </div>
            {postError && <div style={{ color: "#fca5a5", fontSize: 11 }}>{postError}</div>}
            {postSuccess && <div style={{ color: "#7ee0c2", fontSize: 11 }}>Job posted! ✅</div>}
          </div>
        )}
      </section>

      {/* ── My Claims & Results ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 9, padding: 14, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>My Claims</div>
          <button type="button" onClick={() => void refresh()} style={{ height: 28, padding: "0 12px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>Refresh</button>
        </div>
        {localJobs.length === 0 && claims.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No jobs yet. Post one above!</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {/* Local jobs that can be claimed */}
            {localJobs.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Available Jobs</div>
                {localJobs.map((job, idx) => {
                  const jobId = job.seq;
                  const claimed = claims.find((c) => c.job_id === jobId);
                  return (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid #1e2a45", borderRadius: 6, marginBottom: 4 }}>
                      <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
                        <div style={{ color: "#93c5fd", fontWeight: 800, fontSize: 11 }}>{job.text.split("\n")[0].replace(/^JOB v\d+:\s*/i, "").slice(0, 80) || "Untitled task"}</div>
                        <div style={{ color: "#94a3b8", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", maxHeight: 40 }}>{job.text.slice(0, 200)}</div>
                      </div>
                      {!claimed ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <button type="button" disabled={claimingJobId === jobId} onClick={() => { setShowAgentSelector(jobId); setSelectedAgentId("coder"); }} style={{ height: 28, padding: "0 10px", borderRadius: 5, border: "1px solid #2563eb", background: "#1e3a8a", color: "#93c5fd", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                            Claim
                          </button>
                          {showAgentSelector === jobId && (
                            <div style={{ position: "relative", display: "inline-block" }}>
                              <div style={{ position: "absolute", top: 32, right: 0, zIndex: 100, minWidth: 220, maxHeight: 300, overflowY: "auto", border: "1px solid #2a3558", borderRadius: 6, background: "#121828", padding: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                                <div style={{ fontSize: 11, color: "#94a3b8", padding: "4px 6px", marginBottom: 4 }}>Assign to agent:</div>
                                {agents.length === 0 && <div style={{ fontSize: 10, color: "#6b7280", padding: 4 }}>No agents available</div>}
                                {agents.map((agent) => (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() => { setSelectedAgentId(agent.id); void claimJob(jobId, agent.id, job.text); }}
                                    disabled={claimingJobId === jobId}
                                    style={{
                                      display: "block",
                                      width: "100%",
                                      textAlign: "left",
                                      padding: "6px 8px",
                                      borderRadius: 4,
                                      border: "none",
                                      background: selectedAgentId === agent.id ? "#1e3a8a" : "transparent",
                                      color: "#e2e8f0",
                                      fontSize: 12,
                                      cursor: "pointer",
                                      marginBottom: 2
                                    }}
                                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#1a2640"; }}
                                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = selectedAgentId === agent.id ? "#1e3a8a" : "transparent"; }}
                                  >
                                    <div style={{ fontWeight: 800, fontSize: 12 }}>{agent.name}</div>
                                    {agent.tagline && <div style={{ fontSize: 10, color: "#94a3b8" }}>{agent.tagline}</div>}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setShowAgentSelector(null)}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "center",
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    border: "1px solid #2a3558",
                                    background: "transparent",
                                    color: "#94a3b8",
                                    fontSize: 11,
                                    cursor: "pointer",
                                    marginTop: 4
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ padding: "2px 8px", borderRadius: 999, background: "#1a3a2a", color: "#7ee0c2", fontSize: 10, fontWeight: 800 }}>{claimed.status}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Claims list */}
            {claims.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Active Claims</div>
                {claims.map((c) => {
                  const hasResult = results.find((r) => r.job_id === c.job_id);
                  return (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid #1e2a45", borderRadius: 6, marginBottom: 4 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 11 }}>{c.job_id}</div>
                        <div style={{ color: "#94a3b8", fontSize: 10 }}>by {c.claimed_by}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 999, background: c.status === "completed" ? "#1a3a2a" : "#1e1b2a", color: c.status === "completed" ? "#7ee0c2" : "#94a3b8", fontSize: 10, fontWeight: 800 }}>{c.status}</span>
                        {!hasResult && c.status === "accepted" && (
                          <button type="button" disabled={submittingJobId === c.job_id} onClick={() => void submitResult(c.job_id, c.id)} style={{ height: 26, padding: "0 10px", borderRadius: 4, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontSize: 10, cursor: submittingJobId === c.job_id ? "default" : "pointer" }}>
                            {submittingJobId === c.job_id ? "Submitting…" : "Submit Result"}
                          </button>
                        )}
                        {c.session_id && (
                          <span style={{ color: "#38bdf8", fontSize: 10 }}>→ Workspace</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}