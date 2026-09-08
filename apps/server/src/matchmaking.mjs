import { createHash } from "crypto";

const FILESYSTEM_PATH = /(^|[\s(])(?:\/?(?:home|tmp|var|opt|srv|mnt|Users)\/[\w.\-@/]+|[A-Za-z]:\\[^\s]+)/g;

const KEYWORD_SKILLS = Object.freeze([
  ["coding", ["code", "coding", "implement", "build", "bug", "fix", "api", "frontend", "backend", "script", "integration"]],
  ["testing", ["test", "tests", "testing", "qa", "verify", "verification", "playwright", "vitest", "smoke"]],
  ["review", ["review", "audit", "inspect", "critique", "risk", "security", "regression"]],
  ["research", ["research", "analyze", "analysis", "market", "source", "sources", "investigate", "compare"]],
  ["synthesis", ["synthesis", "summarize", "summary", "plan", "roadmap", "proposal", "write", "draft"]],
]);

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function sanitizeMatchmakingText(value, maxLength = 220) {
  return String(value || "")
    .replace(FILESYSTEM_PATH, (match) => `${match.startsWith(" ") || match.startsWith("(") ? match[0] : ""}[path removed]`)
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\b(?:privateKey|BEGIN PRIVATE KEY|pkcs8|seed|osa_conn_[A-Za-z0-9_-]+|agent_signature|node_signature|signature)\b\s*[:=]?\s*[A-Za-z0-9_+/=-]{16,}/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSkill(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

function normalizeSkills(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const skill = normalizeSkill(value);
    if (!skill || seen.has(skill)) continue;
    seen.add(skill);
    output.push(skill);
    if (output.length >= 12) break;
  }
  return output.sort();
}

export function inferRequiredSkills(text, availableSkills = []) {
  const available = new Set(normalizeSkills(availableSkills));
  const raw = String(text || "").slice(0, 4096);
  const lower = raw.toLowerCase();
  const explicit = [];
  for (const match of lower.matchAll(/(?:skills?|capabilities|required)\s*[:=]\s*([^\n.;]+)/g)) {
    explicit.push(...match[1].split(/[,/|]+/));
  }
  const inferred = normalizeSkills(explicit);
  for (const skill of available) {
    const pattern = new RegExp(`(^|[^a-z0-9_-])${skill.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/_/g, "[_\\s-]")}([^a-z0-9_-]|$)`, "i");
    if (pattern.test(lower)) inferred.push(skill);
  }
  for (const [skill, keywords] of KEYWORD_SKILLS) {
    if (available.size && !available.has(skill)) continue;
    if (keywords.some((keyword) => lower.includes(keyword))) inferred.push(skill);
  }
  const result = normalizeSkills(inferred);
  if (result.length) return result;
  return ["research", "synthesis"].filter((skill) => !available.size || available.has(skill));
}

export function normalizeMatchmakingJob(input = {}, options = {}) {
  const room = sanitizeMatchmakingText(input.room || options.room || "local", 80) || "local";
  const seq = String(input.seq ?? input.job_id ?? input.id ?? "").slice(0, 140);
  const jobId = input.job_id ? String(input.job_id).slice(0, 140) : room === "local" ? seq : `${room}:${seq}`;
  const text = String(input.text || input.description || input.title || "").slice(0, 4096);
  const title = sanitizeMatchmakingText(input.title || text.split(/\r?\n/)[0].replace(/^JOB\s+v\d+:\s*/i, "").replace(/^JOB:\s*/i, ""), 120) || "Untitled job";
  const requiredSkills = normalizeSkills(input.required_skills || input.requiredSkills || inferRequiredSkills(text, options.availableSkills || []));
  return {
    id: jobId || `job-${sha256(`${room}\0${text}`).slice(0, 24)}`,
    source: room === "local" || input.source === "local" ? "local" : "technocore",
    room,
    seq,
    title,
    preview: sanitizeMatchmakingText(text, 260),
    text_hash: sha256(text),
    required_skills: requiredSkills,
    observed_at: sanitizeMatchmakingText(input.observed_at || input.createdAt || input.created_at || "", 40) || null,
    claimed: input.claimed === true,
  };
}

function reputationEvidence(provider) {
  const counts = provider?.reputation?.counts || {};
  return ["accepted_results", "verified_job_results", "claimed_deals", "refunded_deals", "disputed_deals"]
    .reduce((sum, key) => sum + Math.max(0, Number(counts[key] || 0)), 0);
}

function providerTrustRank(provider) {
  if (provider?.source === "local" && provider?.eligible) return 5;
  if (provider?.eligible && provider?.verification?.state === "verified") return 4;
  if (provider?.verification?.state === "stale") return 2;
  if (provider?.verification?.state === "untrusted") return 1;
  return 0;
}

export function scoreProviderForJob(job, provider) {
  const required = normalizeSkills(job?.required_skills || []);
  const skills = normalizeSkills(provider?.skills || []);
  const overlap = required.filter((skill) => skills.includes(skill));
  const missing = required.filter((skill) => !skills.includes(skill));
  const requiredCount = Math.max(1, required.length);
  const overlapScore = Math.round((overlap.length / requiredCount) * 60);
  const trustRank = providerTrustRank(provider);
  const trustScore = trustRank * 6;
  const evidence = reputationEvidence(provider);
  const evidenceScore = Math.min(10, evidence);
  const localBonus = provider?.source === "local" && provider?.eligible ? 8 : 0;
  const score = Math.max(0, Math.min(100, overlapScore + trustScore + evidenceScore + localBonus - missing.length * 8));
  const eligible = provider?.eligible === true && missing.length === 0;
  const reasons = [];
  if (overlap.length) reasons.push(`matches ${overlap.join(", ")}`);
  if (missing.length) reasons.push(`missing ${missing.join(", ")}`);
  if (provider?.source === "local") reasons.push("local profile");
  if (provider?.source === "federated") reasons.push("federated catalog provider");
  if (provider?.verification?.state === "verified") reasons.push("verified capability binding");
  if (evidence > 0) reasons.push(`${evidence} reputation evidence refs`);
  return {
    provider_id: String(provider?.id || "").slice(0, 240),
    agent_id: sanitizeMatchmakingText(provider?.agent_id || "", 80),
    name: sanitizeMatchmakingText(provider?.name || provider?.agent_id || "Agent", 80),
    source: provider?.source === "local" ? "local" : "federated",
    node_id: String(provider?.node_id || "").slice(0, 100),
    did: String(provider?.did || "").slice(0, 150),
    score,
    eligible,
    matched_skills: overlap,
    missing_skills: missing,
    verification: {
      state: String(provider?.verification?.state || "untrusted").slice(0, 40),
      verified: provider?.verification?.verified === true,
      stale: provider?.verification?.stale === true,
      label: sanitizeMatchmakingText(provider?.verification?.label || "UNTRUSTED", 80),
    },
    reputation: {
      status: sanitizeMatchmakingText(provider?.reputation?.status || "none", 60),
      evidence_count: evidence,
    },
    authority: {
      kind: provider?.source === "local" && eligible ? "local_selectable" : "recommendation_only",
      selectable_for_local_workspace: provider?.source === "local" && eligible,
      remote_execution: false,
      connector_spawning: false,
      auto_bidding: false,
      payment: false,
    },
    reasons: reasons.slice(0, 5),
  };
}

function sortCandidates(a, b) {
  const aSelectable = a.authority.selectable_for_local_workspace ? 1 : 0;
  const bSelectable = b.authority.selectable_for_local_workspace ? 1 : 0;
  return b.eligible - a.eligible
    || b.score - a.score
    || bSelectable - aSelectable
    || b.reputation.evidence_count - a.reputation.evidence_count
    || a.name.localeCompare(b.name)
    || a.provider_id.localeCompare(b.provider_id);
}

export function buildMatchmakingView({ jobs = [], skillRegistry = {}, generatedAt = new Date().toISOString(), limit = 30, candidateLimit = 5 } = {}) {
  const providers = Array.isArray(skillRegistry.providers) ? skillRegistry.providers : [];
  const availableSkills = normalizeSkills(skillRegistry.available_skills || []);
  const normalizedJobs = jobs
    .map((job) => normalizeMatchmakingJob(job, { availableSkills }))
    .filter((job) => job.id && job.preview)
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
  const entries = normalizedJobs.map((job) => {
    const candidates = providers
      .map((provider) => scoreProviderForJob(job, provider))
      .filter((candidate) => candidate.score > 0 || candidate.matched_skills.length > 0)
      .sort(sortCandidates)
      .slice(0, Math.max(1, Math.min(20, Number(candidateLimit) || 5)));
    return {
      id: `match-${sha256(`${job.id}\0${job.text_hash}`).slice(0, 24)}`,
      job,
      candidate_count: candidates.length,
      top_score: candidates[0]?.score || 0,
      status: candidates.some((candidate) => candidate.eligible) ? "matched" : candidates.length ? "partial" : "no_match",
      candidates,
    };
  });
  const matched = entries.filter((entry) => entry.status === "matched").length;
  return {
    schema: "osa-matchmaking/1",
    version: 1,
    generated_at: generatedAt,
    policy: {
      source_of_truth: "osa-skill-registry/1 + canonical job views",
      matching: "deterministic_skill_overlap_trust_reputation_rank",
      signature_meaning: "provider identity and record integrity only, not quality guarantee",
      authority: "recommendation_only",
      remote_execution: false,
      connector_spawning: false,
      auto_bidding: false,
      payment: false,
      settlement: false,
    },
    status: {
      job_count: entries.length,
      matched_count: matched,
      partial_count: entries.filter((entry) => entry.status === "partial").length,
      no_match_count: entries.filter((entry) => entry.status === "no_match").length,
      provider_count: providers.length,
      available_skill_count: availableSkills.length,
      registry_schema: skillRegistry.schema || null,
    },
    matches: entries,
  };
}
