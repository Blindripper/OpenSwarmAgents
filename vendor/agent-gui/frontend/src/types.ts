export interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  source: string;
  model: string;
  parent_session_id: string | null;
  title: string;
  message_count: number;
  token_estimate: number;
  is_running?: boolean;
  /** First-command / last-activity timestamps across the desk's whole lineage
   *  (same span the Overview uses). Used for the desk-card execution timer so an
   *  idle desk freezes at its last activity instead of ticking wall-clock. */
  first_activity_at?: string | null;
  last_activity_at?: string | null;
  title_summary?: string | null;
  auto_continue?: boolean;
  /** Set by the backend when the most recent manager audit passed every check.
   *  Cleared as soon as the agent is resumed (does more work). */
  task_solved?: boolean;
  workspace_path?: string | null;
  is_sleeping?: boolean;
  /** OSA/OpenClaw agent profile id when a desk uses a profile. */
  agent?: string | null;
  agent_model?: string | null;
  agent_base_url?: string | null;
  /** Enabled UI toolset names for this desk. */
  desk_tools?: string[];
  /** Team this desk belongs to.
   *  Lets the office reconstruct teams created outside the browser (API/script). */
  team_id?: string | null;
  team_name?: string | null;
  /** OSA: whether this Home desk is visible in Public. */
  shared_public?: boolean;
  shared_public_at?: string | null;
  public_rank?: number | null;
  public_kind?: "agent" | "room" | "project";
  copy_count?: number;
  last_copied_at?: string | null;
  donation_count?: number;
  donation_total_flop?: number;
  platform_fee_total_flop?: number;
  review_count?: number;
  rating_avg?: number;
  latest_review?: ProjectReviewSummary | null;
  owner_wallet_address?: string | null;
  connector_status?: string | null;
  connector_exit_code?: number | null;
  connector_error?: string | null;
  openclaw_session_key?: string | null;
}

export interface TopAgent {
  id: string;
  task_id: string;
  target_type?: "project";
  target_id?: string;
  rank: number;
  title: string;
  summary: string;
  agent: string;
  model: string;
  goal: string;
  copy_count: number;
  manifest?: {
    schema: "osa-project/1";
    version: number;
    payload_hash: string;
    signed_at: string;
    verified: boolean;
    issuer_did?: string | null;
    invalid_reason?: string | null;
  } | null;

  donation_count?: number;
  donation_total_flop?: number;
  platform_fee_total_flop?: number;
  review_count?: number;
  rating_avg?: number;
  latest_review?: ProjectReviewSummary | null;
  item_count?: number;
  owner_wallet_address?: string | null;
  shared_at: string;
  last_copied_at?: string | null;
}

