import { createHash } from "node:crypto";

export const FEDERATED_WORKBENCH_SCHEMA = "osa-federated-workbench/1";
export const FEDERATED_WORKBENCH_LIMITS = Object.freeze({
  maxRecords: 1000,
  maxTitleBytes: 140,
  maxSummaryBytes: 900,
  maxCapabilities: 20,
  maxQuarantineReasonBytes: 180,
});

const SECRET_OR_AUTH = /(?:-----BEGIN|private\s*key|seed\s*(?:phrase)?\s*[:=]|password\s*[:=]|secret\s*[:=]|api[_ -]?key\s*[:=]|bearer\s+[A-Za-z0-9._~-]{12,}|osa_conn_)/i;
const FILESYSTEM_PATH = /(?:^|[\s(])(?:~|\.{1,2}|\/[A-Za-z0-9._-]|[A-Za-z]:\\)[^\s)"'`<>]*/g;

export function normalizeFederatedWorkbenchProjection(records = []) {
  if (!Array.isArray(records)) return [];
  const byId = new Map();
  for (const raw of records) {
    const record = normalizeRecord(raw);
    if (!record) continue;
    const current = byId.get(record.id);
    if (!current || compareRecord(record, current) > 0) byId.set(record.id, record);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.updated_at || b.last_seen_at).localeCompare(String(a.updated_at || a.last_seen_at)) || a.id.localeCompare(b.id))
    .slice(0, FEDERATED_WORKBENCH_LIMITS.maxRecords);
}

export function federatedWorkbenchRecordsFromSnapshot(snapshot = {}, collections = {}, options = {}) {
  const node = snapshot.node || {};
  const originNodeId = token(node.nodeId, 100);
  const originNodeDid = didOrNull(node.did || node.nodeDid || null);
  const observedAt = timestamp(options.observedAt) || new Date().toISOString();
  const trustState = options.verified === true ? "verified" : "untrusted";
  const records = [];
  if (!originNodeId) {
    if (Array.isArray(collections.tasks) && collections.tasks.length) {
      records.push(quarantineRecord({ reason: "missing_origin_node_identity", observedAt }));
    }
    return records;
  }

  const goals = new Map((Array.isArray(collections.goals) ? collections.goals : []).map((goal) => [String(goal?.id || ""), goal]));
  const agents = new Map((Array.isArray(collections.agents) ? collections.agents : []).map((agent) => [String(agent?.id || ""), agent]));
  for (const task of Array.isArray(collections.tasks) ? collections.tasks.slice(0, FEDERATED_WORKBENCH_LIMITS.maxRecords) : []) {
    const taskId = token(task?.id, 140);
    if (!taskId) {
      records.push(quarantineRecord({ originNodeId, originNodeDid, reason: "missing_task_id", observedAt }));
      continue;
    }
    const status = taskStatus(task.status);
    const goalId = token(task.goalId, 140);
    const agentId = token(task.assignedAgentId || task.agentGuiAgent, 100) || null;
    const privateBody = task.private === true || task.public === false || task.visibility === "private" || task.agentGuiRoom === "home";
    const title = sanitizeWorkbenchText(task.title || "Federated task", FEDERATED_WORKBENCH_LIMITS.maxTitleBytes, { fallback: "Federated task" });
    const summary = privateBody
      ? "Private task body withheld by source protocol."
      : sanitizeWorkbenchText(task.description || goals.get(goalId)?.description || title, FEDERATED_WORKBENCH_LIMITS.maxSummaryBytes, { fallback: "No public task summary provided." });
    const sourceHash = objectHash({ originNodeId, task: publicTaskHashPayload(task), goal: goalId ? publicGoalHashPayload(goals.get(goalId)) : null });
    const id = `fwb-${hashParts([originNodeId, taskId]).slice(0, 32)}`;
    records.push({
      id,
      kind: "task",
      state: trustState,
      importable: trustState === "verified",
      origin_node_id: originNodeId,
      origin_node_did: originNodeDid,
      origin_agent_id: agentId,
      origin_agent_name: agentId ? sanitizeWorkbenchText(agents.get(agentId)?.name || agentId, 100, { fallback: agentId }) : null,
      origin_agent_did: didOrNull(agents.get(agentId)?.did || null),
      task_id: taskId,
      goal_id: goalId || null,
      goal_title: goalId ? sanitizeWorkbenchText(goals.get(goalId)?.title || "", 140, { fallback: "" }) || null : null,
      title,
      summary,
      status,
      task_type: token(task.type, 40) || "synthesis",
      required_capabilities: capabilities(task.requiredCapabilities || []),
      priority: boundedNumber(task.priority, 0, 100, 50),
      created_at: timestamp(task.createdAt) || observedAt,
      updated_at: timestamp(task.updatedAt || task.createdAt) || observedAt,
      last_seen_at: observedAt,
      imported_session_id: token(task.imported_session_id || task.importedSessionId, 180) || null,
      imported_task_id: token(task.imported_task_id || task.importedTaskId, 140) || null,
      import_idempotency_key: token(task.import_idempotency_key || task.importIdempotencyKey, 128) || null,
      trust: {
        state: trustState,
        stale: false,
        verified: trustState === "verified",
        reason: trustState === "verified" ? "trusted_peer_snapshot" : "federation_signature_verification_disabled",
      },
      identity_binding: {
        node_id: originNodeId,
        node_did: originNodeDid,
        agent_id: agentId,
        agent_did: didOrNull(agents.get(agentId)?.did || null),
        task_id: taskId,
        goal_id: goalId || null,
      },
      provenance: {
        source: "osa-federation-snapshot",
        node_id: originNodeId,
        observed_at: observedAt,
        head: token(snapshot.head || snapshot.headsByNode?.[originNodeId], 160) || null,
        source_hash: sourceHash,
      },
      authority: "inspect_only",
      remote_execution: false,
      connector_spawning: false,
      files_shared: false,
      no_payment: true,
      no_settlement: true,
      source_hash: sourceHash,
    });
  }
  return normalizeFederatedWorkbenchProjection(records);
}

