import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { subtaskDelegationRoomForRecipient } from "../apps/server/src/subtask-delegation.mjs";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_BROWSER_E2E_PORT || 19880 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-browser-e2e-"));
const openClawFixturePath = join(dataDir, "openclaw-fixture.sh");
const testWalletPrivateKey = Uint8Array.from(Buffer.from("1111111111111111111111111111111111111111111111111111111111111111", "hex"));
const testWalletAddress = ethereumAddressFromPrivateKey(testWalletPrivateKey);
const testTechnocoreDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
const pageErrors = [];
let browser = null;
let server = null;

try {
  await writeFile(
    openClawFixturePath,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' '{\"final\":\"{\\\"summary\\\":\\\"Done\\\",\\\"content\\\":\\\"Finished by the browser E2E fixture.\\\",\\\"sources\\\":[\\\"fixture://openclaw\\\"],\\\"confidence\\\":0.9}\"}'"
    ].join("\n")
  );
  await chmod(openClawFixturePath, 0o755);

  server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OSA_DATA_DIR: dataDir,
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_LOCAL_PASSWORD_REQUIRED: "0",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      OSA_OPENCLAW_COMMAND: openClawFixturePath,
      OSA_CODEX_BINARY: join(dataDir, "missing-codex"),
      OSA_CODEX_COMMAND: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  let sessions = await getJson("/api/sessions");
  assert(Array.isArray(sessions) && sessions.length === 1 && sessions[0]?.team_id === "public-projects-room", "fresh dashboard should expose only the public example project");
  let top = await getJson("/api/top-projects?limit=100");
  assert(Array.isArray(top.agents) && top.agents.some((agent) => agent.target_id === "osa-example-reward-engine"), "fresh Top100 should include the example project");
  const balance = await getJson(`/api/wallet/balance?address=${testWalletAddress}`);
  assert(balance.balance_flop === null && balance.formatted === "Prelaunch" && balance.source === "flop_prelaunch", "wallet endpoint should honestly report FLOP prelaunch state");
  let config = await getJson("/api/gui-config");
  const agentIds = config.agents.map((agent) => agent.id);
  for (const id of ["technocore-specialist", "coder", "bugfixer", "info-guy", "coinexpert", "graphicsexpert", "moneymaker", "security-expert", "explorer"]) {
    assert(agentIds.includes(id), `Agent Profiles should include ${id}`);
  }
  assert(config.default_agent_id === "technocore-specialist", "Technocore Specialist should be the default AgentGUI profile");
  const defaultPersona = await getJson("/api/agents/technocore-specialist/persona");
  assert(defaultPersona.soul.includes("technocore.chat"), "default Technocore Specialist should include Technocore protocol context");
  assert(config.agents.find((agent) => agent.id === "coder")?.model === "OpenClaw local agent", "Coder should default to OpenClaw in AgentGUI");
  assert(config.agents.find((agent) => agent.id === "bugfixer")?.model === "OpenClaw local agent", "Bugfixer should default to OpenClaw in AgentGUI");
  assert(config.prototypes.length === 0, "legacy built-in Agent Profile prototypes should be removed");
  const openclawStatus = await getJson("/api/openclaw/status");
  assert(openclawStatus.available === true && openclawStatus.install_command, "OpenClaw setup status should expose wizard install diagnostics");
  const openclawInstall = await postJson("/api/openclaw/install", {});
  assert(openclawInstall.installed === false && openclawInstall.status?.available === true, "OpenClaw wizard install should be a no-op when OpenClaw is already available");
  const infoPersona = await getJson("/api/agents/info-guy/persona");
  assert(infoPersona.soul.includes("information-gathering"), "existing specialist profiles should expose useful Soul.md content");
  await putJson("/api/agents/info-guy/persona", {
    ...infoPersona,
    tagline: "Finds sourced facts for OSA tests",
    soul: `${infoPersona.soul}\nBrowser E2E edit marker.`,
    memory: `${infoPersona.memory}\nBrowser E2E memory marker.`
  });
  const editedInfoPersona = await getJson("/api/agents/info-guy/persona");
  assert(editedInfoPersona.tagline === "Finds sourced facts for OSA tests", "existing Agent Profiles should be editable");
  assert(editedInfoPersona.soul.includes("Browser E2E edit marker."), "editing an existing Agent Profile should persist Soul.md");
  assert(editedInfoPersona.memory.includes("Browser E2E memory marker."), "editing an existing Agent Profile should persist Memory.md");
  const customProfile = await postJson("/api/agents", {
    id: "profit-scout",
    clone_from: "coder",
    name: "Profit Scout",
    tagline: "Find useful OpenClaw opportunities"
  });
  assert(customProfile.agent?.id === "profit-scout", "custom OpenClaw profiles should be creatable");
  config = await getJson("/api/gui-config");
  assert(config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should appear in Agent Profiles");
  await deleteJson("/api/agents/profit-scout");
  config = await getJson("/api/gui-config");
  assert(config.rooms.some((room) => room.name === "Home") && !config.rooms.some((room) => room.name === "Public" || room.name === "Public Rooms"), "dashboard should expose Home without legacy Public room tabs from start");
  assert(!config.agents.some((agent) => agent.id === "profit-scout"), "custom profile should be deletable");

  for (let index = 1; index <= 12; index += 1) {
    await postJson("/api/network/chat", {
      wallet_address: testWalletAddress,
      message: `Search marker ${String(index).padStart(2, "0")}: browser chat viewport fixture with enough text to verify scrolling.`
    });
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(8000);
  await page.exposeFunction("osaE2eSignPersonalMessage", (message) => signPersonalMessage(String(message)));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`${message.text()}${message.location().url ? ` (${message.location().url})` : ""}`);
  });
  let chatGetRequestCount = 0;
  let delayedValidatorsReadCount = 0;
  let sentChatFixture = null;
  let protocolAcceptMockEnabled = true;
  const browserTclkSession = {
    id: "home-task-browser-tclk",
    started_at: "2026-09-04T08:00:00.000Z",
    ended_at: null,
    source: "osa-home",
    model: "OpenClaw local agent",
    parent_session_id: null,
    title: "Browser TCLK workspace",
    message_count: 1,
    token_estimate: 120,
    is_running: false,
    first_activity_at: "2026-09-04T08:00:00.000Z",
    last_activity_at: "2026-09-04T08:00:00.000Z",
    title_summary: "Home",
    auto_continue: false,
    task_solved: false,
    workspace_path: null,
    is_sleeping: false,
    agent: "technocore-specialist",
    agent_model: "OpenClaw local agent",
    agent_base_url: "",
    desk_tools: ["research", "review", "synthesis"],
    team_id: "home-room",
    team_name: "Home",
    shared_public: false,
    connector_status: null,
    connector_exit_code: null,
    connector_error: null
  };
  const browserA2AObservation = {
    id: "a2a-observation-browser-1",
    profile: "osa-a2a-room/1",
    version: "1",
    type: "MESSAGE",
    frame_id: "frame-browser-a2a-1",
    correlation_id: "corr-browser-a2a-1",
    context_id: "ctx-browser-a2a-1",
    message_id: "msg-browser-a2a-1",
    sender: testTechnocoreDid,
    recipient: testTechnocoreDid,
    envelope_hash: "b".repeat(64),
    header_hash: "c".repeat(64),
    payload_hash: "d".repeat(64),
    wire_bytes: 180,
    transport_form: "technocore-escaped-line",
    verified: true,
    valid: true,
    rejection: null,
    replay: false,
    conflict: false,
    part_count: 1,
    part_kinds: ["text"],
    media_types: ["text/plain"],
    schemas: [],
    transports: [{ room: "osa-network", generation: 1, sequence: 92, observed_at: "2026-09-04T08:00:00.000Z" }],
    observed_at: "2026-09-04T08:00:00.000Z",
    last_seen_at: "2026-09-04T08:00:00.000Z",
    authority: "none",
    handling: "authenticated-data-only",
    remote_execution: false,
    value_settlement: false
  };
  const browserA2AOverview = {
    profile: "osa-a2a-room/1",
    version: "1",
    compatibility: "OSA transport profile / edge adapter; not full official A2A HTTP or JSON-RPC compatibility",
    logical_format: "A2A/1 TYPE {canonical header}\\n{canonical payload}",
    technocore_transport_format: "The logical newline is encoded as the two ASCII characters \\ and n; decoding restores exactly one newline before validation.",
    frame_types: ["MESSAGE", "TASK", "STATUS", "RESULT", "ARTIFACT", "ERROR", "ACK"],
    limits: {
      maxWireBytes: 4096,
      maxLogicalBytes: 3584,
      maxHeaderBytes: 1400,
      maxPayloadBytes: 2600,
      maxParts: 8,
      maxTextPartBytes: 1024,
      maxDataPartBytes: 1536,
      maxFileBytes: 10485760,
      maxDepth: 12,
      maxTtlMs: 604800000,
      maxFutureSkewMs: 300000,
      observation_limit: 1000
    },
    semantics: {
      authority: "none",
      handling: "authenticated-data-only",
      remote_execution: false,
      mailbox_routing: true,
      mailbox_profile: "osa-agent-mailbox/1",
      workspace_dispatch: false,
      value_settlement: false,
      signatures_mean: "sender authorship and byte integrity only"
    },
    archive: {
      persisted: true,
      payloads_persisted: false,
      record_count: 1,
      returned_count: 1
    },
    observations: [browserA2AObservation],
    generated_at: "2026-09-04T08:00:00.000Z"
  };
  const browserMailboxRemoteDid = "did:key:z6MktCjMnQxY8SdzpQwL2oCePJqBM2SYA11vngd4D2fa5g9Z";
  const browserMailboxInbox = {
    id: "mailbox-in-browser-1", box: "inbox", profile: "osa-agent-mailbox/1", frame_type: "MESSAGE", frame_id: "frame-browser-mailbox-1", message_id: "msg-browser-mailbox-1",
    sender: { source: "federated", agent_id: "remote-coder", name: "Remote Coder", did: browserMailboxRemoteDid, node_id: "node-browser-remote" },
    recipient: { source: "local", agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local" },
    room: "mb-osa-browser-local", text: "Verified browser mailbox inbox message", created_at: "2026-09-05T10:00:00.000Z", expires_at: "2026-09-05T12:00:00.000Z",
    correlation_id: "corr-mb-browser", context_id: "ctx-mb-browser", envelope_hash: "e".repeat(64), verified: true, trust: "verified", delivery_status: "received", last_seen_at: "2026-09-05T10:00:00.000Z",
    public_unlisted: true, authority: "none", handling: "bounded-chat-text-only", remote_execution: false
  };
  const browserMailboxQuarantine = {
    ...browserMailboxInbox, id: "mailbox-quarantine-browser-1", box: "quarantine", text: null, envelope_hash: "f".repeat(64), verified: false, trust: "untrusted", rejection: "signature_unverified", delivery_status: "quarantined"
  };
  const browserMailboxOverview = {
    profile: "osa-agent-mailbox/1", a2a_profile: "osa-a2a-room/1", generated_at: "2026-09-05T10:00:00.000Z",
    derivation: { algorithm: "mb-osa- + first 40 lowercase hex characters of SHA-256(UTF-8 recipient DID)", hash: "sha256", hash_bits: 160, prefix: "mb-osa-", room_limit: 48 },
    limits: { maxRoomLength: 48, hashHexLength: 40, maxTextBytes: 1000, maxTtlMs: 86400000, maxClientMessageIdLength: 128, projection_limit: 1000, sync_room_limit: 100 },
    policy: { visibility: "public-unlisted", warning: "Mailbox content is public on Technocore. Never include secrets.", acknowledgement_field: "public_unlisted_acknowledged", accepted_frame_types: ["MESSAGE", "ACK"], sent_frame_types: ["MESSAGE"], authority: "none", signatures_mean: "authorship and integrity only", remote_execution: false, task_dispatch: false, session_spawning: false, workspace_creation: false, connector_spawning: false },
    senders: [{ agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local", mailbox_room: "mb-osa-browser-local" }],
    selected_sender: { agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local", mailbox_room: "mb-osa-browser-local" },
    recipients: [{ key: `federated:node-browser-remote:remote-coder:${browserMailboxRemoteDid}`, source: "federated", agent_id: "remote-coder", name: "Remote Coder", did: browserMailboxRemoteDid, node_id: "node-browser-remote", verified: true, stale: false, eligibility: "fresh_verified_capability_registry", mailbox_room: "mb-osa-browser-remote" }],
    sync: { room: "mb-osa-browser-local", generation: 0, last_seq: 7, source: "live", stale: false }, counts: { inbox: 1, outbox: 0, quarantine: 1 },
    inbox: [browserMailboxInbox], outbox: [], quarantine: [browserMailboxQuarantine]
  };
  const browserSubtaskLocalCoderDid = testTechnocoreDid;
  const browserSubtaskRoom = subtaskDelegationRoomForRecipient(browserSubtaskLocalCoderDid);
  const browserSubtaskIncoming = {
    id: "subtask-browser-incoming-1",
    kind: "incoming",
    state: "pending",
    delegation_id: "subtask-browser-delegation-1",
    task_id: "task-subtask-browser-1",
    room: browserSubtaskRoom,
    sender_agent_id: "remote-coder",
    sender_did: browserMailboxRemoteDid,
    sender_node_id: "node-browser-remote",
    sender_node_did: browserMailboxRemoteDid,
    recipient_agent_id: "technocore-specialist",
    recipient_did: testTechnocoreDid,
    recipient_node_id: "node-browser-local",
    recipient_node_did: testTechnocoreDid,
    required_capabilities: ["research", "synthesis"],
    task_text: "Browser subtask inbound task",
    task_preview: "Browser subtask inbound task",
    result_text: "",
    result_preview: "",
    request_hash: "a".repeat(64),
    created_at: "2026-09-05T10:30:00.000Z",
    updated_at: "2026-09-05T10:30:00.000Z",
    expiry: "2026-09-06T10:30:00.000Z",
    verified: true,
    local_confirmation: false,
    no_payment: true,
    no_settlement: true,
    authority: "none",
    provenance: { kind: "technocore", room: browserSubtaskRoom, seq: 9 }
  };
  const browserSubtaskQuarantine = {
    ...browserSubtaskIncoming,
    id: "subtask-browser-quarantine-1",
    kind: "quarantine",
    state: "quarantined",
    verified: false,
    task_text: "",
    task_preview: "",
    result_text: "",
    result_preview: "",
    rejection_reason: "signature_unverified",
    quarantine_reason: "signature_unverified"
  };
  const browserSubtaskOverview = {
    schema: "osa-subtask-delegation/1",
    version: 1,
    generated_at: "2026-09-05T10:30:00.000Z",
    policy: {
      visibility: "public-unlisted",
      warning: "Public/unlisted on Technocore.",
      authority: "none",
      no_payment: true,
      no_settlement: true,
      public_text_only: true,
      workspace_creation: true,
      connector_spawning: false,
      remote_execution: false,
    },
    semantics: {
      adapter: "osa-subtask-delegation/1",
      official_a2a_compatibility: "narrow profile only; not full official A2A HTTP/JSON-RPC compatibility",
      mailbox_transport: "deterministic mb-osa-* recipient rooms",
      signatures_mean: "authorship and integrity only",
      authority: "none",
      remote_execution: false,
      value_settlement: false,
    },
    status: {
      enabled: true,
      rooms: [browserSubtaskRoom],
      last_attempt_at: null,
      last_synced_at: null,
      last_scan_status: "live",
      last_error: null,
      discovered_count: 1,
      verified_count: 1,
      rejected_count: 1,
      local_count: 0,
      incoming_count: 1,
      outgoing_count: 0,
      result_count: 0,
      quarantine_count: 1,
    },
    senders: [{ agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local", node_did: null, mailbox_room: "mb-osa-browser-local", capabilities: ["research", "synthesis"], source: "local", verified: true, stale: false }],
    recipients: [
      { key: `local:node-browser-local:coder:${browserSubtaskLocalCoderDid}`, source: "local", agent_id: "coder", name: "Coder", did: browserSubtaskLocalCoderDid, node_id: "node-browser-local", node_did: null, verified: true, stale: false, eligibility: "local_verified_capability_match", capabilities: ["research", "synthesis"], mailbox_room: subtaskDelegationRoomForRecipient(browserSubtaskLocalCoderDid), provenance: { kind: "local", node_id: "node-browser-local" } },
      { key: `federated:node-browser-remote:remote-coder:${browserMailboxRemoteDid}`, source: "federated", agent_id: "remote-coder", name: "Remote Coder", did: browserMailboxRemoteDid, node_id: "node-browser-remote", node_did: browserMailboxRemoteDid, verified: true, stale: false, eligibility: "fresh_verified_capability_registry", capabilities: ["research", "synthesis"], mailbox_room: subtaskDelegationRoomForRecipient(browserMailboxRemoteDid), provenance: { kind: "technocore", room: browserSubtaskRoom, seq: 9 } }
    ],
    capability_options: ["research", "synthesis", "testing"],
    incoming: [browserSubtaskIncoming],
    outgoing: [],
    results: [],
    quarantine: [browserSubtaskQuarantine]
  };
  let browserSubtaskCreateBody = null;
  let browserSubtaskAcceptBody = null;
  let browserSubtaskPublishBody = null;
  let browserMailboxSendBody = null;
  let browserSharedCreateBody = null;
  let browserSharedNoteBody = null;
  let browserFederatedImportBody = null;
  const browserSharedRoom = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    workspace_id: "123e4567-e89b-42d3-a456-426614174000",
    room: "p-osa-ws-123e4567-e89b-42d3-a456-426614174000",
    session_id: "home-browser-shared-1",
    title: "Browser Shared Workspace",
    owner_node_id: "node-browser-local",
    owner_node_did: testTechnocoreDid,
    members: [{ source: "local", agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local" }],
    manifest_event_id: "1".repeat(64),
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:00:00.000Z",
    expires_at: "2026-09-12T10:00:00.000Z",
    publish_status: "sent",
    events: [{ event_id: "1".repeat(64), type: "OPEN", sender_did: testTechnocoreDid, created_at: "2026-09-05T10:00:00.000Z", verified: true, state: "accepted" }],
    event_count: 1,
    quarantine_count: 0,
  };
  const browserSharedOverview = {
    schema: "osa-shared-workspace/1",
    generated_at: "2026-09-05T10:00:00.000Z",
    policy: { visibility: "private-name-unlisted", warning: "Unlisted, not confidential", authority: "none", signatures_mean: "authorship and integrity only", remote_execution: false, files_shared: false, no_payment: true, no_settlement: true },
    limits: { maxWireBytes: 4096, maxTextBytes: 1200, maxTitleBytes: 120, maxMembers: 16, maxEvents: 500 },
    status: { enabled: true, room_count: 0, event_count: 0, quarantine_count: 0, last_scan_status: "idle" },
    workspaces: [{ id: "home-browser-shared-1", title: "Browser Shared Workspace", agent_id: "technocore-specialist", team_id: "home-room", team_name: "Home", status: "done" }],
    candidates: [{ key: `local:node-browser-local:technocore-specialist:${testTechnocoreDid}`, source: "local", agent_id: "technocore-specialist", name: "Technocore Specialist", did: testTechnocoreDid, node_id: "node-browser-local", verified: true, stale: false }],
    rooms: [],
  };
  const browserFederatedTask = {
    id: "fwb-browser-verified-1",
    kind: "task",
    state: "verified",
    importable: true,
    origin_node_id: "node-browser-remote",
    origin_node_did: null,
    origin_agent_id: "remote-coder",
    origin_agent_name: "Remote Coder",
    origin_agent_did: null,
    task_id: "task-browser-remote-1",
    goal_id: "goal-browser-remote-1",
    goal_title: "Remote browser goal",
    title: "Remote browser task",
    summary: "Inspect this remote task as public metadata only.",
    status: "open",
    task_type: "research",
    required_capabilities: ["research", "synthesis"],
    priority: 83,
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:01:00.000Z",
    last_seen_at: "2026-09-05T10:02:00.000Z",
    imported_session_id: null,
    imported_task_id: null,
    trust: { state: "verified", stale: false, verified: true, reason: "trusted_peer_snapshot" },
    identity_binding: { node_id: "node-browser-remote", node_did: null, agent_id: "remote-coder", agent_did: null, task_id: "task-browser-remote-1", goal_id: "goal-browser-remote-1" },
    provenance: { source: "osa-federation-snapshot", node_id: "node-browser-remote", observed_at: "2026-09-05T10:02:00.000Z", head: "head-browser", source_hash: "7".repeat(64) },
    authority: "inspect_only",
    remote_execution: false,
    connector_spawning: false,
    files_shared: false,
    no_payment: true,
    no_settlement: true,
    source_hash: "7".repeat(64),
  };
  const browserFederatedOverview = {
    schema: "osa-federated-workbench/1",
    version: 1,
    generated_at: "2026-09-05T10:03:00.000Z",
    policy: { visibility: "federated-public-task-metadata-only", authority: "inspect_only_until_explicit_local_import", signatures_mean: "trusted peer snapshots authenticate node provenance and integrity only", no_automatic_execution: true, remote_execution: false, connector_spawning: false, files_shared: false, no_payment: true, no_settlement: true },
    status: { enabled: true, stale_after_ms: 60000, task_count: 3, verified_count: 1, stale_count: 1, untrusted_count: 1, imported_count: 0, quarantine_count: 1, last_import_at: null, last_error: null },
    tasks: [
      browserFederatedTask,
      { ...browserFederatedTask, id: "fwb-browser-stale-1", state: "stale", importable: false, title: "Remote stale task", task_id: "task-browser-stale-1", trust: { state: "stale", stale: true, verified: false, reason: "stale" }, source_hash: "8".repeat(64), provenance: { ...browserFederatedTask.provenance, source_hash: "8".repeat(64) } },
      { ...browserFederatedTask, id: "fwb-browser-untrusted-1", state: "untrusted", importable: false, title: "Remote untrusted task", task_id: "task-browser-untrusted-1", trust: { state: "untrusted", stale: false, verified: false, reason: "federation_signature_verification_disabled" }, source_hash: "9".repeat(64), provenance: { ...browserFederatedTask.provenance, source_hash: "9".repeat(64) } },
    ],
    quarantine: [{ id: "fwbq-browser-1", kind: "quarantine", state: "quarantined", origin_node_id: "node-browser-remote", origin_node_did: null, reason: "stale_snapshot_rejected", first_seen_at: "2026-09-05T10:04:00.000Z", last_seen_at: "2026-09-05T10:04:00.000Z", authority: "none", remote_execution: false, connector_spawning: false, files_shared: false, no_payment: true, no_settlement: true }],
  };
  const browserSkillProvider = {
    id: `local:node-browser-local:coder:${testTechnocoreDid}`,
    source: "local",
    agent_id: "coder",
    name: "Coder",
    tagline: "Browser registry local coder",
    did: testTechnocoreDid,
    node_id: "node-browser-local",
    skills: ["coding", "testing"],
    eligible: true,
    verification: { verified: true, stale: false, state: "verified", label: "LOCAL VERIFIED", rejection_reason: null, note: "Signature verified; not an endorsement." },
    provenance: { kind: "local", kv_path: "/kv/osa-capabilities/coder", payload_hash: "a".repeat(64) },
    reputation: { status: "local_signed_record", label: "LOCAL SIGNED RECORD", verified: true, stale: false, counts: { accepted_results: 2, verified_job_results: 1, claimed_deals: 1, refunded_deals: 0, disputed_deals: 0, unique_counterparties: 1 }, note: "Not an endorsement." },
    authority: { kind: "local_workspace_profile", selectable_for_local_workspace: true, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, note: "Human selectable." },
  };
  const browserSkillRegistry = {
    schema: "osa-skill-registry/1",
    version: 1,
    generated_at: "2026-09-05T10:04:00.000Z",
    query: { raw: "", skills: [], source: "all", include_stale: false, include_untrusted: false },
    policy: { source_of_truth: "osa-capability-registry/1", reputation_context: "exact_node_agent_did_join", signature_meaning: "authorship_and_integrity_not_endorsement_or_skill_truth", default_visibility: "fresh_verified_claims_only", authority: "catalog_only", matching_phase: "Phase 5.2", remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
    status: { capability_scan: "live", capability_error: null, reputation_scan: "live", reputation_error: null, available_skill_count: 2, skill_count: 1, provider_count: 2, excluded: { untrusted: 1, stale: 0 } },
    available_skills: ["coding", "testing"],
    providers: [browserSkillProvider, { ...browserSkillProvider, id: `federated:node-browser-remote:remote-coder:${browserMailboxRemoteDid}`, source: "federated", agent_id: "remote-coder", name: "Remote Coder", tagline: "Browser registry remote coder", did: browserMailboxRemoteDid, node_id: "node-browser-remote", verification: { ...browserSkillProvider.verification, label: "SIGNATURE VERIFIED" }, provenance: { kind: "technocore", room: "credence", seq: 7, kv_path: "/kv/osa-capabilities/remote-coder", payload_hash: "b".repeat(64) }, reputation: { ...browserSkillProvider.reputation, status: "signed_record", label: "SIGNED REPUTATION CLAIM" }, authority: { ...browserSkillProvider.authority, kind: "catalog_only", selectable_for_local_workspace: false, note: "Catalog only." } }],
    skills: [{ id: "skill-browser-coding", schema: "osa-skill/1", version: 1, skill: "coding", label: "coding", provider_count: 2, eligible_provider_count: 2, local_provider_count: 1, federated_provider_count: 1, verified_provider_count: 2, stale_provider_count: 0, untrusted_provider_count: 0, reputation_evidence_count: 8, reputation_counts: { accepted_results: 4, verified_job_results: 2, claimed_deals: 2, refunded_deals: 0, disputed_deals: 0, unique_counterparties: 2 }, providers: [] }],
  };
  browserSkillRegistry.skills[0].providers = browserSkillRegistry.providers;
  await page.route("**/api/skill-registry**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserSkillRegistry) });
  });
  const browserMatchmaking = {
    schema: "osa-matchmaking/1",
    version: 1,
    generated_at: "2026-09-05T10:04:30.000Z",
    query: { job_id: null, include_claimed: false, include_stale: false, include_untrusted: false },
    policy: { source_of_truth: "osa-skill-registry/1 + canonical job views", matching: "deterministic_skill_overlap_trust_reputation_rank", signature_meaning: "authorship", authority: "recommendation_only", remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, settlement: false },
    status: { job_count: 1, matched_count: 1, partial_count: 0, no_match_count: 0, provider_count: 2, available_skill_count: 2, registry_schema: "osa-skill-registry/1" },
    matches: [{
      id: "match-browser-1",
      job: { id: "kibble:6001", source: "technocore", room: "kibble", seq: "6001", title: "Browser coding job", preview: "JOB v1: Browser coding job with testing", text_hash: "c".repeat(64), required_skills: ["coding", "testing"], observed_at: "2026-09-05T10:04:20.000Z", claimed: false },
      candidate_count: 2,
      top_score: 98,
      status: "matched",
      candidates: [
        { provider_id: browserSkillProvider.id, agent_id: "coder", name: "Coder", source: "local", node_id: "node-browser-local", did: browserSubtaskLocalCoderDid, score: 98, eligible: true, matched_skills: ["coding", "testing"], missing_skills: [], verification: { state: "verified", verified: true, stale: false, label: "LOCAL VERIFIED" }, reputation: { status: "local_signed_record", evidence_count: 4 }, authority: { kind: "local_selectable", selectable_for_local_workspace: true, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false }, reasons: ["matches coding, testing", "local profile"] },
        { provider_id: "federated:node-browser-remote:remote-coder", agent_id: "remote-coder", name: "Remote Coder", source: "federated", node_id: "node-browser-remote", did: browserMailboxRemoteDid, score: 92, eligible: true, matched_skills: ["coding", "testing"], missing_skills: [], verification: { state: "verified", verified: true, stale: false, label: "SIGNATURE VERIFIED" }, reputation: { status: "signed_record", evidence_count: 7 }, authority: { kind: "recommendation_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false }, reasons: ["federated catalog provider"] }
      ]
    }]
  };
  await page.route("**/api/matchmaking**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserMatchmaking) });
  });
  const browserFlopGpuProbe = { available: true, source: "fixture", error: null, gpus: [{ index: 0, name: "Browser RTX Fixture", memory_total_mb: 24576, driver_version: "999.99" }] };
  await page.route("**/api/flop/miner", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schema: "osa-flop-miner-console/1",
      version: 1,
      generated_at: "2026-09-08T14:30:00.000Z",
      yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["3", "4", "Appendix C"], summary: "Miners run attested inference, meter useful work, and settle only after verified receipts." },
      mode: "readiness_only",
      overall_status: "blocked",
      readiness_score: 42,
      compute: { gpu_probe: browserFlopGpuProbe, cpu_threads: 16, memory_total_gb: 64, memory_free_gb: 32, cuda_visible: false },
      lifecycle: [{ id: "onboard", label: "Onboard", state: "manual_required", detail: "Bond stake, calibrate hardware, and register model availability." }],
      readiness: [{ id: "gpu", label: "GPU visibility", status: "ready", detail: "1 NVIDIA GPU visible.", evidence: null }, { id: "wallet", label: "Wallet / stake", status: "blocked", detail: "Wallet verification and on-chain stake are required.", evidence: null }],
      authority: { kind: "readiness_console_only", gpu_leasing: false, miner_registration: false, model_registration: false, session_acceptance: false, connector_spawning: false, payment: false, settlement: false, note: "This dashboard view does not lease GPU capacity, register stake, accept sessions, or claim payouts." },
    })
  }));
  await page.route("**/api/flop/validator", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schema: "osa-flop-validator-console/1",
      version: 1,
      generated_at: "2026-09-08T14:31:00.000Z",
      yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["15"], summary: "Validators author blocks, finalize, attest miner proofs, and host DA." },
      mode: "readiness_only",
      overall_status: "blocked",
      readiness_score: 33,
      requirements: { self_stake_floor: "effective_minimum_stake; yellowpaper baseline 305,505 FLOP", min_self_stake_ratio: "20%", committee_gate: "recent verified PoUI work", heavy_duties: ["DA store-and-serve", "committee-keeping GPU work"] },
      compute: { gpu_probe: browserFlopGpuProbe, cpu_threads: 16, memory_total_gb: 64, memory_free_gb: 32, cuda_visible: false },
      lifecycle: [{ id: "register", label: "Register", state: "manual_required", detail: "Self-sign registration and freeze stake into ValidatorQueue." }],
      readiness: [{ id: "stake", label: "Stake floor", status: "blocked", detail: "On-chain stake bonding is not available from the dashboard.", evidence: null }],
      authority: { kind: "readiness_console_only", validator_registration: false, stake_bonding: false, block_authoring: false, finality_voting: false, attestation_signing: false, da_publishing: false, payment: false, settlement: false, note: "This dashboard view does not bond stake, join committees, author blocks, sign attestations, host DA, or move FLOP." },
    })
  }));
  await page.route("**/api/federated-workbench**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/federated-workbench") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserFederatedOverview) });
    }
    if (request.method() === "POST" && pathname.endsWith("/import")) {
      browserFederatedImportBody = request.postDataJSON();
      browserFederatedOverview.tasks = browserFederatedOverview.tasks.map((task) => task.id === browserFederatedTask.id ? { ...task, state: "imported", importable: false, imported_session_id: "session-browser-fwb-1", imported_task_id: "task-browser-fwb-1" } : task);
      browserFederatedOverview.status.imported_count = 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, idempotent_replay: false, task: { id: "task-browser-fwb-1" }, session: { id: "session-browser-fwb-1", title: "Remote browser task", team_id: "home-room", agent: "technocore-specialist" }, status: browserFederatedOverview }) });
    }
    return route.continue();
  });
  await page.route("**/api/shared-workspaces**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserSharedOverview) });
    if (pathname === "/api/shared-workspaces/scan") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserSharedOverview) });
    if (pathname === "/api/shared-workspaces") {
      browserSharedCreateBody = request.postDataJSON();
      browserSharedOverview.rooms = [browserSharedRoom];
      browserSharedOverview.status.room_count = 1;
      browserSharedOverview.status.event_count = 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, idempotent_replay: false, room: browserSharedRoom, status: browserSharedOverview }) });
    }
    if (pathname.endsWith("/notes")) {
      browserSharedNoteBody = request.postDataJSON();
      const note = { event_id: "2".repeat(64), type: "NOTE", sender_did: testTechnocoreDid, text: "Browser bounded shared note", created_at: "2026-09-05T10:05:00.000Z", verified: true, state: "accepted" };
      browserSharedRoom.events = [...browserSharedRoom.events, note];
      browserSharedRoom.event_count = 2;
      browserSharedOverview.status.event_count = 2;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, idempotent_replay: false, room: browserSharedRoom, event: note }) });
    }
    return route.continue();
  });
  await page.route("**/api/agent-mailboxes**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserMailboxOverview) });
    const body = request.postDataJSON();
    if (pathname.endsWith("/send")) {
      browserMailboxSendBody = body;
      const outbox = { ...browserMailboxInbox, id: "mailbox-out-browser-1", box: "outbox", sender: browserMailboxInbox.recipient, recipient: browserMailboxInbox.sender, text: body.text, client_message_id: body.client_message_id, delivery_status: "sent", envelope_hash: "9".repeat(64) };
      browserMailboxOverview.outbox = [outbox];
      browserMailboxOverview.counts.outbox = 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, idempotent_replay: false, message: outbox }) });
    }
    if (pathname.endsWith("/sync")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, source: "live", view: browserMailboxOverview }) });
    if (pathname.endsWith("/read")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: { ...browserMailboxInbox, read_at: "2026-09-05T10:01:00.000Z" } }) });
    return route.continue();
  });
  await page.route("**/api/subtask-delegations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/subtask-delegations") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserSubtaskOverview) });
    }
    if (request.method() === "POST" && pathname === "/api/subtask-delegations") {
      browserSubtaskCreateBody = request.postDataJSON();
      const recipientDid = String(browserSubtaskCreateBody.recipient_key || browserSubtaskLocalCoderDid).includes(browserMailboxRemoteDid) ? browserMailboxRemoteDid : browserSubtaskLocalCoderDid;
      const delegation = {
        id: "subtask-browser-outgoing-1",
        kind: "outgoing",
        state: "sent",
        delegation_id: "subtask-browser-outgoing-1",
        task_id: "task-subtask-browser-outgoing-1",
        room: subtaskDelegationRoomForRecipient(recipientDid),
        sender_agent_id: browserSubtaskCreateBody.sender_agent_id,
        sender_did: testTechnocoreDid,
        sender_node_id: "node-browser-local",
        recipient_agent_id: recipientDid === browserMailboxRemoteDid ? "remote-coder" : "coder",
        recipient_did: recipientDid,
        recipient_node_id: recipientDid === browserMailboxRemoteDid ? "node-browser-remote" : "node-browser-local",
        required_capabilities: browserSubtaskCreateBody.required_capabilities || [],
        task_text: browserSubtaskCreateBody.task_text,
        task_preview: browserSubtaskCreateBody.task_text,
        created_at: "2026-09-05T10:31:00.000Z",
        updated_at: "2026-09-05T10:31:00.000Z",
        expiry: browserSubtaskCreateBody.expiry,
        verified: true,
        local_confirmation: true,
        no_payment: true,
        no_settlement: true,
        authority: "none",
      };
      browserSubtaskOverview.outgoing = [delegation];
      browserSubtaskOverview.status.outgoing_count = 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, delegation, status: browserSubtaskOverview }) });
    }
    if (request.method() === "POST" && pathname === "/api/subtask-delegations/scan") {
      browserSubtaskOverview.status.last_scan_status = "live";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserSubtaskOverview) });
    }
    if (request.method() === "POST" && pathname.endsWith("/accept")) {
      browserSubtaskAcceptBody = request.postDataJSON();
      browserSubtaskOverview.incoming = [{ ...browserSubtaskIncoming, state: "result_ready", workspace_session_id: "session-browser-subtask-1", workspace_task_id: "task-browser-subtask-1", accepted_at: "2026-09-05T10:35:00.000Z", working_at: "2026-09-05T10:35:00.000Z", result_ready_at: "2026-09-05T10:38:00.000Z", result_text: "Browser authoritative completed result", result_preview: "Browser authoritative completed result", updated_at: "2026-09-05T10:38:00.000Z" }];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, delegation: browserSubtaskOverview.incoming[0], session_id: "session-browser-subtask-1", session: { id: "session-browser-subtask-1" }, task: { id: "task-browser-subtask-1" }, status: browserSubtaskOverview }) });
    }
    if (request.method() === "POST" && pathname.endsWith("/publish-result")) {
      browserSubtaskPublishBody = request.postDataJSON();
      browserSubtaskOverview.incoming = [{ ...browserSubtaskIncoming, state: "result_sent", workspace_session_id: "session-browser-subtask-1", workspace_task_id: "task-browser-subtask-1", result_text: "Browser subtask signed result", result_preview: "Browser subtask signed result", published_at: "2026-09-05T10:40:00.000Z", result_sent_at: "2026-09-05T10:40:00.000Z", updated_at: "2026-09-05T10:40:00.000Z" }];
      browserSubtaskOverview.results = [{ ...browserSubtaskIncoming, id: "subtask-browser-result-1", kind: "result", state: "result_sent", delegation_id: "subtask-browser-delegation-1", task_id: "task-browser-subtask-1", workspace_session_id: "session-browser-subtask-1", workspace_task_id: "task-browser-subtask-1", result_text: "Browser subtask signed result", result_preview: "Browser subtask signed result", verified: true, local_confirmation: true, no_payment: true, no_settlement: true, authority: "none" }];
      browserSubtaskOverview.status.result_count = 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, delegation: browserSubtaskOverview.incoming[0], task: { id: "task-browser-subtask-1" }, result: { id: "result-browser-subtask-1", taskId: "task-browser-subtask-1", agentId: "technocore-specialist", summary: "Browser subtask signed result" }, status: browserSubtaskOverview }) });
    }
    return route.continue();
  });
  await page.route("**/api/network/chat**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body?.message !== "Browser signed DID delivery") return route.continue();
      sentChatFixture = {
        id: "network-chat-browser-signed",
        node_id: "browser-fixture-node",
        wallet_address: testWalletAddress,
        message: body.message,
        created_at: "2026-09-02T05:30:00.000Z",
        source: "osa",
        external: false,
        untrusted: false,
        trusted: true,
        room: "osa-network",
        from: testTechnocoreDid,
        seq: 9001,
        signed: true,
        verified: true,
        delivery_status: "sent"
      };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, technocore_mirrored: true, message: sentChatFixture }) });
    }
    if (route.request().method() !== "GET") return route.continue();
    const requestedChannel = new URL(route.request().url()).searchParams.get("channel");
    if (requestedChannel === "validators") {
      delayedValidatorsReadCount += 1;
      if (delayedValidatorsReadCount <= 2) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) });
      }
      await delay(600);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [{
            id: "technocore-chat-validators-77",
            node_id: "technocore",
            message: "Delayed validators room fixture",
            created_at: "2026-09-02T05:31:00.000Z",
            source: "technocore",
            external: true,
            room: "validators",
            from: "validator-fixture",
            seq: 77
          }]
        })
      });
    }
    chatGetRequestCount += 1;
    if (chatGetRequestCount === 3) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{" });
    }
    const response = await route.fetch();
    const payload = await response.json();
    payload.messages = [...(payload.messages || []), {
      id: browserA2AObservation.id,
      node_id: "technocore",
      wallet_address: null,
      message: "A2A/1 MESSAGE · 1 part · frame-browser-a2a-1",
      created_at: "2026-09-02T05:32:00.000Z",
      source: "technocore",
      external: true,
      untrusted: false,
      trusted: true,
      room: "osa-network",
      from: testTechnocoreDid,
      seq: 92,
      signed: true,
      verified: true,
      delivery_status: "sent",
      a2a: browserA2AObservation
    }];
    if (sentChatFixture) {
      payload.messages.push({ ...sentChatFixture, id: "technocore-chat-osa-network-9001", source: "technocore", external: true });
    }
    return route.fulfill({ response, json: payload });
  });
  await page.route("**/api/network/channels**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.channels = (payload.channels || []).map((channel) => channel.id === "validators"
      ? { ...channel, count: 12, topic: "Signed validation, attestations, and DID verification." }
      : channel);
    return route.fulfill({ response, json: payload });
  });
  await page.route("**/api/protocol/overview", async (route) => {
    if (!protocolAcceptMockEnabled) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "paper-rehearsal",
        writes_enabled: true,
        generated_at: "2026-09-04T08:00:00.000Z",
        identity: { node_did: testTechnocoreDid, signed_messages: true },
        transport: { enabled: true, url: "https://technocore.example", public_room: "osa-network" },
        archive: { persisted: true, record_count: 1, limit: 2000 },
        layers: [],
        timeline: [],
        a2a: browserA2AOverview,
        paper: { enabled: true, rail: "paper", asset: "FLOP", has_value: false, stages: [], deals: [] },
        tclk: {
          version: "tclk/1",
          offer_room: "tclk-offers",
          mode: "paper-rehearsal",
          value_settlement_enabled: false,
          warning: "PaperRail only",
          observed_message_count: 1,
          valid_frame_count: 1,
          invalid_frame_count: 0,
          offers: [{
            id: "offer-browser-tclk",
            status: "proposed",
            expired: false,
            from: "did:key:z6MkBrowserOfferor111111111111111111111111111111111",
            role: "payer",
            amount: "88",
            asset: "FLOP",
            lock: "hash",
            rails: ["paper"],
            job: { proto: "kibble", id: "browser-job", context: "Browser accept workspace fixture" },
            expires_at: "2026-09-04T08:10:00.000Z",
            claim_by: "2026-09-04T08:30:00.000Z",
            refund_after: "2026-09-04T09:00:00.000Z",
            observed_at: "2026-09-04T08:00:00.000Z",
            sequence: 77,
            verified: true
          }]
        }
      })
    });
  });
  await page.route("**/api/protocol/a2a", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserA2AOverview) }));
  await page.route("**/api/protocol/offers/accept", async (route) => {
    if (!protocolAcceptMockEnabled) return route.continue();
    protocolAcceptMockEnabled = false;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "offer-browser-tclk",
        label: "Browser accepted TCLK deal",
        status: "accepted",
        mode: "paper-rehearsal",
        rail: "paper",
        has_value: false,
        amount: "88",
        asset: "FLOP",
        payer_did: "did:key:z6MkBrowserOfferor111111111111111111111111111111111",
        counterparty_did: "did:key:z6MkBrowserOfferor111111111111111111111111111111111",
        local_agent_id: "technocore-specialist",
        local_agent_did: testTechnocoreDid,
        contract_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        deal_room: "mb-p-tclk-aaaaaaaaaaaa",
        workspace_session_id: browserTclkSession.id,
        receipt_recorded: false,
        next_action: "lock",
        created_at: "2026-09-04T08:00:00.000Z",
        updated_at: "2026-09-04T08:00:00.000Z",
        timeline: []
      })
    });
  });
  await page.route(`**/api/sessions/${browserTclkSession.id}`, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(browserTclkSession) }));
  await page.route("**/api/sessions/session-browser-subtask-1", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...browserTclkSession, id: "session-browser-subtask-1", title: "Browser subtask workspace", agent: "coder", status: "done" }),
  }));
  await page.route("**/api/sessions/session-browser-fwb-1", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...browserTclkSession, id: "session-browser-fwb-1", title: "Remote browser task", agent: "technocore-specialist", team_id: "home-room", connector_status: "disconnected" }),
  }));
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.runtime = {
      ...(payload.runtime || {}),
      technocoreEnabled: true,
      technocoreSignedMessages: true,
      technocoreDid: testTechnocoreDid
    };
    await route.fulfill({ response, json: payload });
  });
  await page.addInitScript((walletAddress) => {
    window.__OSA_E2E_WALLET_ADDRESS__ = walletAddress;
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts") return [window.__OSA_E2E_WALLET_ADDRESS__];
        if (method === "eth_chainId") return "0x1";
        if (method === "personal_sign") return window.osaE2eSignPersonalMessage(params?.[0] || "");
        return null;
      }
    };
    localStorage.setItem("osa-openclaw-onboarding-dismissed", "1");
    if (!localStorage.getItem("osa-workbench-v2")) {
      localStorage.setItem("osa-workbench-v2", JSON.stringify({
        version: 2,
        teams: [
          { id: "home-room", color: "blue", name: "Home", items: [] },
          { id: "public-room", color: "purple", name: "Public", items: [] },
          { id: "public-rooms-room", color: "orange", name: "Public Rooms", items: [] },
          { id: "public-projects-room", color: "orange", name: "Latest Projects", items: [] }
        ]
      }));
    }
  }, testWalletAddress);

  await page.goto(`${baseUrl}/osa-network/`, { waitUntil: "domcontentloaded" });
  await expectText(page, "body", "Connect Wallet");
  await expectText(page, "body", "Wallet identity required");
  await expectText(page, "body", "$FLOP is not live yet");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Project Network");
  await expectText(page, "body", "Miner");
  await expectText(page, "body", "Validator");
  await expectText(page, "body", "Market");
  await expectText(page, "body", "Deals");
  await expectText(page, "body", "Network");
  await expectText(page, "body", "Trust & Vault");
  await expectText(page, "body", "osa-network");
  await expectText(page, "body", "DID");
  await expectText(page, "body", "z6MkvG");
  assert(await page.getByRole("button", { name: "Copy" }).count() >= 1, "topbar should expose a copyable DID when signing is active");
  await page.getByRole("button", { name: "Miner", exact: true }).click();
  await expectText(page, '[data-testid="flop-miner-panel"]', "Browser RTX Fixture");
  await expectText(page, '[data-testid="flop-miner-panel"]', "NO GPU LEASING");
  assert(!(await page.getByTestId("flop-miner-panel").innerText()).match(/privateKey|PRIVATE KEY|seed|secret|signature|\/home|\/tmp/i), "Miner UI should not render secrets or filesystem paths");
  await page.getByRole("button", { name: "Validator", exact: true }).click();
  await expectText(page, '[data-testid="flop-validator-panel"]', "305,505 FLOP");
  await expectText(page, '[data-testid="flop-validator-panel"]', "NO STAKE BONDING");
  assert(!(await page.getByTestId("flop-validator-panel").innerText()).match(/privateKey|PRIVATE KEY|seed|secret|signature|\/home|\/tmp/i), "Validator UI should not render secrets or filesystem paths");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expectText(page, "body", "Network");
  await expectText(page, '[data-testid="shared-workspaces"]', "Shared Workspace Rooms");
  await page.getByRole("checkbox", { name: "Acknowledge shared room disclosure" }).check();
  await page.getByRole("button", { name: "Review team room" }).click();
  await expectText(page, '[data-testid="shared-workspaces"]', "Open signed shared room?");
  assert(browserSharedCreateBody === null, "shared Workspace UI must not create a room before the second explicit confirmation");
  await page.getByRole("button", { name: "Confirm and open" }).click();
  await expectText(page, '[data-testid="shared-workspaces"]', "p-osa-ws-123e4567-e89b-42d3-a456-426614174000");
  assert(browserSharedCreateBody?.private_room_warning_acknowledged === true && browserSharedCreateBody?.share_confirmation === true, "shared Workspace UI should acknowledge unlisted visibility and confirm room creation");
  assert(!browserSharedCreateBody?.files && !browserSharedCreateBody?.commands && !browserSharedCreateBody?.task_text, "shared Workspace creation must not send files, commands, or Workspace task content");
  await page.getByRole("combobox", { name: "Room note signer" }).selectOption("technocore-specialist");
  await page.getByRole("textbox", { name: "Shared room note" }).fill("Browser bounded shared note");
  await page.getByRole("checkbox", { name: "Acknowledge shared note disclosure" }).check();
  await page.getByRole("button", { name: "Review signed note" }).click();
  assert(browserSharedNoteBody === null, "shared Workspace note must wait for the second explicit confirmation");
  await page.getByRole("button", { name: "Confirm and publish" }).first().click();
  await expectText(page, '[data-testid="shared-workspaces"]', "Browser bounded shared note");
  assert(browserSharedNoteBody?.publish_confirmation === true && browserSharedNoteBody?.private_room_warning_acknowledged === true, "shared Workspace notes require explicit bounded publication confirmation");
  await expectText(page, "body", "Agent Mailboxes");
  await expectText(page, '[data-testid="agent-mailboxes"]', "PUBLIC / UNLISTED ON TECHNOCORE");
  await expectText(page, '[data-testid="agent-mailboxes"]', "Verified browser mailbox inbox message");
  await page.getByRole("textbox", { name: "Mailbox message" }).fill("Browser mailbox public confirmation message");
  await page.getByRole("checkbox", { name: "Acknowledge public unlisted mailbox" }).check();
  await page.getByRole("button", { name: "Review public send" }).click();
  await expectText(page, '[data-testid="agent-mailboxes"]', "Confirm public send");
  assert(browserMailboxSendBody === null, "mailbox UI must not send before the second explicit confirmation");
  await page.getByRole("button", { name: "Confirm and publish" }).click();
  await expectText(page, '[data-testid="agent-mailboxes"]', "Browser mailbox public confirmation message");
  assert(browserMailboxSendBody?.public_unlisted_acknowledged === true && browserMailboxSendBody?.sender_did === testTechnocoreDid, "mailbox UI should send the exact managed DID tuple and explicit public acknowledgement");
  assert(!browserMailboxSendBody?.room && !browserMailboxSendBody?.task_id && !browserMailboxSendBody?.command, "mailbox UI must not choose arbitrary rooms or dispatch tasks/commands");
  await page.locator('[data-testid="agent-mailboxes"]').getByRole("button", { name: "Quarantine (1)" }).click();
  await expectText(page, '[data-testid="agent-mailboxes"]', "Quarantined: signature_unverified");
  await expectText(page, '[data-testid="agent-mailboxes"]', "UNTRUSTED");
  await page.getByRole("button", { name: "Inbox (1)" }).click();
  await page.getByRole("button", { name: "Reply safely" }).click();
  await expectText(page, '[data-testid="agent-mailboxes"]', "Replying to verified message");
  assert(!(await page.getByTestId("agent-mailboxes").innerText()).match(/BEGIN PRIVATE KEY|pkcs8|signature:\s*[A-Za-z0-9_-]{32,}|osa_conn_/i), "mailbox UI must not render secrets, raw signatures, or connector tokens");
  await page.evaluate(() => {
    window.__subtaskClaims = [];
    window.addEventListener("osa:claim-job", (event) => {
      window.__subtaskClaims.push(event.detail);
    });
  });
  await page.getByRole("textbox", { name: "Subtask text" }).fill("Browser subtask delegation text");
  await page.getByRole("checkbox", { name: "Acknowledge public subtask warning" }).check();
  await page.getByRole("checkbox", { name: "Acknowledge delegate task confirmation" }).check();
  await page.getByRole("button", { name: "Review delegation" }).click();
  await expectText(page, "body", "Confirm public / unlisted delegation");
  assert(browserSubtaskCreateBody === null, "subtask UI must not send before the second explicit confirmation");
  await page.getByRole("button", { name: "Confirm and delegate" }).click();
  await expectText(page, '[data-testid="subtask-delegations"]', "Delegation subtask-browser-outgoing-1 queued for deterministic mailbox delivery.");
  assert(browserSubtaskCreateBody?.public_confirmation === true && browserSubtaskCreateBody?.delegate_task_confirmation === true && browserSubtaskCreateBody?.no_payment === true && browserSubtaskCreateBody?.no_settlement === true, "subtask UI should send only bounded public/no-value fields");
  assert(!browserSubtaskCreateBody?.room && !browserSubtaskCreateBody?.task_id && !browserSubtaskCreateBody?.command && !browserSubtaskCreateBody?.files, "subtask UI must not choose arbitrary rooms or dispatch tasks/files/commands");
  await page.locator('[data-testid="subtask-delegations"]').getByRole("button", { name: "Quarantine (1)" }).click();
  await expectText(page, '[data-testid="subtask-delegations"]', "Quarantine: signature_unverified");
  await expectText(page, '[data-testid="subtask-delegations"]', "UNVERIFIED");
  await page.locator('[data-testid="subtask-delegations"]').getByRole("button", { name: "Incoming (1)" }).click();

  await page.getByRole("button", { name: "Accept into Workspace" }).click();
  await expectText(page, "body", "Confirm accept into Workspace");
  await page.getByRole("button", { name: "Confirm and accept" }).click();
  await page.waitForFunction(() => Array.isArray(window.__subtaskClaims) && window.__subtaskClaims.some((item) => item.sessionId === "session-browser-subtask-1"));
  assert(browserSubtaskAcceptBody?.public_confirmation === true && browserSubtaskAcceptBody?.accept_confirmation === true, "accept flow should require the explicit confirmations");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expectText(page, '[data-testid="subtask-delegations"]', "Authoritative completed result preview");
  await expectText(page, '[data-testid="subtask-delegations"]', "Browser authoritative completed result");
  await page.getByRole("button", { name: "Publish signed result" }).click();
  await expectText(page, "body", "Confirm publish signed result");
  assert(browserSubtaskPublishBody === null, "result UI must not publish before the second explicit confirmation");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/subtask-delegations/subtask-browser-delegation-1/publish-result") && response.status() === 201),
    page.getByRole("button", { name: "Confirm and publish" }).click(),
  ]);
  assert(browserSubtaskPublishBody?.public_confirmation === true && browserSubtaskPublishBody?.publish_confirmation === true, "result publish should require explicit confirmation");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await page.locator('[data-testid="subtask-delegations"]').getByRole("button", { name: "Results (1)" }).click();
  await expectText(page, '[data-testid="subtask-delegations"]', "Browser subtask signed result");
  assert(!browserSubtaskPublishBody?.result_text && !browserSubtaskPublishBody?.files && !browserSubtaskPublishBody?.secret, "result publish UI must send only the authoritative-result selector and confirmations");
  console.log("Subtask delegation browser flow passed.");

  await page.getByRole("button", { name: "Deals", exact: true }).click();
  await page.getByRole("button", { name: "Accept Offer" }).click();
  await expectText(page, "body", "Browser TCLK workspace");
  assert((await getJson("/api/sessions")).some((session) => session.id === browserTclkSession.id) === false, "browser Accept test should not require a real backend task fixture");
  const chatWindow = page.getByTestId("network-chat-window");
  const initialChatBox = await chatWindow.boundingBox();
  assert(initialChatBox && initialChatBox.width >= 640 && initialChatBox.height >= 680, "network chat should open as a larger default window");
  await expectText(page, '[data-testid="network-chat-room-info"]', "OpenSwarmAgents: signed project announcements");
  const resizeHandle = page.getByTestId("network-chat-resize");
  const resizeBox = await resizeHandle.boundingBox();
  assert(resizeBox, "network chat should expose a resize handle");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 120, resizeBox.y + resizeBox.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const resizedChatBox = await chatWindow.boundingBox();
  assert(
    resizedChatBox && resizedChatBox.width > initialChatBox.width + 80 && resizedChatBox.height > initialChatBox.height + 20,
    "network chat should be resizable by dragging the corner handle"
  );
  const chatMessages = page.getByTestId("network-chat-messages");
  await expectText(page, '[data-testid="network-chat-messages"]', "Search marker 12");
  for (let attempt = 0; attempt < 24 && chatGetRequestCount < 4; attempt += 1) await delay(250);
  assert(chatGetRequestCount >= 4, "network chat polling should recover after a transient third refresh failure");
  assert(await page.getByRole("checkbox", { name: "Slow mode" }).isChecked(), "network chat slow mode should be enabled by default");
  assert(
    await chatMessages.evaluate((element) => getComputedStyle(element).overflowY === "scroll" && element.scrollHeight > element.clientHeight),
    "network chat messages should have a stable, scrollable viewport"
  );
  assert(
    await chatMessages.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight <= 2),
    "network chat should initially follow the newest message"
  );
  await chatMessages.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const newestButton = page.getByRole("button", { name: "Jump to newest message" });
  await newestButton.waitFor();
  assert(
    await chatMessages.evaluate((element) => element.scrollTop === 0),
    "manual upward scrolling should pause newest-message following"
  );
  await newestButton.click();
  await newestButton.waitFor({ state: "hidden" });
  assert(
    await chatMessages.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight <= 2),
    "Newest should jump to the bottom and resume following"
  );
  assert(/\d{1,2}:\d{2}:\d{2}/.test(await chatMessages.innerText()), "network chat timestamps should include seconds");
  await page.getByRole("textbox", { name: "Search messages" }).fill("Search marker 07");
  await expectText(page, '[data-testid="network-chat-messages"]', "Search marker 07");
  assert(!(await chatMessages.innerText()).includes("Search marker 08"), "message search should filter the cached channel messages");
  await page.getByRole("textbox", { name: "Search messages" }).fill("");
  const chatPollCountBeforeSend = chatGetRequestCount;
  await page.getByPlaceholder("Message osa-network").fill("Browser signed DID delivery");
  await page.getByRole("button", { name: "Send" }).click();
  await expectText(page, '[data-testid="network-chat-messages"]', "Browser signed DID delivery");
  for (let attempt = 0; attempt < 24 && chatGetRequestCount <= chatPollCountBeforeSend; attempt += 1) await delay(250);
  assert(chatGetRequestCount > chatPollCountBeforeSend, "network chat should reconcile the sent record with a later room poll");
  assert(await chatMessages.getByText("Browser signed DID delivery", { exact: true }).count() === 1, "a signed osa-network message and its Technocore mirror should render only once");
  await expectText(page, '[data-testid="network-chat-messages"]', "z6MkvG23xu...");
  await expectText(page, '[data-testid="network-chat-messages"]', "verified DID");
  await page.getByRole("button", { name: "A2A only" }).click();
  await expectText(page, '[data-testid="network-chat-messages"]', "A2A/1 MESSAGE");
  await expectText(page, '[data-testid="network-chat-messages"]', "Inspect A2A frame");
  await page.getByRole("button", { name: "All" }).click();
  await page.getByRole("button", { name: "#" }).click();
  await expectText(page, "body", "Main channels");
  await expectText(page, "body", "Other channels");
  await expectText(page, "body", "builders");
  await page.getByRole("textbox", { name: "Search channels" }).fill("validators");
  await expectText(page, "body", "validators");
  assert(await page.getByRole("button", { name: /builders/i }).count() === 0, "channel search should filter the # channel picker");
  await page.getByRole("button", { name: /validators/i }).click();
  await expectText(page, '[data-testid="network-chat-room-info"]', "Signed validation, attestations, and DID verification.");
  for (let attempt = 0; attempt < 30 && delayedValidatorsReadCount < 2; attempt += 1) await delay(50);
  assert(delayedValidatorsReadCount >= 2, "busy-room loading fixture should return two transient empty reads");
  await expectText(page, '[data-testid="network-chat-messages"]', "Loading validators...");
  assert(!(await chatMessages.innerText()).includes("No cached messages in validators."), "a populated indexed room should not flash an empty state while its tail is loading");
  await expectText(page, '[data-testid="network-chat-messages"]', "Delayed validators room fixture");
  await expectText(page, "body", "Canvas");
  await expectText(page, "body", "Start a desk to show project results.");
  await page.locator('button[title="Minimize chat"]').click();
  await page.getByRole("button", { name: "Trust & Vault" }).click();
  await expectText(page, "body", "Capability Registry");
  await expectText(page, "body", "Local Agents");
  await expectText(page, "body", "technocore-specialist");
  await expectText(page, "body", "VERIFIED");
  await expectText(page, "body", "Delegation Notes");
  await expectText(page, "body", "Remote notes are informational only and never grant authority or execution rights");
  await expectText(page, "body", "Publishing and revoking are explicit authenticated human actions");
  await page.getByRole("button", { name: "Create local draft" }).click();
  await expectText(page, "body", "DRAFT · NOT PUBLIC");
  await page.getByRole("button", { name: "Publish note" }).click();
  await expectText(page, "body", "This publishes a dual-signed public KV note");
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await page.getByRole("button", { name: "Revoke note" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Revoke note" }).click();
  await expectText(page, "body", "Revocation publishes a superseding signed revision");
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await expectText(page, "body", "REVOKED");
  assert(!(await page.locator("body").innerText()).match(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}|\bsig\b/i), "Vault registry UI should not render raw signatures or signing material");
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expectText(page, '[data-testid="skill-registry"]', "Skill Registry");
  await expectText(page, '[data-testid="skill-registry"]', "Remote Coder");
  await expectText(page, '[data-testid="skill-registry"]', "CATALOG ONLY");
  await expectText(page, '[data-testid="skill-registry"]', "NO AUTO-BID");
  assert(!(await page.getByTestId("skill-registry").innerText()).match(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}/i), "Skill Registry UI should not render raw signatures or signing material");
  await expectText(page, '[data-testid="matchmaking"]', "Matchmaking");
  await expectText(page, '[data-testid="matchmaking"]', "Browser coding job");
  await expectText(page, '[data-testid="matchmaking"]', "Coder");
  await expectText(page, '[data-testid="matchmaking"]', "RECOMMENDATION ONLY");
  await expectText(page, '[data-testid="matchmaking"]', "NO AUTO-BID");
  assert(!(await page.getByTestId("matchmaking").innerText()).match(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}|\/home|\/tmp|[A-Za-z]:\\/i), "Matchmaking UI should not render signatures, key material, or filesystem paths");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expectText(page, '[data-testid="federated-workbench"]', "Federated Workbench");
  await expectText(page, '[data-testid="federated-workbench"]', "Remote browser task");
  await expectText(page, '[data-testid="federated-workbench"]', "VERIFIED");
  assert(!(await page.getByTestId("federated-workbench").innerText()).match(/privateKey|PRIVATE KEY|seed|pkcs8|signature:\s*[A-Za-z0-9_-]{32,}|\/home|\/tmp|[A-Za-z]:\\/i), "Federated Workbench UI should not render signatures, key material, or filesystem paths");
  await page.locator('[data-testid="federated-workbench"]').getByRole("button", { name: "Stale (1)" }).click();
  await expectText(page, '[data-testid="federated-workbench"]', "Remote stale task");
  await page.locator('[data-testid="federated-workbench"]').getByRole("button", { name: "Untrusted (1)" }).click();
  await expectText(page, '[data-testid="federated-workbench"]', "Remote untrusted task");
  await page.locator('[data-testid="federated-workbench"]').getByRole("button", { name: "Quarantine (1)" }).click();
  await expectText(page, '[data-testid="federated-workbench"]', "stale_snapshot_rejected");
  await page.locator('[data-testid="federated-workbench"]').getByRole("button", { name: "Verified (1)" }).click();
  await page.getByRole("button", { name: "Review import" }).click();
  assert(browserFederatedImportBody === null, "Federated Workbench UI must not import before the second explicit confirmation");
  await expectText(page, "body", "Import verified task into Home?");
  await page.getByRole("button", { name: "Confirm import" }).click();
  assert(browserFederatedImportBody?.confirmation === "import-federated-task" && browserFederatedImportBody?.idempotency_key, "Federated Workbench import should send only explicit confirmation and idempotency");
  assert(!browserFederatedImportBody?.command && !browserFederatedImportBody?.files && !browserFederatedImportBody?.connector && !browserFederatedImportBody?.payment, "Federated Workbench import UI must not send command/file/connector/payment fields");
  await expectText(page, "body", "Remote browser task");
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expectText(page, "body", "Find Agent by Skill");
  await page.getByRole("combobox", { name: "Skill search" }).fill("coding");
  await page.getByRole("button", { name: "Find Agents" }).click({ force: true });
  await expectText(page, '[data-testid="skill-finder"]', "Coder");
  await expectText(page, '[data-testid="skill-finder"]', "LOCAL VERIFIED");
  await expectText(page, '[data-testid="skill-finder"]', "SIGNED ≠ ENDORSED");
  assert(!(await page.getByTestId("skill-finder").innerText()).match(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}/i), "Skill Finder UI should not render raw signatures or signing material");
  await page.getByRole("button", { name: "Use Coder in Workspace" }).click({ force: true });
  await page.getByTestId("skill-finder").waitFor({ state: "detached" });
  assert(await page.getByTestId("skill-finder").count() === 0, "Using a local skill match should return to the existing pending Workspace flow");
  await page.waitForFunction(() => document.querySelector("textarea") === document.activeElement, null, { timeout: 1500 });
  assert(await page.locator("textarea").first().evaluate((element) => element === document.activeElement), "Skill Finder should focus the selected pending desk without starting work automatically");
  await page.getByRole("button", { name: "Workspaces / Projects" }).click();
  await page.locator('button[title="Collapse canvas"]').click();
  await page.locator('button[title="Open result canvas"]').click();
  await page.locator('button[title="Settings"]').click();
  assert(await page.locator('input[type="number"]').first().inputValue() === "600", "manager patrol interval should default to 600 seconds");
  await page.locator('button[title="Settings"]').click();
  await page.locator('[title="Manager actions"]').first().click();
  await expectText(page, "body", "Run");
  await expectText(page, "body", "View");
  await page.getByRole("button", { name: "View" }).click();
  await expectText(page, "body", "Manager Audits");
  await page.locator('button[title="Close manager audits"]').click();
  let bodyText = await page.locator("body").innerText();
  assert(!bodyText.includes("Top100 AI Agents"), "agent charts should not render");
  assert(!bodyText.includes("Top100 Rooms"), "room charts should not render");
  assert(!bodyText.includes("Public Rooms"), "legacy Public Rooms should not render");
  assert(!bodyText.includes("Agent Chain"), "old Agent Chain label should not render");
  assert(bodyText.includes("$FLOP"), "topbar should label the prelaunch FLOP status clearly");
  assert(bodyText.includes("Prelaunch"), "topbar should show the honest FLOP prelaunch state");
  assert(!bodyText.includes("0 OSA"), "topbar should not present a retired OSA token balance");
  assert(bodyText.includes("Save Project"), "project save control should replace Load Desk/Snapshots");
  assert(!bodyText.includes("Save/Load Project"), "topbar should not expose the old Save/Load Project wording");
  assert(!bodyText.includes("Snapshots"), "topbar should not expose the old snapshots wording");
  assert(!bodyText.includes("Load desk"), "topbar should not expose the old Load desk wording");
  assert(!(await page.locator("body").innerText()).includes("Open agent voting quality benchmark"), "legacy example tasks should not render");
  assert(await page.getByRole("button", { name: "Copy" }).count() > 0, "Public example project should expose Copy for testing");
  assert(await page.locator('button[title="Delete this room"]').count() === 0, "Home/Latest Projects should not be removable");
  await page.getByRole("button", { name: "+ Workspace" }).click();
  await expectText(page, "body", "Room 1");
  assert(await page.locator('button[title="Delete this room"]').count() === 1, "custom rooms should expose a remove control");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('button[title="Delete this room"]').click();
  await page.locator("body").filter({ hasNotText: "Room 1" }).waitFor({ state: "visible" });

  const created = await postJson("/api/sessions/new", {
    content: "Build a small market-research agent for weird profitable niches.",
    team_id: "home-room",
    agent: "moneymaker"
  });
  assert(created.session_id?.startsWith("home-"), "new AgentGUI sessions should start in Home");
  const audit = await postJson(`/api/sessions/${encodeURIComponent(created.session_id)}/audit`, {});
  assert(audit.summary?.total > 0, "manager audit should return visible feedback criteria");
  assert(audit.results?.some((item) => item.criterion === "Feedback location is clear"), "manager audit should explain where feedback is visible");
  const managerAudits = await getJson("/api/manager/audits?limit=20");
  assert(managerAudits.audits?.some((item) => item.session_id === created.session_id), "fresh manager audits should be saved to the manager audit history");
  const completed = await waitForJson(
    "/api/sessions",
    (items) => items.find((session) => session.id === created.session_id && session.task_solved === true),
    "completed Home session to stay visible"
  );
  assert(completed.ended_at, "completed Home session should expose an end timestamp");

  const roomCreated = await postJson("/api/sessions/new", {
    content: "Create a compact launch plan for a private room.",
    team_id: "room-launch",
    team_name: "Launch"
  });
  assert(roomCreated.session?.team_id === "room-launch", "private room sessions should keep their team id");
  assert(roomCreated.session?.agent === "technocore-specialist", "sessions without an explicit agent should use Technocore Specialist");
  assert(roomCreated.session?.agent_model === "OpenClaw local agent", "Technocore Specialist should run through OpenClaw in AgentGUI");
  const coderFallback = await postJson("/api/sessions/new", {
    content: "Test the default Coder desk through OpenClaw.",
    team_id: "home-room",
    agent: "coder"
  });
  assert(coderFallback.session?.agent === "coder", "Coder profile should remain selected");
  assert(coderFallback.session?.agent_model === "OpenClaw local agent", "Coder should run through OpenClaw in AgentGUI");
  await waitForJson(
    "/api/sessions",
    (items) => items.find((session) => session.id === coderFallback.session_id && session.task_solved === true),
    "Coder session to complete through OpenClaw"
  );
  await page.evaluate(({ createdId, roomId, coderId }) => {
    localStorage.setItem("osa-workbench-v2", JSON.stringify({
      version: 2,
      teams: [
        {
          id: "home-room",
          color: "blue",
          name: "Home",
          items: [
            { type: "session", id: createdId },
            { type: "session", id: coderId }
          ]
        },
        {
          id: "room-launch",
          color: "green",
          name: "Launch",
          items: [{ type: "session", id: roomId }]
        },
        { id: "public-projects-room", color: "orange", name: "Latest Projects", items: [] }
      ]
    }));
  }, {
    createdId: created.session_id,
    roomId: roomCreated.session_id,
    coderId: coderFallback.session_id
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Home");
  await expectText(page, "body", "Launch");
  await expectText(page, "body", "Build a small market-research agent");
  await expectText(page, "body", "Create a compact launch plan");
  await expectText(page, "body", "Test the default Coder desk");

  const legacyShare = await postJsonAllowError(`/api/sessions/${encodeURIComponent(created.session_id)}/share`, { shared: true });
  assert(legacyShare.status === 410, "individual agent sharing should be retired");

  const walletAddress = testWalletAddress;
  const wallet = await signedWalletLogin(walletAddress, "0x1");
  assert(wallet.wallet?.address === walletAddress, "wallet login should store the connected pubkey");
  const legacyRoomShare = await postJsonAllowError("/api/public/rooms/share", {
    team_id: "room-launch",
    team_name: "Launch",
    shared: true
  });
  assert(legacyRoomShare.status === 410, "room sharing should be retired");

  const projectShare = await postJson("/api/public/projects/share", {
    name: "Browser E2E Project",
    owner_wallet_address: walletAddress,
    share_file_repo: true,
    technocore_channels: ["osa-network"],
    rooms: [
      { id: "home-room", name: "Home" },
      { id: "room-launch", name: "Launch" }
    ]
  });
  assert(projectShare.project?.id?.startsWith("public-project-"), "projects should be shareable");
  const projectId = projectShare.project.id.replace("public-project-", "");
  assert(projectId !== "project-local", "shared project ids should be scoped to the publishing node");
  let topProjects = await getJson("/api/top-projects?limit=100");
  const sharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(sharedProject?.rank >= 1, "Top100 Projects should rank shared projects");
  assert(sharedProject?.summary?.includes("File Repo"), "shared projects should remember whether the File Repo was included");
  const projectCopy = await postJson(`/api/sessions/${encodeURIComponent(projectShare.project.id)}/copy`, {});
  assert(projectCopy.session_ids?.length >= 2, "copying a Public Project should copy multiple agents");
  topProjects = await getJson("/api/top-projects?limit=100");
  const copiedSharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(copiedSharedProject?.copy_count === 1, "Top100 Projects should count project copies");
  assert(copiedSharedProject?.donation_total_flop === 0, "Top100 Projects should expose FLOP pledge totals");
  const pledge = await postJson("/api/donations", {
    session_id: projectShare.project.id,
    target_type: "project",
    target_id: projectId,
    amount: 1,
    wallet_address: walletAddress,
    chain_id: "0x1"
  });
  assert(pledge.donation?.currency === "FLOP" && pledge.donation?.feeAmount === 0, "donations should be zero-fee FLOP prelaunch pledges");
  const review = await postJson(`/api/public/projects/${encodeURIComponent(projectId)}/reviews`, {
    wallet_address: walletAddress,
    rating: 5,
    title: "Actually useful",
    comment: "Imported cleanly and gave me a sensible project structure."
  });
  assert(review.stats?.review_count === 1, "Public Project reviews should be counted");
  assert(review.stats?.rating_avg === 5, "Public Project reviews should average ratings");
  const projectDetail = await getJson(`/api/public/projects/${encodeURIComponent(projectId)}`);
  assert(projectDetail.project?.title === "Browser E2E Project", "Public Project detail should expose the project title");
  assert(projectDetail.rooms?.some((room) => room.tasks?.some((task) => task.description.includes("market-research agent"))), "Public Project detail should explain included tasks");
  assert(projectDetail.reviews?.some((item) => item.title === "Actually useful"), "Public Project detail should expose readable reviews");
  const explorerReport = await postJson(`/api/public/projects/${encodeURIComponent(projectId)}/explore`, {});
  assert(explorerReport.report?.summary?.includes("Browser E2E Project"), "Explorer should explain the selected public project");
  assert(explorerReport.report?.copy_fit, "Explorer should return a copy-fit recommendation");
  const chatPost = await postJson("/api/network/chat", {
    wallet_address: walletAddress,
    message: "Browser E2E says hello to Network Activity."
  });
  assert(chatPost.message?.message.includes("Network Activity"), "Network chat should accept public messages");
  const chatList = await getJson("/api/network/chat?limit=20");
  assert(chatList.messages?.some((item) => item.message.includes("Network Activity")), "Network chat should list saved messages");
  const activity = await getJson("/api/network/activity?limit=100");
  assert(activity.events?.some((item) => item.type === "network_chat_message"), "Network activity should list chat events");
  assert(!activity.events?.some((item) => item.type === "agent_registered"), "Network activity should not leak private Home agent registrations");
  topProjects = await getJson("/api/top-projects?limit=100");
  const donatedSharedProject = topProjects.agents.find((agent) => agent.target_id === projectId);
  assert(donatedSharedProject?.donation_total_flop === 1, "Top100 Projects should sum FLOP pledge intents");
  assert(donatedSharedProject?.review_count === 1, "Top100 Projects should expose review counts");
  assert(donatedSharedProject?.rating_avg === 5, "Top100 Projects should expose average ratings");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Enter Home" }).click().catch(() => {});
  await expectText(page, "body", "Network Live");
  await expectText(page, "body", "Project Network");
  await page.getByRole("button", { name: "Save Project" }).click();
  await page.getByPlaceholder("Project save name...").fill("Browser Saved Project");
  await page.locator('button').filter({ hasText: /^Save$/ }).click();
  await expectText(page, "body", "Browser Saved Project");
  const afterProjectSaveSessions = await getJson("/api/sessions");
  assert(afterProjectSaveSessions.some((session) => session.id === created.session_id), "Saving the workbench should not end existing private project sessions");
  await page.getByRole("button", { name: "Deals", exact: true }).click();
  await expectText(page, "body", "Deals");
  await expectText(page, "body", "TCLK Offer Observer");
  await expectText(page, "body", "PAPER / NO VALUE");
  await expectText(page, "body", "The complete deal lifecycle is enabled on PaperRail");
  await page.getByRole("button", { name: "Dealbook", exact: true }).click();
  await expectText(page, "body", "No PaperRail deals yet");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expectText(page, "body", "No archived protocol records yet.");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expectText(page, "body", "OSA shares");
  await expectText(page, "body", "Network chat message");
  await page.getByRole("button", { name: "Trust & Vault" }).click();
  await expectText(page, "body", "Federated Reputation");
  await expectText(page, "body", "Accepted Results");
  await expectText(page, "body", "Counterparties");
  await expectText(page, "body", "technocore-specialist");
  await expectText(page, "body", "Agent Review Bridge");
  if (await page.getByTitle("Minimize chat").isVisible()) await page.getByTitle("Minimize chat").click();
  await expectText(page, "body", "Signatures prove authorship and integrity—not endorsement");
  await expectText(page, "body", "Private review reasons never leave this node");
  await expectText(page, "body", "No published or discovered agent-review records yet");
  const floatingChatInput = page.getByPlaceholder("Message osa-network");
  if (!(await floatingChatInput.isVisible())) await page.getByTitle("Open chat").click();
  await floatingChatInput.fill("Browser chat from the floating window.");
  await page.getByRole("button", { name: "Send" }).click();
  await expectText(page, "body", "Browser chat from the floating window.");

  const deletedProject = await deleteJson(`/api/public/projects/${encodeURIComponent(projectId)}`, {
    owner_wallet_address: walletAddress
  });
  assert(deletedProject.deleted === true, "owner wallet should be able to delete a shared public project");
  const afterDeleteTopProjects = await getJson("/api/top-projects?limit=100");
  assert(!afterDeleteTopProjects.agents.some((agent) => agent.target_id === projectId), "deleted projects should disappear from Top100 Projects");
  const afterDeleteSessions = await getJson("/api/sessions");
  assert(!afterDeleteSessions.some((session) => session.id === projectShare.project.id), "deleted projects should disappear from Latest Projects");

  assert(await page.getByRole("button", { name: "Reset" }).count() === 0, "Reset should not be exposed in the topbar");
  await page.getByRole("button", { name: "Workspaces / Projects", exact: true }).click();
  await expectText(page, "body", "Browser Saved Project");

  assert(pageErrors.length === 0, `browser console/page errors: ${pageErrors.join("\n")}`);
  console.log(`Browser E2E passed on ${baseUrl}`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function ethereumPersonalMessageHash(message) {
  const messageBytes = utf8ToBytes(String(message || ""));
  const prefixBytes = utf8ToBytes(`\x19Ethereum Signed Message:\n${messageBytes.length}`);
  return keccak_256(new Uint8Array([...prefixBytes, ...messageBytes]));
}

function ethereumAddressFromPrivateKey(privateKey) {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`.toLowerCase();
}

function signPersonalMessage(message) {
  const signature = secp256k1.sign(ethereumPersonalMessageHash(message), testWalletPrivateKey, { format: "recovered", prehash: false });
  const ethereumSignature = new Uint8Array(65);
  ethereumSignature.set(signature.slice(1), 0);
  ethereumSignature[64] = signature[0] + 27;
  return `0x${bytesToHex(ethereumSignature)}`;
}

async function signedWalletLogin(address, chainId = "0x1") {
  const challenge = await postJson("/api/wallet/challenge", { address, chain_id: chainId });
  return postJson("/api/wallet/login", {
    address,
    chain_id: chainId,
    challenge_id: challenge.challenge.id,
    message: challenge.challenge.message,
    signature: signPersonalMessage(challenge.challenge.message)
  });
}

async function waitForHealth(logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check passed:\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy:\n${logs()}`);
}

function collectLogs(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function putJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJsonAllowError(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, ok: response.ok, payload };
}

async function deleteJson(path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function expectText(page, selector, text) {
  try {
    await page.locator(selector).filter({ hasText: text }).waitFor({ state: "visible" });
  } catch (error) {
    let body = "";
    try {
      body = (await page.locator("body").innerText()).slice(0, 3000);
    } catch {
      body = "<body unavailable>";
    }
    throw new Error(`Expected visible text ${JSON.stringify(text)}. Body was:\n${body}\n\n${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(path, predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const payload = await getJson(path);
    const match = predicate(payload);
    if (match) return match;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
