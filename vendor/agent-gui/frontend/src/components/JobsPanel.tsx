import { useCallback, useEffect, useRef, useState } from "react";

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

interface LocalJob {
  room: string;
  seq: string;
  from: string;
  text: string;
  observed_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  accepted: { label: "In Progress", color: "#facc15", bg: "#241f10", border: "#7a6420" },
  working: { label: "Working…", color: "#38bdf8", bg: "#0f2131", border: "#1e6091" },
  completed: { label: "Finished", color: "#7ee0c2", bg: "#10251f", border: "#2a8c72" },
  claimed: { label: "Claimed", color: "#a5b4fc", bg: "#151a2e", border: "#3d4a8c" },
};

function extractTitle(text: string): string {
  return text.split("\n")[0].replace(/^JOB v\d+:\s*/i, "").replace(/^JOB:\s*/i, "").trim().slice(0, 120) || "Untitled task";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface TechnocoreJob {
  room: string;
  seq: number;
  from: string;
  text: string;
  observed_at: string;
  source: string;
}

export function JobsPanel() {
  const [localJobs, setLocalJobs] = useState<LocalJob[]>([]);
  const [technocoreJobs, setTechnocoreJobs] = useState<TechnocoreJob[]>([]);
  const [claims, setClaims] = useState<JobClaim[]>([]);
  const [results, setResults] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);

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
      setTechnocoreJobs(data.technocore_jobs || []);
      setClaims(data.local_claims || []);
      setResults(data.local_results || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Job load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 1-click claim — always uses the default agent (server picks)
  const claimJob = useCallback(async (jobId: string, jobText: string) => {
    setClaimBusy(jobId);
    setError(null);
    try {
      const data = await fetch("/api/jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: jobId, room: "local", agent_id: "technocore-specialist", job_text: jobText })
      }).then((r) => r.json());
      if (data.session) {
        window.dispatchEvent(new CustomEvent("osa:claim-job", { detail: { sessionId: data.session.id, claim: data.claim } }));
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim failed");
    } finally {
      setClaimBusy(null);
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

  if (loading) return <div style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading jobs…</div>;

  // Only show jobs that can still be claimed (not claimed yet)
  const claimableJobs = localJobs.filter((job) => !claims.some((c) => c.job_id === job.seq));
  // Completed/in-progress claims for the collapsible section
  const myJobs = claims;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={{ color: "#fca5a5", fontSize: 13 }}>{error}
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, height: 26, padding: "0 10px", borderRadius: 4, border: "1px solid #475569", background: "#172033", color: "#cbd5e1", fontSize: 12, cursor: "pointer" }}>Retry</button>
      </div>}

      {/* ── Post a Job ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>📋 Post a Job</div>
          <button type="button" onClick={() => setShowPostForm(!showPostForm)} style={{ height: 30, padding: "0 14px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#94a3b8", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            {showPostForm ? "Cancel" : "+ New Job"}
          </button>
        </div>
        {showPostForm && (
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Task *</div>
              <input
                type="text"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                placeholder="e.g. Analyze this dataset"
                disabled={postSubmitting}
                style={{ width: "100%", boxSizing: "border-box", height: 40, padding: "0 12px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 15, outline: "none" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Description</div>
              <textarea
                value={postDescription}
                onChange={(e) => setPostDescription(e.target.value)}
                placeholder="What needs to be done?"
                disabled={postSubmitting}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 14, resize: "vertical", outline: "none" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Reward (optional)</div>
                <input
                  type="text"
                  value={postReward}
                  onChange={(e) => setPostReward(e.target.value)}
                  placeholder="e.g. 50 FLOP"
                  disabled={postSubmitting}
                  style={{ width: "100%", boxSizing: "border-box", height: 40, padding: "0 12px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 15, outline: "none" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Upload (optional)</div>
                <input
                  type="file"
                  ref={fileInputRef}
                  disabled={postSubmitting}
                  style={{ width: "100%", fontSize: 13, color: "#94a3b8", paddingTop: 8 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={postSubmitting || !postTitle.trim()}
                onClick={() => void handlePostJob()}
                style={{ height: 36, padding: "0 18px", borderRadius: 6, border: "1px solid #2563eb", background: postSubmitting || !postTitle.trim() ? "#1a2640" : "#1e3a8a", color: postSubmitting || !postTitle.trim() ? "#6b7280" : "#93c5fd", fontSize: 14, fontWeight: 800, cursor: postSubmitting ? "default" : "pointer" }}
              >
                {postSubmitting ? "Posting…" : "Post Job"}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#94a3b8", cursor: "pointer" }}>
                <input type="checkbox" checked={postToTechnocore} onChange={(e) => setPostToTechnocore(e.target.checked)} style={{ accentColor: "#7ee0c2" }} />
                Publish to Technocore
              </label>
              {postToTechnocore && (
                <select
                  value={postRoom}
                  onChange={(e) => setPostRoom(e.target.value)}
                  disabled={postSubmitting}
                  style={{ height: 34, padding: "0 8px", borderRadius: 5, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 12, outline: "none" }}
                >
                  <option value="osa-network">osa-network</option>
                  <option value="kibble">kibble</option>
                  <option value="credence">credence</option>
                  <option value="flop-market">flop-market</option>
                </select>
              )}
            </div>
            {postError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{postError}</div>}
            {postSuccess && <div style={{ color: "#7ee0c2", fontSize: 13 }}>Job posted! ✅</div>}
          </div>
        )}
      </section>

      {/* ── Technocore Jobs ── */}
      {technocoreJobs.length > 0 && (
        <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
          <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>🌐 Technocore Jobs</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Jobs discovered in Technocore rooms (<b>kibble</b>, <b>credence</b>).</div>
          <div style={{ display: "grid", gap: 8 }}>
            {technocoreJobs.map((job, idx) => {
              const jobId = `${job.room}:${job.seq}`;
              const isClaimed = claims.some((c) => c.job_id === jobId);
              const title = extractTitle(job.text);
              const rewardMatch = job.text.match(/Reward:\s*([^\n|]+)/i);
              const reward = rewardMatch ? rewardMatch[1].trim() : null;
              const roomBadge = job.room === "kibble" ? { label: "kibble", color: "#f59e0b", bg: "#1f1a0e" } : { label: "credence", color: "#a78bfa", bg: "#17132e" };
              return (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", border: "1px solid #1e2a45", borderRadius: 8, background: "linear-gradient(90deg, rgba(139,92,246,0.05), rgba(15,23,42,0.4))" }}>
                  <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
                    <div style={{ color: "#93c5fd", fontWeight: 800, fontSize: 14 }}>{title || "Untitled job"}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                      <span style={{ padding: "1px 6px", borderRadius: 4, background: roomBadge.bg, color: roomBadge.color, fontSize: 11, fontWeight: 700, border: `1px solid ${roomBadge.color}33` }}>{roomBadge.label}</span>
                      <span style={{ color: "var(--text-dim)" }}>von <b style={{ color: "#94a3b8" }}>{job.from}</b></span>
                      {reward && <span style={{ color: "#facc15", fontWeight: 700 }}>💰 {reward}</span>}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", maxHeight: 44, lineHeight: 1.4 }}>{job.text.slice(0, 240)}</div>
                  </div>
                  {!isClaimed ? (
                    <button
                      type="button"
                      disabled={claimBusy === jobId}
                      onClick={() => void claimJob(jobId, job.text)}
                      style={{ height: 32, padding: "0 16px", borderRadius: 6, border: "1px solid #2a8c72", background: claimBusy === jobId ? "#18251f" : "#16a37b", color: "white", fontSize: 13, fontWeight: 900, cursor: claimBusy === jobId ? "default" : "pointer", whiteSpace: "nowrap" }}
                    >
                      {claimBusy === jobId ? "⚙️ Claiming…" : "⚡ Claim"}
                    </button>
                  ) : (
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "#10251f", color: "#7ee0c2", fontSize: 11, fontWeight: 800, border: "1px solid #2a8c72", whiteSpace: "nowrap" }}>✅ Claimed</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Available Jobs (only claimable) ── */}
      <section style={{ border: "1px solid #273453", borderRadius: 10, padding: 16, background: "#0b1525" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 4 }}>🛠️ Available Jobs</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Only jobs you can still claim.</div>
        {claimableJobs.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 14, padding: "18px 4px" }}>No available jobs. Post one above! 🎯</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {claimableJobs.map((job, idx) => {
              const jobId = job.seq;
              const title = extractTitle(job.text);
              const firstLine = job.text.split("\n")[0];
              const rewardMatch = firstLine.match(/Reward:\s*([^\n|]+)/i);
              const reward = rewardMatch ? rewardMatch[1].trim() : null;
              return (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", border: "1px solid #1e2a45", borderRadius: 8, background: "linear-gradient(90deg, rgba(34,211,238,0.05), rgba(15,23,42,0.4))" }}>
                  <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
                    <div style={{ color: "#93c5fd", fontWeight: 800, fontSize: 14 }}>{title || "Untitled task"}</div>
                    {reward && <div style={{ color: "#facc15", fontSize: 12, fontWeight: 700 }}>💰 {reward}</div>}
                    <div style={{ color: "#94a3b8", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", maxHeight: 44, lineHeight: 1.4 }}>{job.text.slice(0, 240)}</div>
                  </div>
                  <button
                    type="button"
                    disabled={claimBusy === jobId}
                    onClick={() => void claimJob(jobId, job.text)}
                    style={{ height: 32, padding: "0 16px", borderRadius: 6, border: "1px solid #2a8c72", background: claimBusy === jobId ? "#18251f" : "#16a37b", color: "white", fontSize: 13, fontWeight: 900, cursor: claimBusy === jobId ? "default" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {claimBusy === jobId ? "⚙️ Claiming…" : "⚡ Claim"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── My Jobs — collapsible, completed + in-progress details ── */}
      {myJobs.length > 0 && (
        <section style={{ border: "1px solid #273453", borderRadius: 10, padding: "12px 16px", background: "#0b1525" }}>
          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: "4px 0", color: "inherit" }}
          >
            <div style={{ fontSize: 17, fontWeight: 900 }}>
              📦 My Completed Jobs <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>({myJobs.length})</span>
            </div>
            <div style={{ color: "var(--accent2)", fontSize: 18, fontWeight: 900, transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</div>
          </button>
          {showCompleted && (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {myJobs.map((c) => {
                const result = results.find((r) => r.job_id === c.job_id);
                const status = STATUS_LABELS[c.status] || { label: c.status, color: "#94a3b8", bg: "#1e1b2a", border: "#2a3558" };
                const isExpanded = expandedResult === c.id;
                const title = extractTitle(
                  localJobs.find((j) => j.seq === c.job_id)?.text || c.job_id
                );
                return (
                  <div key={c.id} style={{ border: "1px solid #1e2a45", borderRadius: 8, overflow: "hidden", background: "#0d1626" }}>
                    <button
                      type="button"
                      onClick={() => setExpandedResult(isExpanded ? null : c.id)}
                      style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px", background: "none", border: "none", cursor: "pointer", color: "inherit", textAlign: "left" }}
                    >
                      <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{title || c.job_id}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--text-dim)" }}>
                          <span>Agent: <b style={{ color: "#93c5fd" }}>{c.claimed_by}</b></span>
                          <span>•</span>
                          <span>{formatDate(c.claimed_at)}</span>
                          <span>•</span>
                          <span>ID: <code style={{ fontSize: 11, color: "#64748b" }}>{c.job_id}</code></span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 999, background: status.bg, color: status.color, fontSize: 12, fontWeight: 800, border: `1px solid ${status.border}`, whiteSpace: "nowrap" }}>
                          {status.label}
                        </span>
                        {result?.verified && <span style={{ padding: "3px 8px", borderRadius: 999, background: "#10251f", color: "#7ee0c2", fontSize: 11, fontWeight: 800, border: "1px solid #2a8c72", whiteSpace: "nowrap" }}>✅ verified</span>}
                        <span style={{ color: "var(--accent2)", fontSize: 14, fontWeight: 900, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div style={{ padding: "4px 14px 14px", display: "grid", gap: 8, borderTop: "1px solid #1e2a45" }}>
                        {c.session_id && (
                          <div style={{ fontSize: 12, color: "#38bdf8" }}>
                            🔗 Workspace-Session: <code style={{ fontSize: 11 }}>{c.session_id.slice(0, 40)}…</code>
                          </div>
                        )}
                        {result ? (
                          <>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Result</div>
                              <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.45, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", border: "1px solid #1a2744", borderRadius: 6, padding: "10px 12px", background: "#0a101f" }}>
                                {result.summary}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-dim)" }}>
                              <span>Submitted: {formatDate(result.submitted_at)}</span>
                              {result.output_hash && <span>• Hash: <code style={{ fontSize: 10, color: "#64748b" }}>{result.output_hash.slice(0, 24)}…</code></span>}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 13, color: "var(--text-dim)", padding: "6px 2px" }}>
                            {c.status === "completed" ? "No result saved." : "Agent is still working on this job…"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}