export function federatedWorkbenchQuarantineFromSnapshot(snapshot = {}, reason = "snapshot_rejected", options = {}) {
  const node = snapshot?.node || {};
  return quarantineRecord({
    originNodeId: token(node.nodeId, 100) || null,
    originNodeDid: didOrNull(node.did || node.nodeDid || null),
    reason,
    observedAt: timestamp(options.observedAt) || new Date().toISOString(),
  });
}

export function publicFederatedWorkbenchOverview(records = [], options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const staleAfterMs = Math.max(1000, Number(options.staleAfterMs || 60_000));
  const normalized = normalizeFederatedWorkbenchProjection(records).map((record) => {
    if (record.kind !== "task") return record;
    const stale = record.trust.stale === true || !Number.isFinite(Date.parse(record.last_seen_at || "")) || nowMs - Date.parse(record.last_seen_at) > staleAfterMs;
    const trustState = stale ? "stale" : record.trust.state;
    return {
      ...record,
      state: record.imported_session_id ? "imported" : trustState,
      importable: trustState === "verified" && !record.imported_session_id,
      trust: { ...record.trust, state: trustState, stale, verified: record.trust.verified === true && !stale },
    };
  });
  const tasks = normalized.filter((record) => record.kind === "task");
  const quarantine = normalized.filter((record) => record.kind === "quarantine");
  return {
    schema: FEDERATED_WORKBENCH_SCHEMA,
    version: 1,
    generated_at: new Date(nowMs).toISOString(),
    policy: {
      visibility: "federated-public-task-metadata-only",
      authority: "inspect_only_until_explicit_local_import",
      signatures_mean: "trusted peer snapshots authenticate node provenance and integrity only, not permission to execute",
      no_automatic_execution: true,
      remote_execution: false,
      connector_spawning: false,
      files_shared: false,
      no_payment: true,
      no_settlement: true,
    },
    status: {
      enabled: options.enabled === true,
      stale_after_ms: staleAfterMs,
      task_count: tasks.length,
      verified_count: tasks.filter((record) => record.trust.state === "verified").length,
      stale_count: tasks.filter((record) => record.trust.state === "stale").length,
      untrusted_count: tasks.filter((record) => record.trust.state === "untrusted").length,
      imported_count: tasks.filter((record) => Boolean(record.imported_session_id)).length,
      quarantine_count: quarantine.length,
      last_import_at: options.lastImportAt || null,
      last_error: options.lastError || null,
    },
    tasks,
    quarantine,
  };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = raw.kind === "quarantine" ? "quarantine" : "task";
  const id = token(raw.id, 80) || (kind === "quarantine" ? `fwbq-${hashParts([raw.reason || raw.rejection_reason || "quarantine", raw.observed_at || ""]).slice(0, 24)}` : null);
  if (!id) return null;
  const state = kind === "quarantine" ? "quarantined" : ["verified", "stale", "untrusted", "imported"].includes(raw.state) ? raw.state : "untrusted";
  if (kind === "quarantine") {
    return {
      id,
      kind,
      state,
      origin_node_id: token(raw.origin_node_id || raw.originNodeId, 100) || null,
      origin_node_did: didOrNull(raw.origin_node_did || raw.originNodeDid || null),
      reason: sanitizeWorkbenchText(raw.reason || raw.rejection_reason || "snapshot_rejected", FEDERATED_WORKBENCH_LIMITS.maxQuarantineReasonBytes, { fallback: "snapshot_rejected" }).replace(/\s+/g, "_"),
      first_seen_at: timestamp(raw.first_seen_at || raw.firstSeenAt) || timestamp(raw.observed_at || raw.observedAt) || new Date().toISOString(),
      last_seen_at: timestamp(raw.last_seen_at || raw.lastSeenAt) || timestamp(raw.observed_at || raw.observedAt) || new Date().toISOString(),
      authority: "none",
      remote_execution: false,
      connector_spawning: false,
      files_shared: false,
      no_payment: true,
      no_settlement: true,
    };
  }
  const originNodeId = token(raw.origin_node_id || raw.originNodeId, 100);
  const taskId = token(raw.task_id || raw.taskId, 140);
  if (!originNodeId || !taskId) return null;
  const trustState = ["verified", "stale", "untrusted"].includes(raw.trust?.state) ? raw.trust.state : state === "verified" || state === "stale" ? state : "untrusted";
  const importedSessionId = token(raw.imported_session_id || raw.importedSessionId, 180) || null;
  return {
    id,
    kind,
    state: importedSessionId ? "imported" : trustState,
    importable: raw.importable === true && trustState === "verified" && !importedSessionId,
    origin_node_id: originNodeId,
    origin_node_did: didOrNull(raw.origin_node_did || raw.originNodeDid || null),
    origin_agent_id: token(raw.origin_agent_id || raw.originAgentId, 100) || null,
    origin_agent_name: sanitizeWorkbenchText(raw.origin_agent_name || raw.originAgentName || "", 100, { fallback: "" }) || null,
    origin_agent_did: didOrNull(raw.origin_agent_did || raw.originAgentDid || null),
    task_id: taskId,
    goal_id: token(raw.goal_id || raw.goalId, 140) || null,
    goal_title: sanitizeWorkbenchText(raw.goal_title || raw.goalTitle || "", 140, { fallback: "" }) || null,
    title: sanitizeWorkbenchText(raw.title || "Federated task", FEDERATED_WORKBENCH_LIMITS.maxTitleBytes, { fallback: "Federated task" }),
    summary: sanitizeWorkbenchText(raw.summary || "No public task summary provided.", FEDERATED_WORKBENCH_LIMITS.maxSummaryBytes, { fallback: "No public task summary provided." }),
    status: taskStatus(raw.status),
    task_type: token(raw.task_type || raw.taskType, 40) || "synthesis",
    required_capabilities: capabilities(raw.required_capabilities || raw.requiredCapabilities || []),
    priority: boundedNumber(raw.priority, 0, 100, 50),
    created_at: timestamp(raw.created_at || raw.createdAt) || new Date().toISOString(),
    updated_at: timestamp(raw.updated_at || raw.updatedAt || raw.created_at || raw.createdAt) || new Date().toISOString(),
    last_seen_at: timestamp(raw.last_seen_at || raw.lastSeenAt) || new Date().toISOString(),
    imported_session_id: importedSessionId,
    imported_task_id: token(raw.imported_task_id || raw.importedTaskId, 140) || null,
    import_idempotency_key: token(raw.import_idempotency_key || raw.importIdempotencyKey, 128) || null,
    trust: {
      state: trustState,
      stale: raw.trust?.stale === true || trustState === "stale",
      verified: raw.trust?.verified === true && trustState === "verified",
      reason: sanitizeWorkbenchText(raw.trust?.reason || (trustState === "verified" ? "trusted_peer_snapshot" : "untrusted"), 160, { fallback: "untrusted" }),
    },
    identity_binding: {
      node_id: originNodeId,
      node_did: didOrNull(raw.identity_binding?.node_did || raw.identityBinding?.nodeDid || raw.origin_node_did || null),
      agent_id: token(raw.identity_binding?.agent_id || raw.identityBinding?.agentId || raw.origin_agent_id || null, 100) || null,
      agent_did: didOrNull(raw.identity_binding?.agent_did || raw.identityBinding?.agentDid || raw.origin_agent_did || null),
      task_id: taskId,
      goal_id: token(raw.identity_binding?.goal_id || raw.identityBinding?.goalId || raw.goal_id || null, 140) || null,
    },
    provenance: {
      source: "osa-federation-snapshot",
      node_id: originNodeId,
      observed_at: timestamp(raw.provenance?.observed_at || raw.provenance?.observedAt || raw.last_seen_at) || new Date().toISOString(),
      head: token(raw.provenance?.head, 160) || null,
      source_hash: /^[a-f0-9]{64}$/.test(String(raw.provenance?.source_hash || raw.source_hash || "")) ? String(raw.provenance?.source_hash || raw.source_hash) : objectHash({ originNodeId, taskId }),
    },
    authority: "inspect_only",
    remote_execution: false,
    connector_spawning: false,
    files_shared: false,
    no_payment: true,
    no_settlement: true,
    source_hash: /^[a-f0-9]{64}$/.test(String(raw.source_hash || "")) ? String(raw.source_hash) : objectHash({ originNodeId, taskId }),
  };
}

