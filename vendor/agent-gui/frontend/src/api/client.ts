import type { ActivityEvent, AgentCapabilities, AgentMailboxMessage, AgentMailboxOverview, AgentPersona, AgentProfile, AgentPrototype, AuditResult, DeskExport, DeskHistory, FederatedWorkbenchOverview, FileNode, FilePreviewData, FlopMinerOverview, FlopValidatorOverview, LlmProvider, ManagerAuditRecord, MatchmakingOverview, NetworkChannel, NetworkChatMessage, ProjectExplorerReport, ProtocolA2AOverview, ProtocolOverview, ProtocolPaperDeal, PublicProjectDetail, PublicProjectReview, Session, SharedWorkspaceOverview, SharedWorkspaceRoom, SkillRegistryOverview, SubagentRecord, SubtaskDelegationOverview, SubtaskDelegationRecord, TodoData, TopAgent, WorkerEvent } from "../types";

const BASE = "/api";
const WS_BASE = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

export interface OpenClawStatus {
  available: boolean;
  command: string;
  version: string | null;
  agent_gui_linked: boolean;
  setup_complete: boolean;
  profile: string;
  rooms: { home: string; public: string };
  message: string;
  install_hint?: string;
  install_command?: string;
  connect_command?: string;
  auth_hint?: string;
}

export interface WalletSession {
  address: string;
  chain_id?: string | null;
  connected_at?: string;
  last_seen_at?: string;
  verified?: boolean;
}

export interface WalletChallenge {
  id: string;
  address: string;
  chain_id?: string | null;
  message: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
}

export interface WalletBalance {
  address: string;
  balance_flop: number | null;
  formatted: string;
  source: string;
  token_contract?: string | null;
  rewards_contract?: string | null;
  official_url?: string;
  note?: string;
}

export interface NetworkEvent {
  id: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeStatus {
  federationEnabled?: boolean;
  federationPeerCount?: number;
  federationAdvertiseUrl?: string | null;
  federationDiscoveryEnabled?: boolean;
  federationKnownPeerCount?: number;
  federationDiscoveredPeerCount?: number;
  federationSignatureVerificationEnabled?: boolean;
  federationTrustedNodeCount?: number;
  federationTrustConfigError?: string | null;
  technocoreEnabled?: boolean;
  technocoreUrl?: string | null;
  technocorePublicRoom?: string | null;
  technocoreRooms?: string[];
  technocoreAnnounceEnabled?: boolean;
  technocoreAnnounceRoom?: string | null;
  technocoreSignedMessages?: boolean;
  technocoreDid?: string | null;
  walletNonceLoginEnabled?: boolean;
}

async function errorDetail(r: Response): Promise<string> {
  try {
    const j = await r.json();
    if (typeof j.detail === "string") return j.detail;
    if (j.detail) return JSON.stringify(j.detail);
  } catch { /* ignore */ }
  return `${r.status} ${r.statusText}`;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(BASE + path, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorDetail(r));
  return r.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorDetail(r));
  return r.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorDetail(r));
  return r.json();
}

async function del<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!r.ok) throw new Error(await errorDetail(r));
  return r.json();
}