export interface PublicProjectReview {
  id: string;
  project_id: string;
  wallet_address: string;
  rating: number;
  title?: string;
  comment?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectReviewSummary {
  rating: number;
  title?: string;
  comment?: string;
  wallet_address?: string;
  created_at?: string;
}

export interface PublicProjectDetail {
  project: TopAgent;
  rooms: {
    id: string;
    name: string;
    tasks: {
      id: string;
      title: string;
      description: string;
      agent: string;
      model: string;
      status: string;
      capabilities?: string[];
      result_summary?: string | null;
    }[];
  }[];
  reviews: PublicProjectReview[];
  stats: {
    copy_count: number;
    copy_event_count?: number;
    donation_count?: number;
    donation_total_flop?: number;
    platform_fee_total_flop?: number;
    review_count?: number;
    rating_avg?: number;
  };
}

export interface ProjectExplorerReport {
  project_id: string;
  generated_at: string;
  explorer_agent: {
    id: string;
    name: string;
    soul_summary: string;
  };
  summary: string;
  rooms: {
    name: string;
    task_count: number;
    agents: string[];
  }[];
  strengths: string[];
  cautions: string[];
  copy_fit: string;
  evidence: string[];
}

export interface ManagerAuditRecord {
  id: string;
  session_id: string;
  task_id?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  desk_title: string;
  goal?: string | null;
  generated_at: string;
  trigger: string;
  state_hash?: string | null;
  summary: { passed: number; failed: number; unsure: number; total: number };
  results: AuditCriterionResult[];
}

export interface NetworkChatMessage {
  id: string;
  node_id: string;
  wallet_address?: string | null;
  message: string;
  created_at: string;
  source?: "osa" | "technocore" | string;
  external?: boolean;
  untrusted?: boolean;
  trusted?: boolean;
  room?: string;
  from?: string;
  seq?: number;
  signed?: boolean;
  verified?: boolean;
  delivery_status?: "sent" | "pending" | "duplicate" | string;
  warning?: string | null;
  a2a?: NetworkChatA2AMetadata | null;
}

export interface NetworkChatA2AMetadata {
  profile: string;
  version: string;
  type: string;
  frame_id?: string | null;
  correlation_id?: string | null;
  context_id?: string | null;
  task_id?: string | null;
  message_id?: string | null;
  sender?: string | null;
  recipient?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  envelope_hash: string;
  header_hash?: string | null;
  payload_hash?: string | null;
  wire_bytes: number;
  transport_form?: "logical-two-line" | "technocore-escaped-line" | string | null;
  verified: boolean;
  valid: boolean;
  rejection?: string | null;
  replay: boolean;
  conflict: boolean;
  part_count: number;
  part_kinds: string[];
  media_types: string[];
  schemas: string[];
  authority: "none" | string;
  handling: "authenticated-data-only" | string;
  remote_execution: false;
  value_settlement: false;
}

export interface NetworkChannel {
  id: string;
  name: string;
  source?: "osa" | "technocore" | string;
  pinned?: boolean;
  public?: boolean;
  category?: "main" | "other" | string;
  description?: string;
  topic?: string;
  count?: number | null;
  last_seq?: number | null;
  idle_seconds?: number | null;
  url?: string | null;
}

export interface ProtocolLayerStatus {
  id: "technocore" | "did" | "work" | "tclk" | "rail" | string;
  label: string;
  role: string;
  status: "connected" | "ready" | "observer" | "paper-only" | "planned" | "disabled" | "unavailable" | string;
}

export interface TclkOfferProjection {
  id: string;
  status: "proposed" | "accepted" | "locked" | "claimed" | "refunded" | "cancelled" | string;
  expired: boolean;
  from: string;
  role: "payer" | "payee";
  amount: string;
  asset: string;
  lock: "hash" | "point";
  rails: string[];
  job?: { proto: string; id: string; context?: string } | null;
  expires_at: string;
  claim_by: string;
  refund_after: string;
  observed_at: string;
  sequence?: number | null;
  verified: boolean;
  contract_id?: string | null;
  deal_room?: string | null;
  accepted_at?: string | null;
}

export interface ProtocolTimelineEntry {
  id: string;
  room: string;
  generation: number;
  sequence: number;
  from: string;
  protocol?: string | null;
  frame_type?: string | null;
  object_id?: string | null;
  created_at: string;
  observed_at: string;
  payload_hash: string;
  verified: boolean;
  valid: boolean;
  rejection?: string | null;
}

export interface ProtocolPaperDeal {
  id: string;
  label: string;
  status: "proposed" | "accepted" | "locked" | "claimed" | "refunded" | "cancelled" | string;
  mode: "paper-rehearsal";
  rail: "paper";
  has_value: false;
  amount: string;
  asset: "FLOP" | string;
  payer_did: string;
  counterparty_did: string;
  local_agent_id?: string | null;
  local_agent_did?: string | null;
  contract_id?: string | null;
  deal_room?: string | null;
  deal_room_posted?: boolean;
  deal_room_name?: string | null;
  result_frame_posted?: boolean;
  attest_frame_posted?: boolean;
  workspace_session_id?: string | null;
  receipt_recorded: boolean;
  next_action?: "accept" | "lock" | "claim" | "receipt" | null;
  created_at: string;
  updated_at: string;
  timeline: { stage: string; actor: string; at: string; detail: string }[];
}

export interface ProtocolOverview {
  mode: "observer" | string;
  writes_enabled: boolean;
  generated_at: string;
  identity: { node_did?: string | null; signed_messages: boolean };
  transport: { enabled: boolean; url?: string | null; public_room?: string | null };
  archive?: { persisted: boolean; record_count: number; limit: number };
  room_sync?: {
    room: string;
    generation: number;
    last_seq: number;
    last_attempt_at?: string | null;
    last_synced_at?: string | null;
    source: "live" | "archive" | string;
    stale: boolean;
    error?: string | null;
  };
  timeline?: ProtocolTimelineEntry[];
  paper?: {
    enabled: boolean;
    rail: "paper";
    asset: "FLOP";
    has_value: false;
    stages: string[];
    deals: ProtocolPaperDeal[];
  };
  layers: ProtocolLayerStatus[];
  subtask_delegation?: SubtaskDelegationOverview;
  shared_workspaces?: { schema: string; room_prefix: string; room_count: number; authority: string; remote_execution: false; files_shared: false };
  tclk: {
    version: string;
    offer_room: string;
    mode: string;
    value_settlement_enabled: boolean;
    warning: string;
    observed_message_count: number;
    valid_frame_count: number;
    invalid_frame_count: number;
    offers: TclkOfferProjection[];
  };
  a2a?: ProtocolA2AOverview;
}

export interface SubtaskDelegationPeer {
  key?: string;
  source: "local" | "federated" | string;
  agent_id: string;
  name: string;
  tagline?: string;
  did: string;
  node_id: string;
  node_did?: string | null;
  verified: boolean;
  stale: boolean;
  eligibility?: string;
  capabilities?: string[];
  mailbox_room?: string;
  provenance?: {
    kind?: string;
    room?: string | null;
    seq?: number | null;
    announced_at?: string | null;
    kv_path?: string | null;
    payload_hash?: string | null;
    node_id?: string | null;
    node_did?: string | null;
  } | null;
}

export interface SubtaskDelegationRecord {
  id: string;
  kind: "outgoing" | "incoming" | "result" | "quarantine" | string;
  state: string;
  delegation_id: string;
  task_id: string;
  task_frame_id?: string | null;
  status_frame_id?: string | null;
  result_frame_id?: string | null;
  ack_frame_id?: string | null;
  room?: string | null;
  sender_agent_id?: string;
  sender_did: string;
  sender_node_id: string;
  sender_node_did?: string | null;
  recipient_agent_id?: string;
  recipient_did: string;
  recipient_node_id: string;
  recipient_node_did?: string | null;
  required_capabilities: string[];
  task_text: string;
  task_preview?: string | null;
  result_text: string;
  result_preview?: string | null;
  request_hash?: string | null;
  result_hash?: string | null;
  idempotency_key?: string | null;
  expiry?: string | null;
  created_at: string;
  updated_at: string;
  accepted_at?: string | null;
  working_at?: string | null;
  result_ready_at?: string | null;
  result_sent_at?: string | null;
  result_received_at?: string | null;
  published_at?: string | null;
  workspace_session_id?: string | null;
  workspace_task_id?: string | null;
  source_envelope_hash?: string | null;
  source_room?: string | null;
  source_seq?: number | null;
  transport_status?: string | null;
  transport_error?: string | null;
  delivery_status?: string | null;
  publish_status?: string | null;
  publish_error?: string | null;
  verified: boolean;
  rejection_reason?: string | null;
  quarantine_reason?: string | null;
  provenance?: Record<string, unknown> | null;
  local_confirmation: boolean;
  no_payment: boolean;
  no_settlement: boolean;
  authority: string;
  mailbox_room?: string | null;
  handling?: string | null;
  remote_execution?: boolean;
  value_settlement?: boolean;
}

export interface SubtaskDelegationOverview {
  schema: string;
  version: number;
  generated_at: string;
  policy: {
    visibility: string;
    warning: string;
    authority: string;
    no_payment: boolean;
    no_settlement: boolean;
    public_text_only: boolean;
    workspace_creation: boolean;
    connector_spawning: boolean;
    remote_execution: boolean;
  };
  semantics: {
    adapter: string;
    official_a2a_compatibility: string;
    mailbox_transport: string;
    signatures_mean: string;
    authority: string;
    remote_execution: boolean;
    value_settlement: boolean;
  };
  status: {
    enabled: boolean;
    rooms: string[];
    last_attempt_at?: string | null;
    last_synced_at?: string | null;
    last_scan_status?: string | null;
    last_error?: string | null;
    discovered_count: number;
    verified_count: number;
    rejected_count: number;
    local_count: number;
    incoming_count: number;
    outgoing_count: number;
    result_count: number;
    quarantine_count: number;
  };
  senders: { agent_id: string; name: string; tagline?: string; did: string; node_id: string; node_did?: string | null; mailbox_room: string; capabilities: string[]; source: "local"; verified: boolean; stale: boolean }[];
  recipients: SubtaskDelegationPeer[];
  capability_options: string[];
  incoming: SubtaskDelegationRecord[];
  outgoing: SubtaskDelegationRecord[];
  results: SubtaskDelegationRecord[];
  quarantine: SubtaskDelegationRecord[];
}

export interface SharedWorkspaceMember {
  source: "local" | "federated";
  agent_id: string;
  name: string;
  did: string;
  node_id: string;
  node_did?: string | null;
  verified?: boolean;
  stale?: boolean;
  capabilities?: string[];
  key?: string;
  provenance?: Record<string, unknown> | null;
}

export interface SharedWorkspaceEvent {
  event_id: string;
  type: "OPEN" | "NOTE" | string;
  sender_did: string;
  text?: string | null;
  created_at: string;
  observed_at?: string | null;
  source_seq?: number | null;
  verified: boolean;
  state: "accepted" | "quarantined" | string;
  rejection?: string | null;
}

export interface SharedWorkspaceRoom {
  id: string;
  workspace_id: string;
  room: string;
  session_id: string;
  title: string;
  owner_node_id: string;
  owner_node_did: string;
  members: SharedWorkspaceMember[];
  manifest_event_id?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  publish_status: string;
  publish_error?: string | null;
  events: SharedWorkspaceEvent[];
  event_count: number;
  quarantine_count: number;
}

export interface SharedWorkspaceOverview {
  schema: string;
  generated_at: string;
  policy: {
    visibility: string;
    warning: string;
    authority: string;
    signatures_mean: string;
    remote_execution: false;
    files_shared: false;
    no_payment: true;
    no_settlement: true;
  };
  limits: { maxWireBytes: number; maxTextBytes: number; maxTitleBytes: number; maxMembers: number; maxEvents: number };
  status: {
    enabled: boolean;
    room_count: number;
    event_count: number;
    quarantine_count: number;
    last_attempt_at?: string | null;
    last_synced_at?: string | null;
    last_scan_status?: string | null;
    last_error?: string | null;
  };
  workspaces: { id: string; title: string; agent_id?: string | null; team_id: string; team_name: string; status: string }[];
  candidates: SharedWorkspaceMember[];
  rooms: SharedWorkspaceRoom[];
}

export interface FederatedWorkbenchTask {
  id: string;
  kind: "task" | string;
  state: "verified" | "stale" | "untrusted" | "imported" | string;
  importable: boolean;
  origin_node_id: string;
  origin_node_did?: string | null;
  origin_agent_id?: string | null;
  origin_agent_name?: string | null;
  origin_agent_did?: string | null;
  task_id: string;
  goal_id?: string | null;
  goal_title?: string | null;
  title: string;
  summary: string;
  status: string;
  task_type: string;
  required_capabilities: string[];
  priority: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  imported_session_id?: string | null;
  imported_task_id?: string | null;
  trust: { state: "verified" | "stale" | "untrusted" | string; stale: boolean; verified: boolean; reason?: string };
  identity_binding: { node_id: string; node_did?: string | null; agent_id?: string | null; agent_did?: string | null; task_id: string; goal_id?: string | null };
  provenance: { source: string; node_id: string; observed_at: string; head?: string | null; source_hash: string };
  authority: "inspect_only" | string;
  remote_execution: false;
  connector_spawning: false;
  files_shared: false;
  no_payment: true;
  no_settlement: true;
  source_hash: string;
}

export interface FederatedWorkbenchQuarantine {
  id: string;
  kind: "quarantine" | string;
  state: "quarantined" | string;
  origin_node_id?: string | null;
  origin_node_did?: string | null;
  reason: string;
  first_seen_at: string;
  last_seen_at: string;
  authority: "none" | string;
  remote_execution: false;
  connector_spawning: false;
  files_shared: false;
  no_payment: true;
  no_settlement: true;
}

export interface FederatedWorkbenchOverview {
  schema: "osa-federated-workbench/1" | string;
  version: number;
  generated_at: string;
  policy: {
    visibility: string;
    authority: string;
    signatures_mean: string;
    no_automatic_execution: boolean;
    remote_execution: false;
    connector_spawning: false;
    files_shared: false;
    no_payment: true;
    no_settlement: true;
  };
  status: {
    enabled: boolean;
    stale_after_ms: number;
    task_count: number;
    verified_count: number;
    stale_count: number;
    untrusted_count: number;
    imported_count: number;
    quarantine_count: number;
    last_import_at?: string | null;
    last_error?: string | null;
  };
  tasks: FederatedWorkbenchTask[];
  quarantine: FederatedWorkbenchQuarantine[];
}

export interface SkillRegistryProvider {
  id: string;
  source: "local" | "federated" | string;
  agent_id: string;
  name: string;
  tagline?: string;
  did: string;
  node_id: string;
  skills: string[];
  eligible: boolean;
  verification: { verified: boolean; stale: boolean; state: "verified" | "stale" | "untrusted" | string; label: string; rejection_reason?: string | null; note: string };
  provenance: { kind: "local" | "technocore" | string; room?: string | null; seq?: number | null; kv_path?: string | null; payload_hash?: string | null; last_seen_at?: string | null };
  reputation: { status: string; label: string; verified: boolean; stale: boolean; counts: { accepted_results: number; verified_job_results: number; claimed_deals: number; refunded_deals: number; disputed_deals: number; unique_counterparties: number }; note: string };
  authority: { kind: "local_workspace_profile" | "catalog_only" | string; selectable_for_local_workspace: boolean; remote_execution: false; connector_spawning: false; auto_bidding: false; payment: false; note: string };
}

export interface SkillRegistrySkill {
  id: string;
  schema: "osa-skill/1" | string;
  version: number;
  skill: string;
  label: string;
  provider_count: number;
  eligible_provider_count: number;
  local_provider_count: number;
  federated_provider_count: number;
  verified_provider_count: number;
  stale_provider_count: number;
  untrusted_provider_count: number;
  reputation_evidence_count: number;
  reputation_counts: SkillRegistryProvider["reputation"]["counts"];
  providers: SkillRegistryProvider[];
}

export interface SkillRegistryOverview {
  schema: "osa-skill-registry/1" | string;
  version: number;
  generated_at: string;
  query: { raw: string; skills: string[]; source: string; include_stale: boolean; include_untrusted: boolean };
  policy: { source_of_truth: string; reputation_context: string; signature_meaning: string; default_visibility: string; authority: string; matching_phase: string; remote_execution: false; connector_spawning: false; auto_bidding: false; payment: false };
  status: { capability_scan?: string | null; capability_error?: string | null; reputation_scan?: string | null; reputation_error?: string | null; available_skill_count: number; skill_count: number; provider_count: number; excluded: { untrusted: number; stale: number } };
  available_skills: string[];
  skills: SkillRegistrySkill[];
  providers: SkillRegistryProvider[];
}

export interface MatchmakingCandidate {
  provider_id: string;
  agent_id: string;
  name: string;
  source: "local" | "federated" | string;
  node_id: string;
  did: string;
  score: number;
  eligible: boolean;
  matched_skills: string[];
  missing_skills: string[];
  verification: { state: "verified" | "stale" | "untrusted" | string; verified: boolean; stale: boolean; label: string };
  reputation: { status: string; evidence_count: number };
  authority: { kind: "local_selectable" | "recommendation_only" | string; selectable_for_local_workspace: boolean; remote_execution: false; connector_spawning: false; auto_bidding: false; payment: false };
  reasons: string[];
}

export interface MatchmakingJob {
  id: string;
  source: "local" | "technocore" | string;
  room: string;
  seq: string;
  title: string;
  preview: string;
  text_hash: string;
  required_skills: string[];
  observed_at?: string | null;
  claimed: boolean;
}

export interface MatchmakingEntry {
  id: string;
  job: MatchmakingJob;
  candidate_count: number;
  top_score: number;
  status: "matched" | "partial" | "no_match" | string;
  candidates: MatchmakingCandidate[];
}

export interface MatchmakingOverview {
  schema: "osa-matchmaking/1" | string;
  version: number;
  generated_at: string;
  query?: { job_id?: string | null; include_claimed: boolean; include_stale: boolean; include_untrusted: boolean };
  policy: { source_of_truth: string; matching: string; signature_meaning: string; authority: string; remote_execution: false; connector_spawning: false; auto_bidding: false; payment: false; settlement: false };
  status: { job_count: number; matched_count: number; partial_count: number; no_match_count: number; provider_count: number; available_skill_count: number; registry_schema?: string | null };
  matches: MatchmakingEntry[];
}

export interface FlopGpuProbe {
  available: boolean;
  source: string;
  error?: string | null;
  gpus: { index: number; name: string; memory_total_mb: number | null; driver_version?: string | null }[];
}

export interface FlopOperatorCheck {
  id: string;
  label: string;
  status: "ready" | "warning" | "manual" | "blocked" | "planned" | string;
  detail: string;
  evidence?: string | null;
}

export interface FlopOperatorLifecycleStep {
  id: string;
  label: string;
  state: "manual_required" | "not_started" | "planned" | "ready" | string;
  detail: string;
}

export interface FlopMinerOverview {
  schema: "osa-flop-miner-console/1" | string;
  version: number;
  generated_at: string;
  yellowpaper: { url: string; sections: string[]; summary: string };
  mode: string;
  overall_status: string;
  readiness_score: number;
  compute: { gpu_probe: FlopGpuProbe; cpu_threads: number; memory_total_gb: number; memory_free_gb: number; cuda_visible: boolean };
  lifecycle: FlopOperatorLifecycleStep[];
  readiness: FlopOperatorCheck[];
  authority: { kind: string; gpu_leasing: false; miner_registration: false; model_registration: false; session_acceptance: false; connector_spawning: false; payment: false; settlement: false; note: string };
}

export interface FlopValidatorOverview {
  schema: "osa-flop-validator-console/1" | string;
  version: number;
  generated_at: string;
  yellowpaper: { url: string; sections: string[]; summary: string };
  mode: string;
  overall_status: string;
  readiness_score: number;
  requirements: { self_stake_floor: string; min_self_stake_ratio: string; committee_gate: string; heavy_duties: string[] };
  compute: { gpu_probe: FlopGpuProbe; cpu_threads: number; memory_total_gb: number; memory_free_gb: number; cuda_visible: boolean };
  lifecycle: FlopOperatorLifecycleStep[];
  readiness: FlopOperatorCheck[];
  authority: { kind: string; validator_registration: false; stake_bonding: false; block_authoring: false; finality_voting: false; attestation_signing: false; da_publishing: false; payment: false; settlement: false; note: string };
}

export interface ProtocolA2AObservation {
  id: string;
  profile: string;
  version: string;
  type: string;
  frame_id?: string | null;
  correlation_id?: string | null;
  context_id?: string | null;
  task_id?: string | null;
  message_id?: string | null;
  sender?: string | null;
  recipient?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  envelope_hash: string;
  header_hash?: string | null;
  payload_hash?: string | null;
  wire_bytes: number;
  transport_form?: "logical-two-line" | "technocore-escaped-line" | string | null;
  verified: boolean;
  valid: boolean;
  rejection?: string | null;
  conflict: boolean;
  part_count: number;
  part_kinds: string[];
  media_types: string[];
  schemas: string[];
  replay_count: number;
  transports: { room: string; generation: number; sequence: number; observed_at: string }[];
  observed_at: string;
  last_seen_at: string;
  authority: "none" | string;
  handling: "authenticated-data-only" | string;
  remote_execution: false;
  value_settlement: false;
}

export interface ProtocolA2AOverview {
  profile: string;
  version: string;
  compatibility: string;
  logical_format: string;
  technocore_transport_format: string;
  frame_types: string[];
  limits: {
    maxWireBytes: number;
    maxLogicalBytes: number;
    maxHeaderBytes: number;
    maxPayloadBytes: number;
    maxParts: number;
    maxTextPartBytes: number;
    maxDataPartBytes: number;
    maxFileBytes: number;
    maxDepth: number;
    maxTtlMs: number;
    maxFutureSkewMs: number;
    observation_limit: number;
  };
  semantics: {
    authority: "none" | string;
    handling: "authenticated-data-only" | string;
    remote_execution: false;
    mailbox_routing: boolean;
    mailbox_profile?: string;
    workspace_dispatch: false;
    value_settlement: false;
    signatures_mean: string;
  };
  archive: {
    persisted: true;
    payloads_persisted: false;
    record_count: number;
    returned_count: number;
  };
  observations: ProtocolA2AObservation[];
  generated_at: string;
}

export interface AgentMailboxIdentity {
  key?: string;
  source: "local" | "federated" | "unknown";
  agent_id: string | null;
  name: string;
  tagline?: string;
  did: string;
  node_id: string | null;
  node_did?: string | null;
  verified?: boolean;
  stale?: boolean;
  eligibility?: string;
  mailbox_room?: string;
  provenance?: {
    kind: "local" | "technocore" | string;
    room?: string | null;
    seq?: number | null;
    announced_at?: string | null;
    kv_path?: string | null;
    payload_hash?: string | null;
    node_id?: string | null;
  } | null;
}

export interface AgentMailboxMessage {
  id: string;
  box: "inbox" | "outbox" | "quarantine";
  profile: string;
  frame_type: "MESSAGE" | "ACK" | null;
  frame_id?: string | null;
  message_id?: string | null;
  acknowledged_id?: string | null;
  ack_outcome?: "received" | "accepted" | "rejected" | "duplicate" | null;
  client_message_id?: string | null;
  reply_to?: string | null;
  sender: AgentMailboxIdentity;
  recipient: AgentMailboxIdentity;
  room: string;
  text?: string | null;
  created_at: string;
  expires_at: string;
  correlation_id?: string | null;
  context_id?: string | null;
  envelope_hash: string;
  payload_hash?: string | null;
  verified: boolean;
  trust: "verified" | "untrusted";
  rejection?: string | null;
  delivery_status: "pending" | "sent" | "duplicate" | "ambiguous" | "failed" | "received" | "quarantined" | string;
  sequence?: number | null;
  generation?: number;
  observed_at?: string | null;
  last_seen_at: string;
  read_at?: string | null;
  warning?: string | null;
  public_unlisted: true;
  authority: "none";
  handling: "bounded-chat-text-only";
  remote_execution: false;
}

export interface AgentMailboxOverview {
  profile: string;
  a2a_profile: string;
  generated_at: string;
  derivation: {
    algorithm: string;
    hash: "sha256" | string;
    hash_bits: number;
    prefix: string;
    room_limit: number;
  };
  limits: {
    maxRoomLength: number;
    hashHexLength: number;
    maxTextBytes: number;
    maxTtlMs: number;
    maxClientMessageIdLength: number;
    projection_limit: number;
    sync_room_limit: number;
  };
  policy: {
    visibility: "public-unlisted";
    warning: string;
    acknowledgement_field: string;
    accepted_frame_types: string[];
    sent_frame_types: string[];
    authority: "none";
    signatures_mean: string;
    remote_execution: false;
    task_dispatch: false;
    session_spawning: false;
    workspace_creation: false;
    connector_spawning: false;
  };
  senders: { agent_id: string; name: string; did: string; node_id: string; mailbox_room: string }[];
  selected_sender: { agent_id: string; name: string; did: string; node_id: string; mailbox_room: string } | null;
  recipients: AgentMailboxIdentity[];
  sync?: { room: string; generation: number; last_seq: number; last_attempt_at?: string | null; last_synced_at?: string | null; source: string; stale: boolean; error?: string | null } | null;
  counts: { inbox: number; outbox: number; quarantine: number };
  inbox: AgentMailboxMessage[];
  outbox: AgentMailboxMessage[];
  quarantine: AgentMailboxMessage[];
}

export interface ToolsetMeta {
  name: string;
  label: string;
  lean: boolean;
  tools?: string[];   // individual tool names this toolset provides (display only)
}

// A tool profile = a named set of enabled toolset names. Built-in presets
// (chat/lean/full) have builtin=true; user-created ones are saved to localStorage.
export interface ToolProfile {
  id: string;
  name: string;
  enabled: string[];
  builtin?: boolean;
}

/** OSA/OpenClaw agent profile available to the workbench. */
export interface AgentProfile {
  id: string;
  name: string;
  tagline: string;
  color: string;
  available: boolean;
  model: string;
  base_url: string;
  profile_path: string;
  is_prototype?: boolean;
  clone_from?: string | null;
  /** Frontend-derived: profile is currently bound to an awake desk (one-per-desk). */
  inUse?: boolean;
  /** Deterministic Ed25519 did:key derived from node identity + profile id. */
  did?: string | null;
}

export interface LlmProvider {
  id: string;
  name: string;
  base_url: string;
  default_model: string;
  models: string[];
}

export interface AgentPrototype {
  id: string;
  name: string;
  tagline: string;
  color: string;
  is_prototype?: boolean;
}

export interface AgentPersona {
  id: string;
  soul: string;
  memory: string;
  profile_path: string;
  is_prototype?: boolean;
  clone_from?: string | null;
  name?: string | null;
  tagline?: string | null;
  model?: string | null;
  base_url?: string | null;
}

export interface AgentSkillBundle {
  bundle: string;
  count: number;
  skills: string[];
}

export interface AgentCapabilities {
  id: string;
  presets: { chat: string[]; lean: string[]; full: string[] };
  source: "global" | "profile";
  default_preset: string;
  profile_disabled_toolsets: string[];
  skill_bundles: AgentSkillBundle[];
  skill_count: number;
}

export type ToolPresetId = "chat" | "lean" | "full";

/** Agent + tool preset chosen for a pending desk before Start. */
export interface PendingAssignment {
  agentId: string;
  agentName: string;
  agentColor: string;
  toolPreset: ToolPresetId;
  toolsEnabled: string[];
  /** Ollama-only: override the profile's default model for this desk. */
  modelOverride?: string;
  /** Set when user saved overrides via desk Advanced. */
  customized?: boolean;
}

export interface ActivityEvent {
  timestamp: string;
  event_type: "tool_call" | "tool_result" | "compression" | "message" | "user_message" | "error" | "thinking_start";
  icon: string;
  title: string;
  detail: string;
  tool_name: string;
  is_error: boolean;
  files_touched: string[];
  // True when `timestamp` is a real recorded emit-time; false when it is an
  // approximate backend flush time. Absent on old payloads.
  time_exact?: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  operation?: string;
  preview_type?: string | null;
}

export interface FilePreviewData {
  type: "code" | "markdown" | "pdf" | "image" | "text";
  content?: string;
  path: string;
  name: string;
}

export interface AuditCriterionResult {
  id: number | string;
  task?: string;
  criterion: string;
  verdict: "pass" | "fail" | "unsure";
  evidence: string;
  fix_hint: string;
}

export interface AuditResult {
  session_id: string;
  generated_at: string;
  state_hash?: string;
  goal?: string;
  sources_inspected?: { task_spec: boolean; conversation_messages: number; output_files: string[] };
  results: AuditCriterionResult[];
  summary: { passed: number; failed: number; unsure: number; total: number };
  cached?: boolean;
  /** Auto patrol: desk was mid-turn — audit skipped, do not nudge. */
  skipped_running?: boolean;
  /** True only when a fresh audit found issues AND the loop cap isn't reached. */
  should_intervene?: boolean;
  intervention_count?: number;
  max_interventions?: number;
}

/** One session row in a desk's lineage (root, or a resume/model-switch). */
export interface DeskSessionEntry {
  id: string;
  started_at: string;
  ended_at: string | null;
  model: string;
  /** Agent profile in effect when this session row started ("" = Default). */
  profile: string;
  parent_session_id: string | null;
  message_count: number;
  is_root: boolean;
}

/** Desk history log — every session id this desk has run, oldest first. */
export interface DeskHistory {
  desk_id: string;
  profile: string;
  sessions: DeskSessionEntry[];
}

/** A desk exported to a single downloadable JSON document. */
export interface DeskExport {
  format: string;
  exported_at: string;
  desk_id: string;
  title: string;
  profile: string;
  model: string;
  tools: string[] | null;
  task: string;
  sessions: DeskSessionEntry[];
}

/** Prefix that marks a conversation message as coming from the team manager (not
 *  the human user), so the activity feed can render it distinctly. */
export const MANAGER_MSG_PREFIX = "👩‍💼 [Team manager] ";

export interface PendingDesk {
  id: string;
  isPending: true;
}

export type DeskItem = Session | PendingDesk;

export type TeamColor = "blue" | "red" | "green" | "purple" | "orange";

export const TEAM_COLORS: TeamColor[] = ["blue", "red", "green", "purple", "orange"];

export interface Team {
  id: string;
  color: TeamColor;
  desks: DeskItem[];
  /** User-visible label; falls back to "Team N" when unset. */
  name?: string;
  /** Per-team background scene id; falls back to the global scene when unset. */
  scene?: string;
}

export function teamDisplayName(team: Team, index: number): string {
  const custom = team.name?.trim();
  return custom || `Team ${index + 1}`;
}

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  parent_id?: string | null;
}