function quarantineRecord({ originNodeId = null, originNodeDid = null, reason, observedAt }) {
  const safeReason = sanitizeWorkbenchText(reason || "snapshot_rejected", FEDERATED_WORKBENCH_LIMITS.maxQuarantineReasonBytes, { fallback: "snapshot_rejected" }).replace(/\s+/g, "_");
  const id = `fwbq-${hashParts([originNodeId || "unknown", safeReason, observedAt]).slice(0, 28)}`;
  return normalizeRecord({ id, kind: "quarantine", origin_node_id: originNodeId, origin_node_did: originNodeDid, reason: safeReason, observed_at: observedAt });
}

function compareRecord(a, b) {
  const rank = (record) => ({ imported: 4, verified: 3, stale: 2, untrusted: 1, quarantined: 0 }[record.state] ?? 0);
  const delta = rank(a) - rank(b);
  if (delta) return delta;
  return String(a.last_seen_at || a.updated_at || "").localeCompare(String(b.last_seen_at || b.updated_at || ""));
}

function publicTaskHashPayload(task = {}) {
  return {
    id: task.id || null,
    goalId: task.goalId || null,
    title: task.title || null,
    descriptionHash: task.description ? objectHash(String(task.description)) : null,
    status: task.status || null,
    assignedAgentId: task.assignedAgentId || task.agentGuiAgent || null,
    updatedAt: task.updatedAt || null,
  };
}