export const api = {
  health: () => get<{ ok: boolean; runtime?: RuntimeStatus; serverTime?: string }>("/health"),
  sessions: {
    list: (limit = 50, offset = 0) =>
      get<Session[]>(`/sessions?limit=${limit}&offset=${offset}`),
    get: (id: string) => get<Session>(`/sessions/${id}`),
    patchDeskConfig: (id: string, body: { agent?: string; model?: string; tools?: string[] }) =>
      patch<Session>(`/sessions/${encodeURIComponent(id)}/desk-config`, body),
    // Default to the full desk conversation (server caps far above any realistic
    // desk size). Callers that only need a peek pass an explicit small limit
    // (e.g. the manager's quick glance).
    activity: (id: string, limit = 1_000_000, tail = false) =>
      get<ActivityEvent[]>(
        `/sessions/${id}/activity?limit=${limit}${tail ? "&tail=1" : ""}`,
      ),
    overview: (id: string, limit = 10000) =>
      get<{
        events: ActivityEvent[];
        started_at: string | null;
        last_at: string | null;
        message_count: number;
        session_ids?: string[];
        truncated?: boolean;
      }>(`/sessions/${id}/overview?limit=${limit}`),
    consoleHistory: (id: string, limit = 2000) =>
      get<{ text: string }>(`/sessions/${id}/console?limit=${limit}`),
    terminalHistory: (id: string, limit = 2000) =>
      get<{ text: string }>(`/sessions/${id}/terminal?limit=${limit}`),
    files: (id: string) => get<FileNode[]>(`/sessions/${id}/files`),
    workspaceTree: (id: string) => get<FileNode[]>(`/sessions/${id}/workspace_tree`),
    todos: (id: string) => get<TodoData>(`/sessions/${id}/todos`),
    delete: (id: string) =>
      del<{ ok: boolean; deleted: boolean; sandbox: boolean; workspace: boolean; transcripts: boolean; container: boolean }>(
        `/sessions/${id}`,
      ),
    interrupt: (id: string) => post<{ ok: boolean }>(`/sessions/${id}/interrupt`, {}),
    inspect: (id: string, tool: string, args: Record<string, unknown>) =>
      post<{ ok: boolean; tool: string; result?: string; error?: string }>(
        `/sessions/${id}/inspect`, { tool, args }),
    inspectStop: (id: string) =>
      post<{ ok: boolean; error?: string }>(`/sessions/${id}/inspect/stop`, {}),
    arrive: (id: string) => post<{ ok: boolean }>(`/sessions/${id}/arrive`, {}),
    sleep: (id: string) => post<{ ok: boolean }>(`/sessions/${id}/sleep`, {}),
    wake: (id: string) => post<{ ok: boolean }>(`/sessions/${id}/wake`, {}),
    resume: (id: string, content: string, attachments?: { name: string; data: string }[], agent?: string, reasoning_effort?: string, api_mode?: string) =>
      post<{ ok: boolean }>(`/sessions/${id}/resume`, {
        content,
        ...(attachments?.length ? { attachments } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(reasoning_effort !== undefined ? { reasoning_effort } : {}),
        ...(api_mode !== undefined ? { api_mode } : {}),
      }),
    copy: (id: string, body: { wallet_address?: string } = {}) =>
      post<{ ok: boolean; session_id: string; session_ids?: string[]; workspace_path?: string | null; response: string; session?: Session; agent?: string | null }>(
        `/sessions/${encodeURIComponent(id)}/copy`,
        body,
      ),
    redirect: (id: string, content: string, attachments?: { name: string; data: string }[], reasoning_effort?: string, api_mode?: string) =>
      post<{ ok: boolean }>(`/sessions/${id}/redirect`, {
        content,
        ...(attachments?.length ? { attachments } : {}),
        ...(reasoning_effort !== undefined ? { reasoning_effort } : {}),
        ...(api_mode !== undefined ? { api_mode } : {}),
      }),
    autoContinue: (id: string, enabled: boolean) =>
      post<{ ok: boolean; enabled: boolean; max: number }>(`/sessions/${id}/autocontinue`, { enabled }),
    reassign: (fromId: string, toId: string, message = "Continue.") =>
      post<{ ok: boolean; session_id: string }>("/sessions/reassign", {
        from_id: fromId,
        to_id: toId,
        message,
      }),
    taskFile: {
      get: (id: string) => get<{ content: string; path: string; workspace: string }>(`/sessions/${id}/taskfile`),
      save: (id: string, content: string) => put<{ ok: boolean }>(`/sessions/${id}/taskfile`, { content }),
    },
    // Desk session-lineage history: root session + each resume/model-switch.
    history: (id: string) =>
      get<DeskHistory>(`/sessions/${id}/history`),
    // Full desk export (config + TASK.md + session history) as a JSON document.
    export: (id: string) =>
      get<DeskExport>(`/sessions/${id}/export`),
    // Full-desk archive (.tar.gz of the whole sandbox) — direct download URL so
    // the browser streams it to disk with the server's Content-Disposition name.
    archiveUrl: (id: string) => `${BASE}/sessions/${id}/archive`,
    // Load a desk previously saved via archiveUrl back into the workbench.
    importDesk: async (fileBlob: File) => {
      const fd = new FormData();
      fd.append("file", fileBlob);
      const r = await fetch(`${BASE}/sessions/import`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await errorDetail(r));
      return r.json() as Promise<{ ok: boolean; session_id: string; workspace_path: string | null; team_id: string | null }>;
    },
    listSavedDesks: () =>
      get<{ dir: string; archives: { filename: string; size: number; modified_at: string }[] }>("/sessions/saved"),
    importSavedDesk: (filename: string) =>
      post<{ ok: boolean; session_id: string; workspace_path: string | null; team_id: string | null }>(
        "/sessions/import-saved", { filename },
      ),
    // Orchestrated evidence-based manager audit (~60s; runs the agent's model).
    // Returns the cached audit instantly when state is unchanged unless force=true.
    audit: (id: string, force = false) =>
      post<AuditResult>(`/sessions/${id}/audit${force ? "?force=true" : ""}`, {}),
    auditCached: (id: string) => get<AuditResult>(`/sessions/${id}/audit`),
    // Agent progress report (PROGRESS.md). get = read cached; generate = (re)build.
    progress: {
      get: (id: string) => get<{ content: string; exists: boolean }>(`/sessions/${id}/progress`),
      generate: (id: string) => post<{ content: string; exists: boolean }>(`/sessions/${id}/progress`, {}),
    },
    // Cheap, no-LLM: has the current state already been audited?
    auditStatus: (id: string) =>
      get<{ current_hash: string; auditable: boolean; audited: boolean;
            summary: { passed: number; failed: number; unsure: number; total: number } | null }>(
        `/sessions/${id}/audit/status`),
    new: (
      content: string,
      reasoning_effort?: string,
      api_mode?: string,
      model?: string,
      attachments?: { name: string; data: string }[],
      tools?: string[],
      agent?: string,
      team_id?: string,
      team_name?: string,
      wallet_address?: string,
    ) =>
      post<{ session_id: string; workspace_path?: string; response: string; session?: Session; agent?: string | null }>(
        "/sessions/new",
        {
          content,
          ...(reasoning_effort !== undefined ? { reasoning_effort }         : {}),
          ...(api_mode                  ? { api_mode }                          : {}),
          ...(model                     ? { model }                             : {}),
          ...(attachments?.length       ? { attachments }                       : {}),
          ...(tools !== undefined        ? { tools }                            : {}),
          ...(agent                     ? { agent }                             : {}),
          ...(team_id                   ? { team_id }                           : {}),
          ...(team_name                 ? { team_name }                         : {}),
          ...(wallet_address            ? { wallet_address }                    : {}),
        },
      ),
    sendMessage: async (
      id: string,
      content: string,
      onChunk?: (delta: string) => void,
    ): Promise<void> => {
      const res = await fetch(`${BASE}/sessions/${id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload);
            const delta: string | undefined = json.choices?.[0]?.delta?.content;
            if (delta && onChunk) onChunk(delta);
          } catch { /* partial chunk */ }
        }
      }
    },
    activityWs: (
      id: string,
      onEvents: (events: ActivityEvent[]) => void,
      onLive?: (evt: WorkerEvent) => void,
      onClose?: () => void,
      onSubagents?: (records: SubagentRecord[]) => void,
    ): WebSocket => {
      const ws = new WebSocket(`${WS_BASE}/ws/activity/${id}`);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data)) {
            onEvents(data);
          } else if (data.subagents && onSubagents) {
            onSubagents(data.subagents as SubagentRecord[]);
          } else if (data.live && onLive) {
            onLive(data.live as WorkerEvent);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => onClose?.();
      return ws;
    },
    terminalWs: (id: string, onLine: (line: string) => void): WebSocket => {
      const ws = new WebSocket(`${WS_BASE}/ws/terminal/${id}`);
      ws.onmessage = (e) => { onLine(String(e.data)); };
      return ws;
    },
    consoleWs: (id: string, onLine: (line: string) => void): WebSocket => {
      const ws = new WebSocket(`${WS_BASE}/ws/console/${id}`);
      ws.onmessage = (e) => { onLine(String(e.data)); };
      return ws;
    },
    tailWs: (id: string, file: string, onLine: (line: string) => void): WebSocket => {
      const ws = new WebSocket(`${WS_BASE}/ws/tail/${id}?file=${encodeURIComponent(file)}`);
      ws.onmessage = (e) => { onLine(String(e.data)); };
      return ws;
    },
  },
  topProjects: (limit = 100) =>
    get<{ agents: TopAgent[]; generated_at: string }>(`/top-projects?limit=${limit}`),
  networkStream: (
    onActivity: (event: NetworkEvent) => void,
    onClose?: () => void,
  ): EventSource => {
    const source = new EventSource(`${BASE}/network/stream`);
    source.addEventListener("activity", (event) => {
      try {
        onActivity(JSON.parse((event as MessageEvent).data) as NetworkEvent);
      } catch { /* ignore malformed network events */ }
    });
    source.onerror = () => onClose?.();
    return source;
  },
  network: {
    activity: (limit = 100) =>
      get<{ events: NetworkEvent[] }>(`/network/activity?limit=${limit}`),
    channels: (limit = 60, signal?: AbortSignal) =>
      get<{ channels: NetworkChannel[]; generated_at: string }>(`/network/channels?limit=${limit}`, signal),
    chat: (limit = 60, channel?: string, since?: number, signal?: AbortSignal) =>
      get<{ messages: NetworkChatMessage[] }>(
        `/network/chat?limit=${limit}${channel ? `&channel=${encodeURIComponent(channel)}` : ""}${since ? `&since=${encodeURIComponent(String(since))}` : ""}`,
        signal,
      ),
    sendChat: (body: { message: string; wallet_address?: string | null; channel?: string }) =>
      post<{ ok: boolean; technocore_mirrored?: boolean; message: NetworkChatMessage }>("/network/chat", body),
  },
  mailboxes: {
    overview: (agentId?: string, signal?: AbortSignal) =>
      get<AgentMailboxOverview>(`/agent-mailboxes${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`, signal),
    send: (body: {
      sender_agent_id: string;
      sender_did: string;
      recipient: { source: "local" | "federated"; agent_id: string; did: string; node_id: string };
      text: string;
      expires_in_minutes: number;
      client_message_id: string;
      reply_to?: string | null;
      public_unlisted_acknowledged: true;
    }) => post<{ ok: boolean; idempotent_replay: boolean; message: AgentMailboxMessage }>("/agent-mailboxes/send", body),
    sync: (agentId: string, box: "inbox" | "outbox" = "inbox") =>
      post<{ ok: boolean; source: string; error?: string; view: AgentMailboxOverview }>("/agent-mailboxes/sync", { agent_id: agentId, box }),
    markRead: (agentId: string, messageId: string) =>
      post<{ ok: boolean; message: AgentMailboxMessage }>("/agent-mailboxes/read", { agent_id: agentId, message_id: messageId }),
  },
  protocol: {
    overview: (signal?: AbortSignal) => get<ProtocolOverview>("/protocol/overview", signal),
    a2a: (signal?: AbortSignal) => get<ProtocolA2AOverview>("/protocol/a2a", signal),
    createPaperDeal: (body: { amount: string; label?: string }) =>
      post<ProtocolPaperDeal>("/protocol/paper-deals", body),
    advancePaperDeal: (id: string) =>
      post<ProtocolPaperDeal>(`/protocol/paper-deals/${encodeURIComponent(id)}/advance`, {}),
    refundPaperDeal: (id: string) =>
      post<ProtocolPaperDeal>(`/protocol/paper-deals/${encodeURIComponent(id)}/refund`, {}),
    cancelPaperDeal: (id: string) =>
      post<ProtocolPaperDeal>(`/protocol/paper-deals/${encodeURIComponent(id)}/cancel`, {}),
    acceptOffer: (body: { offer_id: string; agent_id?: string }) =>
      post<ProtocolPaperDeal>("/protocol/offers/accept", body),
    claimOffer: (body: { deal_id: string }) =>
      post<ProtocolPaperDeal>("/protocol/offers/claim", body),
  },
  sharedWorkspaces: {
    overview: (signal?: AbortSignal) => get<SharedWorkspaceOverview>("/shared-workspaces", signal),
    create: (body: { session_id: string; title: string; member_keys: string[]; idempotency_key: string; expires_days: number; private_room_warning_acknowledged: true; share_confirmation: true }) =>
      post<{ ok: boolean; idempotent_replay: boolean; room: SharedWorkspaceRoom; status: SharedWorkspaceOverview }>("/shared-workspaces", body),
    scan: () => post<SharedWorkspaceOverview>("/shared-workspaces/scan", {}),
    publishNote: (workspaceId: string, body: { agent_id: string; text: string; idempotency_key: string; private_room_warning_acknowledged: true; publish_confirmation: true }) =>
      post<{ ok: boolean; idempotent_replay: boolean; room: SharedWorkspaceRoom; event: SharedWorkspaceRoom["events"][number] }>(`/shared-workspaces/${encodeURIComponent(workspaceId)}/notes`, body),
  },
  federatedWorkbench: {
    overview: (signal?: AbortSignal) => get<FederatedWorkbenchOverview>("/federated-workbench", signal),
    importTask: (id: string, body: { idempotency_key: string; confirmation: "import-federated-task"; agent_id?: string }) =>
      post<{ ok: boolean; idempotent_replay: boolean; task: { id: string }; session: Session; status: FederatedWorkbenchOverview }>(`/federated-workbench/${encodeURIComponent(id)}/import`, body),
  },
  skillRegistry: {
    overview: (params: { skill?: string; source?: "all" | "local" | "federated"; include_stale?: boolean; include_untrusted?: boolean; limit?: number; provider_limit?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (params.skill) query.set("skill", params.skill);
      if (params.source) query.set("source", params.source);
      if (params.include_stale) query.set("include_stale", "1");
      if (params.include_untrusted) query.set("include_untrusted", "1");
      if (params.limit) query.set("limit", String(params.limit));
      if (params.provider_limit) query.set("provider_limit", String(params.provider_limit));
      return get<SkillRegistryOverview>(`/skill-registry${query.toString() ? `?${query.toString()}` : ""}`, signal);
    },
  },
  matchmaking: {
    overview: (params: { job_id?: string; include_claimed?: boolean; include_stale?: boolean; include_untrusted?: boolean; limit?: number; candidate_limit?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (params.job_id) query.set("job_id", params.job_id);
      if (params.include_claimed) query.set("include_claimed", "1");
      if (params.include_stale) query.set("include_stale", "1");
      if (params.include_untrusted) query.set("include_untrusted", "1");
      if (params.limit) query.set("limit", String(params.limit));
      if (params.candidate_limit) query.set("candidate_limit", String(params.candidate_limit));
      return get<MatchmakingOverview>(`/matchmaking${query.toString() ? `?${query.toString()}` : ""}`, signal);
    },
  },
  flop: {
    miner: (signal?: AbortSignal) => get<FlopMinerOverview>("/flop/miner", signal),
    validator: (signal?: AbortSignal) => get<FlopValidatorOverview>("/flop/validator", signal),
  },
  subtaskDelegations: {
    overview: (signal?: AbortSignal) => get<SubtaskDelegationOverview>("/subtask-delegations", signal),
    get: (id: string, signal?: AbortSignal) => get<{ ok: boolean; delegation: SubtaskDelegationRecord; status: SubtaskDelegationOverview }>(`/subtask-delegations/${encodeURIComponent(id)}`, signal),
    create: (body: {
      sender_agent_id: string;
      recipient_key: string;
      required_capabilities: string[];
      task_text: string;
      idempotency_key: string;
      expiry: string;
      public_confirmation: true;
      delegate_task_confirmation: true;
      delegate_task: true;
      public_warning_acknowledged: true;
      no_payment: true;
      no_settlement: true;
    }) => post<{ ok: boolean; delegation: SubtaskDelegationRecord; status: SubtaskDelegationOverview }>("/subtask-delegations", body),
    scan: () => post<SubtaskDelegationOverview>("/subtask-delegations/scan", {}),
    accept: (id: string, body: {
      agent_id: string;
      idempotency_key: string;
      public_confirmation: true;
      accept_confirmation?: true;
      accept_task_confirmation?: true;
    }) => post<{ ok: boolean; delegation: SubtaskDelegationRecord; session_id: string | null; session?: Session | null; task?: Session | null; status: SubtaskDelegationOverview }>(`/subtask-delegations/${encodeURIComponent(id)}/accept`, body),
    publishResult: (id: string, body: {
      agent_id: string;
      idempotency_key: string;
      public_confirmation: true;
      publish_confirmation?: true;
      publish_result_confirmation?: true;
    }) => post<{ ok: boolean; delegation: SubtaskDelegationRecord; task?: Session | null; result?: { id: string; taskId: string; agentId: string; summary?: string; content?: string; status?: string }; status: SubtaskDelegationOverview }>(`/subtask-delegations/${encodeURIComponent(id)}/publish-result`, body),
  },
  wallet: {
    challenge: (body: { address: string; chain_id?: string | null }) =>
      post<{ ok: boolean; challenge: WalletChallenge }>("/wallet/challenge", body),
    login: (body: { address: string; chain_id?: string | null; challenge_id: string; message: string; signature: string }) =>
      post<{ ok: boolean; wallet: WalletSession; sessionToken?: string }>("/wallet/login", body),
    balance: (address: string) =>
      get<WalletBalance>(`/wallet/balance?address=${encodeURIComponent(address)}`),
  },
  donations: {
    create: (body: { session_id?: string; target_type?: "project"; target_id?: string; amount: number; wallet_address: string; chain_id?: string | null }) =>
      post<{
        ok: boolean;
        donation: { id: string; amount: number; currency: "FLOP"; status: "pledged"; createdAt: string; feeAmount?: number; creatorAmount?: number };
        stats: { donation_count: number; donation_total_flop: number; platform_fee_total_flop?: number };
        fee?: { percent: number; wallet: string | null; amount: number };
        agent?: TopAgent | null;
      }>("/donations", body),
  },
  publicProjects: {
    share: (body: { name?: string; owner_wallet_address?: string; share_file_repo?: boolean; technocore_channels?: string[]; rooms?: { id: string; name?: string }[] }) =>
      post<{ ok: boolean; shared_public: boolean; project?: Session }>("/public/projects/share", body),
    delete: (projectId: string, body: { owner_wallet_address: string }) =>
      del<{ ok: boolean; deleted: boolean; public_project_id: string; removed: Record<string, number> }>(
        `/public/projects/${encodeURIComponent(projectId)}`,
        body,
      ),
    get: (projectId: string) =>
      get<PublicProjectDetail>(`/public/projects/${encodeURIComponent(projectId)}`),
    explore: (projectId: string) =>
      post<{ ok: boolean; report: ProjectExplorerReport }>(
        `/public/projects/${encodeURIComponent(projectId)}/explore`,
        {},
      ),
    reviews: (projectId: string) =>
      get<{
        reviews: PublicProjectReview[];
        stats: { review_count: number; rating_avg: number };
      }>(`/public/projects/${encodeURIComponent(projectId)}/reviews`),
    review: (projectId: string, body: { wallet_address: string; rating: number; title?: string; comment?: string }) =>
      post<{
        ok: boolean;
        review: PublicProjectReview;
        stats: { review_count: number; rating_avg: number };
        project?: TopAgent | null;
      }>(`/public/projects/${encodeURIComponent(projectId)}/reviews`, body),
  },
  search: (q: string) => get<Session[]>(`/search?q=${encodeURIComponent(q)}`),
  file: {
    preview: (path: string) =>
      get<FilePreviewData>(`/file/preview?path=${encodeURIComponent(path)}`),
    tree: (root: string) =>
      get<FileNode[]>(`/file/tree?root=${encodeURIComponent(root)}`),
  },
  openclaw: {
    status: () => get<OpenClawStatus>("/openclaw/status"),
    install: () => post<{ ok: boolean; installed: boolean; status: OpenClawStatus; output?: string }>("/openclaw/install", {}),
    connect: () => post<{ ok: boolean; status: OpenClawStatus; message: string; connect_command?: string }>("/openclaw/connect", {}),
    warmup: () => post<{ ok: boolean }>("/warmup", {}),
  },
  llm: {
    models: (opts?: { baseUrl?: string; agentId?: string }) => {
      const q = new URLSearchParams();
      if (opts?.baseUrl) q.set("base_url", opts.baseUrl);
      if (opts?.agentId) q.set("agent_id", opts.agentId);
      const qs = q.toString();
      return get<{ models: string[]; current: string; base_url?: string }>(
        `/llm/models${qs ? `?${qs}` : ""}`,
      );
    },
    providers: (opts?: { agentId?: string }) => {
      const q = new URLSearchParams();
      if (opts?.agentId) q.set("agent_id", opts.agentId);
      const qs = q.toString();
      return get<{ providers: LlmProvider[]; active: string }>(
        `/llm/providers${qs ? `?${qs}` : ""}`,
      );
    },
  },
  manager: {
    getProfile: () =>
      get<{ profile: string; model: string; base_url: string }>("/manager/profile"),
    setProfile: (profile: string) =>
      post<{ profile: string; model: string }>("/manager/profile", { profile }),
    audits: (limit = 100) =>
      get<{ audits: ManagerAuditRecord[] }>(`/manager/audits?limit=${limit}`),
  },
  /** @deprecated use api.llm.models */
  ollama: {
    models: (baseUrl?: string, agentId?: string) =>
      get<{ models: string[]; current: string }>(
        `/llm/models${(() => {
          const q = new URLSearchParams();
          if (baseUrl) q.set("base_url", baseUrl);
          if (agentId) q.set("agent_id", agentId);
          const qs = q.toString();
          return qs ? `?${qs}` : "";
        })()}`,
      ),
  },
  agents: {
    list: () => get<{ agents: AgentProfile[] }>("/agents"),
    prototypes: () => get<{ prototypes: AgentPrototype[] }>("/agents/prototypes"),
    capabilities: (id: string) =>
      get<AgentCapabilities>(`/agents/${encodeURIComponent(id)}/capabilities`),
    persona: (id: string) => get<AgentPersona>(`/agents/${encodeURIComponent(id)}/persona`),
    savePersona: (
      id: string,
      body: { soul: string; memory: string; name?: string; tagline?: string; model_default?: string; base_url?: string; provider?: string },
    ) =>
      put<{ ok: boolean; id: string }>(`/agents/${encodeURIComponent(id)}/persona`, body),
    create: (body: {
      id: string;
      clone_from: string;
      name?: string;
      tagline?: string;
      soul?: string;
      memory?: string;
      model_default?: string;
      base_url?: string;
      provider?: string;
    }) => post<{ ok: boolean; agent: AgentProfile }>("/agents", body),
    delete: (id: string) =>
      del<{ ok: boolean; id: string }>(`/agents/${encodeURIComponent(id)}`),
  },
  teams: {
    files: (teamId: string) =>
      get<{ files: FileNode[]; root: string }>(`/teams/${encodeURIComponent(teamId)}/files`),
    upload: (teamId: string, path: string, data: string) =>
      post<{ ok: boolean; path: string; synced_desks: number }>(
        `/teams/${encodeURIComponent(teamId)}/files`, { path, data }),
    delete: (teamId: string, path: string) =>
      del<{ ok: boolean }>(`/teams/${encodeURIComponent(teamId)}/files?path=${encodeURIComponent(path)}`),
    sync: (teamId: string) =>
      post<{ ok: boolean; synced_desks: number }>(`/teams/${encodeURIComponent(teamId)}/sync`, {}),
    register: (teamId: string, sessionIds: string[]) =>
      post<{ ok: boolean; registered: number }>(
        `/teams/${encodeURIComponent(teamId)}/register`, { session_ids: sessionIds }),
  },
  guiConfig: () =>
    get<{
      agent_profiles_dir: string;
      default_agent_id?: string;
      desk_default_model: string | null;
      agents: AgentProfile[];
      prototypes: AgentPrototype[];
      global?: { base_url: string; model: string };
      manager: { base_url: string; model: string; uses_effective_agent_model?: boolean };
    }>("/gui-config"),
  globalPersona: {
    get: () =>
      get<{ id: string; profile_path: string; model: string; base_url: string; soul: string; memory: string }>(
        "/global/persona",
      ),
    save: (body: { soul?: string; memory?: string; model_default?: string; base_url?: string; provider?: string }) =>
      put<{ ok: boolean }>("/global/persona", body),
  },
  models: {
    // Reasoning-effort options the given model + backend supports (empty = gray out).
    reasoning: (model?: string, opts?: { baseUrl?: string; agentId?: string }) => {
      const q = new URLSearchParams();
      if (model) q.set("model", model);
      if (opts?.baseUrl) q.set("base_url", opts.baseUrl);
      if (opts?.agentId) q.set("agent_id", opts.agentId);
      const qs = q.toString();
      return get<{ options: { value: string; label: string }[] }>(
        `/models/reasoning${qs ? `?${qs}` : ""}`);
    },
  },
  toolsets: () =>
    get<{
      toolsets: { name: string; label: string; lean: boolean }[];
      presets: { chat: string[]; lean: string[]; full: string[] };
      default: string;
    }>("/toolsets"),
  workspace: {
    open: (path: string) => post<{ ok: boolean }>("/workspace/open", { path }),
    openTerminal: (path: string) => post<{ ok: boolean }>("/workspace/open-terminal", { path }),
  },
  docker: {
    cleanup: () =>
      post<{ removed: number; kept: number; skipped: boolean; reason?: string }>(
        "/docker/cleanup",
        {},
      ),
    getConfig: () => get<{ persist: boolean }>("/docker/config"),
    setConfig: (persist: boolean) =>
      post<{ persist: boolean }>("/docker/config", { persist }),
  },
};