export interface TodoData {
  tasks: TodoItem[];
  summary: string;
}

/** Live event emitted by the local connector over the activity WebSocket. */
export interface WorkerEvent {
  type: "token" | "tool_start" | "tool_done" | "thinking" | "status" | "log" | "done" | "error" | "interrupted" | "agent_arrived" | "subagent";
  text?: string;   // token / thinking / subagent(thinking,progress)
  name?: string;   // tool_start / tool_done
  result?: string; // tool_done
  event?: string;  // status / subagent lifecycle (start|thinking|tool|progress|complete)
  msg?: string;    // status / error
  // ── subagent (delegate_task child) fields ──
  subagent_id?: string;
  parent_id?: string;
  depth?: number;
  model?: string;
  task_index?: number;  // 0-based position within its delegate_task call
  task_count?: number;  // batch size of that call
  goal?: string;        // subagent.start → the task/input
  tool_name?: string;   // subagent.tool
  preview?: string;     // subagent.tool args preview
  args?: string;        // subagent.tool serialized args
  status?: string;      // subagent.complete → ok|error|timeout|failed
  output?: string;      // subagent.complete → the result/output
  duration_seconds?: number;
}

/** A single entry in a subagent's activity timeline. */
export interface SubagentTimelineEvent {
  event: string;        // start | thinking | tool | progress | complete
  ts: number;
  text?: string;
  tool_name?: string;
  preview?: string;
  goal?: string;
  status?: string;
  output?: string;
  duration_seconds?: number;
}

/** A delegate_task subagent's durable trace, one per desk tab. */
export interface SubagentRecord {
  subagent_id: string;
  parent_id?: string;
  depth?: number;
  model?: string;
  task_index?: number;                // 0-based position within its delegate_task call
  task_count?: number;                // batch size of that call
  goal: string;                       // the task/input
  status: string;                     // running | ok | error | timeout | failed
  started_at?: number;
  ended_at?: number | null;
  output: string;                     // final result/output
  duration_seconds?: number;
  events: SubagentTimelineEvent[];    // tool/thinking/progress timeline
}

/** Accumulated live state shown while a session is actively running. */
export interface LiveState {
  streamText: string;   // tokens accumulated for the current assistant turn
  toolName?: string;    // name of the tool currently executing
  logLine?: string;     // latest verbose/status line from the agent
  thinkingText?: string; // extended thinking / reasoning tokens (verbose only)
  statusLine?: string;   // honest short phase label (e.g. "Invoking bash", "Waiting for model")
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type ApiMode = "openai" | "ollama";