function publicGoalHashPayload(goal = {}) {
  if (!goal) return null;
  return { id: goal.id || null, title: goal.title || null, status: goal.status || null, updatedAt: goal.updatedAt || goal.completedAt || goal.createdAt || null };
}

function sanitizeWorkbenchText(value, maxBytes, { fallback = "" } = {}) {
  let text = String(value || "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if (!text) return fallback;
  if (SECRET_OR_AUTH.test(text)) return fallback || "[redacted]";
  text = text.replace(FILESYSTEM_PATH, (match) => `${match.startsWith(" ") || match.startsWith("(") ? match[0] : ""}[path removed]`);
  while (Buffer.byteLength(text, "utf8") > maxBytes) text = text.slice(0, -1);
  return text.trim() || fallback;
}

function capabilities(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const cap = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60);
    if (cap && !output.includes(cap)) output.push(cap);
    if (output.length >= FEDERATED_WORKBENCH_LIMITS.maxCapabilities) break;
  }
  return output;
}

function taskStatus(value) {
  const status = String(value || "open").toLowerCase();
  return ["open", "leased", "in_consensus", "needs_review", "needs_revision", "done", "rejected"].includes(status) ? status : "open";
}

function boundedNumber(value, min, max, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : fallback;
}

function timestamp(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function token(value, max = 160) {
  const text = String(value || "").trim().slice(0, max);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(text) ? text : "";
}

function didOrNull(value) {
  const text = String(value || "").trim().slice(0, 200);
  return /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,180}$/.test(text) ? text : null;
}

function hashParts(parts) {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\0"), "utf8").digest("hex");
}

function objectHash(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
