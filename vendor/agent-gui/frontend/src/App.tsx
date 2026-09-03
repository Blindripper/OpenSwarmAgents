import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type NetworkEvent, type RuntimeStatus } from "./api/client";
import { selectWallet, type WalletInfo, type WalletProvider } from "./api/wallet-provider";
import { WalletSelectorModal } from "./components/WalletSelectorModal";
import { Header } from "./components/Header";
import type { ApiMode, ReasoningEffort } from "./types";
import { Office } from "./components/Office";
import { AgentProfileModal } from "./components/AgentProfileModal";
import { AgentAssignModal } from "./components/AgentAssignModal";
import { DeskAgentPicker } from "./components/DeskAgentPicker";
import { GlobalDefaultPersonaEditor } from "./components/GlobalDefaultPersonaEditor";
import { OpenClawOnboarding } from "./components/OpenClawOnboarding";
import { ProtocolOsPanel } from "./components/ProtocolOsPanel";
import { VaultPanel } from "./components/VaultPanel";
import { JobsPanel } from "./components/JobsPanel";
import { TrustPanel } from "./components/TrustPanel";
import { NetworkChatWindow } from "./components/NetworkChatWindow";
import { ProjectDetailsModal } from "./components/ProjectDetailsModal";
import { ManagerAuditHistoryModal } from "./components/ManagerAuditHistoryModal";
import { ResultCanvas } from "./components/ResultCanvas";
import { loadSnapshotIndex, loadSnapshotWorkbench, saveCurrentProjectSnapshot, SNAPSHOTS_KEY, SNAPSHOT_PREFIX, type SnapshotMeta } from "./components/SnapshotMenu";
import { FilePreview, DEFAULT_CODE_THEME } from "./components/FilePreview";
import type { CodeThemeId } from "./components/FilePreview";
import { DEFAULT_BELL, playBell } from "./sounds";
import { DEFAULT_SCENE } from "./components/SceneBackground";
import { buildDeskConfigView, defaultDeskBarConfig, deskIsRunning, findDeskItem, pendingStartParams, resolveDeskBarConfig, DEFAULT_TASK_AGENT_ID, type DeskBarConfig, type GlobalOpenClawConfig } from "./deskConfig";
import { DESK_PANEL_Z_BASE, nextPanelZ } from "./floatingPanelStack";
import type { DeskItem, FilePreviewData, Session, Team, TeamColor, ToolsetMeta, AgentProfile, AgentPrototype, PendingAssignment, ToolPresetId, AgentCapabilities, TopAgent } from "./types";
import type { OpenClawStatus } from "./api/client";
import { useAgentDrag } from "./useAgentDrag";
import { useRosterLayout } from "./rosterLayout";
import { AgentFigure } from "./components/AgentFigure";
import { effectiveAgentColor, useAvatarPrefs } from "./avatarPrefs";
import { readStoredItem, writeStoredItem, removeStoredItems } from "./storageKeys";
import "./styles/globals.css";

const POLL_INTERVAL = 5000;
const HOME_TEAM_ID = "home-room";
const LEGACY_PUBLIC_TEAM_ID = "public-room";
const LEGACY_PUBLIC_ROOMS_TEAM_ID = "public-rooms-room";
const PUBLIC_PROJECTS_TEAM_ID = "public-projects-room";
const PUBLIC_TEAM_IDS = new Set([LEGACY_PUBLIC_TEAM_ID, LEGACY_PUBLIC_ROOMS_TEAM_ID, PUBLIC_PROJECTS_TEAM_ID]);
// Shown until the backend reports the selected model's real capability.
const EMPTY_REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [];

/** Profile-default model + tools for a desk (avatar pick — not Advanced overrides). */
async function fetchProfileDefaults(
  agentId: string,
  agents: AgentProfile[],
  globalConfig: GlobalOpenClawConfig,
  toolPresets: { chat: string[]; lean: string[]; full: string[] },
  toolDefault: string,
): Promise<{ toolPreset: ToolPresetId; toolsEnabled: string[]; model: string }> {
  if (!agentId) {
    const preset: ToolPresetId =
      toolDefault === "chat" || toolDefault === "full" ? toolDefault : "lean";
    return {
      toolPreset: preset,
      toolsEnabled: toolPresets[preset] ?? toolPresets.lean,
      model: globalConfig.model,
    };
  }
  const agent = agents.find((a) => a.id === agentId);
  let caps: AgentCapabilities;
  try {
    caps = await api.agents.capabilities(agentId);
  } catch {
    caps = {
      id: agentId,
      presets: toolPresets,
      source: "global",
      default_preset: "lean",
      profile_disabled_toolsets: [],
      skill_bundles: [],
      skill_count: 0,
    };
  }
  const def = caps.default_preset;
  const preset: ToolPresetId = def === "chat" || def === "lean" || def === "full" ? def : "lean";
  return {
    toolPreset: preset,
    toolsEnabled: caps.presets[preset] ?? toolPresets.lean,
    model: agent?.model ?? globalConfig.model,
  };
}

const WORKBENCH_KEY_V2 = "osa-workbench-v2";
const WORKBENCH_KEY_V1 = "agent-gui-workbench-v1"; // read-only, backward compat
const LEGACY_STORAGE_PREFIX = ["her", "mes"].join("");
const legacyStorageKey = (name: string) => `${LEGACY_STORAGE_PREFIX}-${name}`;
const WORKBENCH_LEGACY_KEY_V2 = legacyStorageKey("workbench-v2");
const WORKBENCH_LEGACY_KEY_V1 = legacyStorageKey("workbench-v1");
const ONBOARDING_DISMISSED_KEY = "osa-openclaw-onboarding-dismissed";
const WALLET_STORAGE_KEY = "osa-wallet-session";
const RESULT_CANVAS_OPEN_KEY = "osa-result-canvas-open";
type DashboardTab = "workbench" | "work" | "market" | "trust" | "vault";
interface WalletSession {
  address: string;
  chain_id?: string | null;
  connected_at?: string;
  last_seen_at?: string;
  verified?: boolean;
}
interface ShareChannelDraft {
  id: string;
  label: string;
  checked: boolean;
  primary?: boolean;
}
interface ShareProjectDialogState {
  name: string;
  shareFileRepo: boolean;
  channels: ShareChannelDraft[];
  loadingChannels: boolean;
  submitting: boolean;
  error: string | null;
}
const STORAGE_KEYS = {
  codeTheme: { key: "osa-code-theme", legacy: [legacyStorageKey("code-theme")] },
  verbose: { key: "osa-verbose", legacy: [legacyStorageKey("verbose")] },
  reasoningEffort: { key: "osa-reasoning-effort", legacy: [legacyStorageKey("reasoning-effort")] },
  apiMode: { key: "osa-api-mode", legacy: [legacyStorageKey("api-mode")] },
  bellSound: { key: "osa-bell-sound", legacy: [legacyStorageKey("bell-sound")] },
  scene: { key: "osa-scene", legacy: [legacyStorageKey("scene")] },
  showManager: { key: "osa-show-manager", legacy: [legacyStorageKey("show-manager")] },
  managerPatrolInterval: { key: "osa-manager-patrol-interval", legacy: [legacyStorageKey("manager-patrol-interval")] },
  managerIdleGrace: { key: "osa-manager-idle-grace", legacy: [legacyStorageKey("manager-idle-grace")] },
  managerIdleThreshold: { key: "osa-manager-idle-threshold", legacy: [legacyStorageKey("manager-idle-threshold")] },
};

function defaultResultCanvasOpen() {
  const stored = readStoredItem(RESULT_CANVAS_OPEN_KEY);
  if (stored !== null) return stored !== "false";
  return window.innerWidth >= 1100;
}

interface DeskSetupDraft {
  agentId: string;
  model: string;
  toolPreset: ToolPresetId;
  toolsEnabled: string[];
}

type WorkbenchEntry =
  | { type: "session"; id: string; taskContent?: string; taskImages?: { name: string; url: string }[] }
  | { type: "pending"; id: string; text: string };

interface WorkbenchV2 {
  version: 2;
  teams: Array<{ id: string; color: string; name?: string; scene?: string; items: WorkbenchEntry[] }>;
}

function readWorkbenchV2(): WorkbenchV2 | null {
  try {
    const raw = readStoredItem(WORKBENCH_KEY_V2, [WORKBENCH_LEGACY_KEY_V2]);
    if (raw) return JSON.parse(raw) as WorkbenchV2;
    // Backward compat: V1 was a flat array; wrap as Home.
    const v1raw = readStoredItem(WORKBENCH_KEY_V1, [WORKBENCH_LEGACY_KEY_V1]);
    if (v1raw) {
      const items = JSON.parse(v1raw) as WorkbenchEntry[];
      if (items.length > 0) {
        return { version: 2, teams: [{ id: "team-default", color: "blue", items }] };
      }
    }
    return null;
  } catch { return null; }
}

function saveWorkbenchV2(
  teams: Team[],
  pendingTexts: Record<string, string>,
  taskContents: Record<string, string>,
  taskImages: Record<string, { name: string; url: string }[]>,
) {
  try {
    const v2: WorkbenchV2 = {
      version: 2,
      teams: teams.map((t) => ({
        id: t.id,
        color: t.color,
        name: t.name?.trim() || undefined,
        scene: t.scene,
        items: t.desks.map((d) => {
          if ("isPending" in d) return { type: "pending" as const, id: d.id, text: pendingTexts[d.id] ?? "" };
          const entry: WorkbenchEntry = { type: "session" as const, id: d.id };
          const tc = taskContents[d.id];
          if (tc) (entry as { type: "session"; id: string; taskContent?: string }).taskContent = tc;
          const ti = taskImages[d.id];
          if (ti && ti.length > 0) (entry as { type: "session"; id: string; taskImages?: { name: string; url: string }[] }).taskImages = ti;
          return entry;
        }),
      })),
    };
    writeStoredItem(WORKBENCH_KEY_V2, JSON.stringify(v2));
  } catch {}
}

function makePending(): DeskItem {
  return { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`, isPending: true as const };
}

function readWalletSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletSession;
    return parsed.verified === true && /^0x[a-fA-F0-9]{40}$/.test(parsed.address || "") ? parsed : null;
  } catch {
    return null;
  }
}

function readWalletConnected(): boolean {
  return Boolean(readWalletSession());
}

// EIP-6963: find MetaMask provider directly (bypasses selectExtension bug)
// getMetaMaskProvider is now imported from ./api/wallet-provider as getWalletProvider

function stripPublicProjectSessionId(id: string): string {
  return id.replace(/^public-project-/, "");
}

function shareChannelsFromRuntime(status: RuntimeStatus | null): ShareChannelDraft[] {
  const rooms = Array.from(new Set([
    status?.technocorePublicRoom || "osa-network",
    ...(status?.technocoreRooms || []),
  ].map((room) => String(room || "").trim()).filter(Boolean)));
  const primary = rooms.includes("osa-network") ? "osa-network" : rooms[0] || "osa-network";
  return rooms.map((room) => ({
    id: room,
    label: room,
    checked: room === primary,
    primary: room === primary,
  }));
}

function networkEventLabel(event: NetworkEvent): string | null {
  if (event.type === "agentgui_project_shared") return "New public project joined OSA.";
  if (event.type === "agent_registered") return "Network agent came online.";
  if (event.type === "federation_imported") return "A peer node synced new OSA network updates.";
  if (event.type === "network_chat_message") return "New network chat message.";
  return null;
}

function mergeNetworkEvents(current: NetworkEvent[], incoming: NetworkEvent[]): NetworkEvent[] {
  const byId = new Map<string, NetworkEvent>();
  for (const event of [...incoming, ...current]) {
    if (event?.id) byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100);
}

function publicProjectIdFromSession(session: Session): string | null {
  return session.id.startsWith("public-project-") ? session.id.slice("public-project-".length) : null;
}

function publicProjectIdFromTopAgent(project: TopAgent): string | null {
  return project.target_id || (project.id.startsWith("public-project-") ? project.id.slice("public-project-".length) : null);
}

function rankingEventChanged(event: NetworkEvent): boolean {
  return [
    "agentgui_project_shared",
    "agentgui_public_project_copied",
    "agentgui_donation_pledged",
    "agentgui_project_review_created",
    "agentgui_project_review_updated",
    "federation_imported",
  ].includes(event.type);
}

function makeHomeTeam(desks: DeskItem[] = [makePending()]): Team {
  return { id: HOME_TEAM_ID, name: "Home", color: "blue", scene: DEFAULT_SCENE, desks };
}

function makePublicProjectsTeam(desks: DeskItem[] = []): Team {
  return { id: PUBLIC_PROJECTS_TEAM_ID, name: "Latest Projects", color: "orange", scene: "night", desks };
}

function isPublicSession(session: Session): boolean {
  return PUBLIC_TEAM_IDS.has(session.team_id || "");
}

function isPrivateSession(session: Session): boolean {
  return !isPublicSession(session);
}

function privateTeamId(session: Session): string {
  const id = session.team_id?.trim();
  return id && !PUBLIC_TEAM_IDS.has(id) ? id : HOME_TEAM_ID;
}

function makePrivateTeam(id: string, name?: string | null, desks: DeskItem[] = []): Team {
  if (id === HOME_TEAM_ID) return makeHomeTeam(desks);
  return {
    id,
    name: name?.trim() || "Room",
    color: "green",
    scene: DEFAULT_SCENE,
    desks,
  };
}

// OSA rooms: Home and custom private rooms can run local agents. Latest Projects
// is the only public marketplace view; a shared project contains all private
// rooms and agents as one copy-only bundle.
function mergeServerTeams(
  current: Team[],
  sessions: Session[],
  options: { includeUnplacedPrivate?: boolean } = {},
): Team[] {
  const includeUnplacedPrivate = options.includeUnplacedPrivate !== false;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const placedPrivateIds = new Set<string>();
  const privateTeams: Team[] = [];

  for (const sourceTeam of current.filter((team) => !PUBLIC_TEAM_IDS.has(team.id))) {
    const teamId = sourceTeam.id || HOME_TEAM_ID;
    const desks = sourceTeam.desks
      .map((desk) => {
        if ("isPending" in desk) return desk;
        const fresh = byId.get(desk.id);
        if (!fresh || !isPrivateSession(fresh) || privateTeamId(fresh) !== teamId) return null;
        placedPrivateIds.add(fresh.id);
        return fresh;
      })
      .filter((desk): desk is DeskItem => Boolean(desk));
    if (!desks.some((desk) => "isPending" in desk)) desks.unshift(makePending());
    privateTeams.push({
      ...sourceTeam,
      id: teamId,
      name: teamId === HOME_TEAM_ID ? "Home" : sourceTeam.name || "Room",
      desks,
    });
  }

  if (!privateTeams.some((team) => team.id === HOME_TEAM_ID)) {
    privateTeams.unshift(makeHomeTeam());
  }

  if (includeUnplacedPrivate) {
    for (const session of sessions.filter(isPrivateSession)) {
      if (placedPrivateIds.has(session.id)) continue;
      const teamId = privateTeamId(session);
      let team = privateTeams.find((item) => item.id === teamId);
      if (!team) {
        team = makePrivateTeam(teamId, session.team_name, [makePending()]);
        privateTeams.push(team);
      }
      team.desks.push(session);
      placedPrivateIds.add(session.id);
    }
  }

  const orderedPrivate = [
    ...privateTeams.filter((team) => team.id === HOME_TEAM_ID),
    ...privateTeams.filter((team) => team.id !== HOME_TEAM_ID),
  ];
  return orderedPrivate;
}

function serverTeamName(teamId: string, sessions: Session[]): string {
  if (teamId === HOME_TEAM_ID) return "Home";
  if (PUBLIC_TEAM_IDS.has(teamId)) return "Public";
  const session = sessions.find((item) => item.team_id === teamId);
  return session?.team_name?.trim() || "Home";
}

function WalletGate({
  onConnect,
  error,
  pending,
}: {
  onConnect: () => void;
  error: string | null;
  pending: boolean;
}) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      alignItems: "center",
      justifyItems: "center",
      padding: 24,
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "system-ui, sans-serif",
      boxSizing: "border-box",
    }}>
      <div style={{
        width: "min(680px, 100%)",
        border: "1px solid #2a3558",
        borderRadius: 8,
        background: "#101827",
        padding: 28,
        boxShadow: "0 24px 80px rgba(0, 0, 0, 0.36)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <img src="/osa-logo.svg" alt="OSA" width={44} height={44} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0 }}>OpenSwarmAgents</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#7ee0c2", letterSpacing: 0 }}>Wallet identity required</div>
          </div>
        </div>
        <div style={{ fontSize: 38, lineHeight: 1.05, fontWeight: 950, maxWidth: 620, letterSpacing: 0, marginBottom: 14 }}>
          Connect a wallet before agents enter the network.
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-dim)", marginBottom: 20 }}>
          OSA uses your EVM public key as the project owner identity for sharing, reviews, FLOP pledge intents, and future FLOP incentives. Login does not ask for a private key and does not send a transaction.
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 22,
        }}>
          {[
            ["DRAFT", "$FLOP status"],
            ["Q4 2026", "testnet target"],
            ["Q1 2027", "mainnet target"],
          ].map(([value, label]) => (
            <div key={label} style={{
              border: "1px solid #2a3558",
              borderRadius: 6,
              background: "#121828",
              padding: 12,
            }}>
              <div style={{ fontSize: 22, fontWeight: 950, color: "var(--accent2)", letterSpacing: 0 }}>{value}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-dim)" }}>{label}</div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onConnect}
          disabled={pending}
          style={{
            height: 40,
            padding: "0 18px",
            borderRadius: 6,
            border: "1px solid #2a8c72",
            background: pending ? "#17251f" : "#16a37b",
            color: "white",
            fontSize: 14,
            fontWeight: 900,
            cursor: pending ? "default" : "pointer",
          }}
        >
          {pending ? "Connecting" : "Connect Wallet"}
        </button>
        {error && <div style={{ marginTop: 12, color: "#ff8a8a", fontSize: 13 }}>{error}</div>}
        <div style={{ marginTop: 18, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.55 }}>
          Prelaunch warning: $FLOP is not live yet and the official specification is still a draft. OSA records pledge intents only; it does not transfer tokens, show a balance, or promise rewards.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [teams, setTeams] = useState<Team[]>([makeHomeTeam()]);
  const [pendingTexts, setPendingTexts] = useState<Record<string, string>>({});
  const [justStartedId, setJustStartedId] = useState<string | null>(null);
  const [justStartedAnchor, setJustStartedAnchor] = useState<{ top: number; left: number } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("workbench");
  const [networkLive, setNetworkLive] = useState(false);
  const [networkNotice, setNetworkNotice] = useState<string | null>(null);
  const [networkEvents, setNetworkEvents] = useState<NetworkEvent[]>([]);
  const [networkEventsLoading, setNetworkEventsLoading] = useState(false);
  const [networkChatRefreshKey, setNetworkChatRefreshKey] = useState(0);
  const [projectDetails, setProjectDetails] = useState<{ projectId: string; fallback?: TopAgent | null } | null>(null);
  const [shareDialog, setShareDialog] = useState<ShareProjectDialogState | null>(null);
  const [savedProjectTabs, setSavedProjectTabs] = useState<SnapshotMeta[]>(() => loadSnapshotIndex());
  const [activeSavedProject, setActiveSavedProject] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [walletConnected, setWalletConnected] = useState(readWalletConnected);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => readWalletSession()?.address || null);
  const [flopStatusLabel, setFlopStatusLabel] = useState("Prelaunch");
  const [walletConnectError, setWalletConnectError] = useState<string | null>(null);
  const [walletConnectPending, setWalletConnectPending] = useState(false);
  const [preview, setPreview] = useState<FilePreviewData | null>(null);
  const [resultCanvasOpen, setResultCanvasOpen] = useState(defaultResultCanvasOpen);
  const panelZCounter = useRef(DESK_PANEL_Z_BASE);
  const [deskPanelZ, setDeskPanelZ] = useState<Record<string, number>>({});
  const [previewZ, setPreviewZ] = useState(DESK_PANEL_Z_BASE);

  const activateDeskPanel = useCallback((deskId: string) => {
    const z = nextPanelZ(panelZCounter);
    setDeskPanelZ((prev) => ({ ...prev, [deskId]: z }));
  }, []);

  const activateFilePreview = useCallback(() => {
    setPreviewZ(nextPanelZ(panelZCounter));
  }, []);

  function handleFilePreview(data: FilePreviewData) {
    setPreview((cur) => {
      const closing = cur?.path === data.path;
      if (!closing) setPreviewZ(nextPanelZ(panelZCounter));
      return closing ? null : data;
    });
  }
  const [codeTheme, setCodeTheme] = useState<CodeThemeId>(() => {
    return (readStoredItem(STORAGE_KEYS.codeTheme.key, STORAGE_KEYS.codeTheme.legacy) as CodeThemeId) || DEFAULT_CODE_THEME;
  });
  // Server-side Docker cleanup policy (⚙ → Docker). Loaded from the backend on
  // mount; toggling POSTs back. Default off = reap containers on delete/shutdown.
  const [dockerPersist, setDockerPersist] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [workspacePaths, setWorkspacePaths] = useState<Record<string, string>>({});
  const [taskContents, setTaskContents] = useState<Record<string, string>>({});
  const [taskImages, setTaskImages] = useState<Record<string, { name: string; url: string }[]>>({});
  // Pending desk → agent + tool preset chosen from the bench before Start.
  const [pendingAssignments, setPendingAssignments] = useState<Record<string, PendingAssignment>>({});
  const [activePendingDeskId, setActivePendingDeskId] = useState<string | null>(null);
  const [focusedDeskId, setFocusedDeskId] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<{ deskId: string; agent: AgentProfile } | null>(null);
  const [verbose, setVerbose] = useState(() => {
    const stored = readStoredItem(STORAGE_KEYS.verbose.key, STORAGE_KEYS.verbose.legacy);
    return stored === null ? true : stored === "true";
  });
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => {
    return (readStoredItem(STORAGE_KEYS.reasoningEffort.key, STORAGE_KEYS.reasoningEffort.legacy) as ReasoningEffort) || "medium";
  });
  // Reasoning-effort options for the selected model (capability-driven, fetched
  // from the backend). qwen → Off/On; empty → gray out.
  const [reasoningOptions, setReasoningOptions] =
    useState<{ value: ReasoningEffort; label: string }[]>(EMPTY_REASONING_OPTIONS);
  const [apiMode, setApiMode] = useState<ApiMode>(() => {
    return (readStoredItem(STORAGE_KEYS.apiMode.key, STORAGE_KEYS.apiMode.legacy) as ApiMode) || "openai";
  });
  const avatars = useAvatarPrefs();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [prototypes, setPrototypes] = useState<AgentPrototype[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string>(DEFAULT_TASK_AGENT_ID);
  const [agentModal, setAgentModal] = useState<
    { mode: "create" | "edit"; agent?: AgentProfile | null } | null
  >(null);
  const [deskAgentPickerId, setDeskAgentPickerId] = useState<string | null>(null);
  const [defaultAgentEditorOpen, setDefaultAgentEditorOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const rosterRef = useRef<HTMLDivElement>(null);
  const [deskDefaultModel, setDeskDefaultModel] = useState<string>("");
  const [globalConfig, setGlobalConfig] = useState<GlobalOpenClawConfig>({ base_url: "", model: "" });
  const [deskBarConfigs, setDeskBarConfigs] = useState<Record<string, DeskBarConfig>>({});
  const [toolsets, setToolsets] = useState<ToolsetMeta[]>([]);
  const [toolPresets, setToolPresets] = useState<{ chat: string[]; lean: string[]; full: string[] }>(
    { chat: [], lean: [], full: [] });
  const [toolDefault, setToolDefault] = useState<string>("lean");
  const [bellSound, setBellSound] = useState<string>(() => {
    return readStoredItem(STORAGE_KEYS.bellSound.key, STORAGE_KEYS.bellSound.legacy) || DEFAULT_BELL;
  });
  const [scene, setScene] = useState<string>(() => {
    return readStoredItem(STORAGE_KEYS.scene.key, STORAGE_KEYS.scene.legacy) || DEFAULT_SCENE;
  });
  const [showManager, setShowManager] = useState<boolean>(() => {
    return readStoredItem(STORAGE_KEYS.showManager.key, STORAGE_KEYS.showManager.legacy) !== "false";
  });
  const [managerPatrolIntervalSec, setManagerPatrolIntervalSec] = useState<number>(() => {
    const v = readStoredItem(STORAGE_KEYS.managerPatrolInterval.key, STORAGE_KEYS.managerPatrolInterval.legacy);
    if (v) return parseInt(v, 10) || 600;
    const legacy = readStoredItem(STORAGE_KEYS.managerIdleThreshold.key, STORAGE_KEYS.managerIdleThreshold.legacy);
    return legacy ? parseInt(legacy, 10) || 600 : 600;
  });
  const [managerIdleGraceSec, setManagerIdleGraceSec] = useState<number>(() => {
    const v = readStoredItem(STORAGE_KEYS.managerIdleGrace.key, STORAGE_KEYS.managerIdleGrace.legacy);
    if (v) return parseInt(v, 10) || 60;
    const legacy = readStoredItem(STORAGE_KEYS.managerIdleThreshold.key, STORAGE_KEYS.managerIdleThreshold.legacy);
    return legacy ? parseInt(legacy, 10) || 60 : 60;
  });
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawStatus | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => readStoredItem(ONBOARDING_DISMISSED_KEY) !== "1",
  );
  const [managerAuditHistoryTeamId, setManagerAuditHistoryTeamId] = useState<string | null>(null);
  // Per-team ask-manager: maps team.id → session id to prioritise (null = full patrol)
  const [askManagerByTeamId, setAskManagerByTeamId] = useState<Record<string, string | null>>({});
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string>>(new Set());
  const [searchStats, setSearchStats] = useState<{ onFloor: number; total: number } | null>(null);

  const sessionsRef = useRef<Session[]>([]);
  const workbenchRestoredRef = useRef(false);
  const projectScopedRef = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.sessions.list(50);
      setSessions(data);
      sessionsRef.current = data;

      if (!workbenchRestoredRef.current) {
        workbenchRestoredRef.current = true;
        const saved = readWorkbenchV2();
        if (saved && saved.teams.length > 0) {
          const pendingTextsInit: Record<string, string> = {};
          const taskContentsInit: Record<string, string> = {};
          const taskImagesInit: Record<string, { name: string; url: string }[]> = {};
          const restoredTeams: Team[] = [];

          // The session list is capped (most-recent 50), but a snapshot/workbench
          // can reference older sessions. Look up referenced sessions in a map and
          // fetch any that the capped list missed — otherwise restoring a snapshot
          // silently drops every desk whose session isn't in the latest 50, which
          // looks like "the snapshot won't load". Truly-deleted sessions 404 and
          // are dropped (they really are gone).
          const known = new Map(data.map((s) => [s.id, s]));
          const missingIds = Array.from(new Set(
            saved.teams
              .flatMap((t) => t.items)
              .filter((it) => it.type === "session" && !known.has(it.id))
              .map((it) => it.id),
          ));
          if (missingIds.length > 0) {
            const fetched = await Promise.all(
              missingIds.map((id) => api.sessions.get(id).catch(() => null)),
            );
            for (const s of fetched) if (s) known.set(s.id, s);
          }

          for (const teamData of saved.teams) {
            if (PUBLIC_TEAM_IDS.has(teamData.id)) continue;
            const restoredDesks: DeskItem[] = [];
            for (const item of teamData.items) {
              if (item.type === "session") {
                const session = known.get(item.id);
                if (session) {
                  restoredDesks.push(session);
                  if (item.taskContent) taskContentsInit[item.id] = item.taskContent;
                  if (item.taskImages && item.taskImages.length > 0) taskImagesInit[item.id] = item.taskImages;
                }
              } else {
                const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                restoredDesks.push({ id, isPending: true as const });
                if (item.text) pendingTextsInit[id] = item.text;
              }
            }
            if (restoredDesks.length === 0) restoredDesks.push(makePending());
            restoredTeams.push({
              id: teamData.id,
              color: (teamData.color as TeamColor) ?? "blue",
              name: teamData.name,
              scene: teamData.scene,
              desks: restoredDesks,
            });
          }

          if (restoredTeams.length > 0) {
            projectScopedRef.current = true;
            setTeams(mergeServerTeams(restoredTeams, data, { includeUnplacedPrivate: false }));
            if (Object.keys(pendingTextsInit).length > 0) setPendingTexts(pendingTextsInit);
            if (Object.keys(taskContentsInit).length > 0) setTaskContents(taskContentsInit);
            if (Object.keys(taskImagesInit).length > 0) setTaskImages(taskImagesInit);
            setBackendError(null);
            return;
          }
        }
        // No saved workbench (or nothing restored): still surface server-side teams
        // (e.g. script-created desks) so they appear in the office on a fresh load.
        setTeams((prev) => mergeServerTeams(prev, data, {
          includeUnplacedPrivate: !projectScopedRef.current,
        }));
      } else {
        // Normal poll: refresh session data across all teams + merge in any
        // newly-appeared server-side teams (script-created desks).
        setTeams((prev) =>
          mergeServerTeams(
            prev.map((t) => ({
              ...t,
              desks: t.desks.map((d) => {
                if ("isPending" in d) return d;
                const fresh = data.find((s) => s.id === d.id);
                return fresh ?? d;
              }),
            })),
            data,
            { includeUnplacedPrivate: !projectScopedRef.current },
          )
        );
      }
      setBackendError(null);
    } catch {
      setBackendError("Could not reach the OSA backend. Is it running?");
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      const r = await api.guiConfig();
      setAgents(r.agents ?? []);
      setPrototypes(r.prototypes ?? []);
      setDefaultAgentId(r.default_agent_id ?? DEFAULT_TASK_AGENT_ID);
      setDeskDefaultModel(r.desk_default_model ?? "");
      setGlobalConfig({
        base_url: r.global?.base_url ?? r.manager?.base_url ?? "",
        model: r.global?.model ?? r.desk_default_model ?? "",
      });
    } catch { /* ignore */ }
  }, []);

  const refreshNetworkActivity = useCallback(async () => {
    setNetworkEventsLoading(true);
    try {
      const r = await api.network.activity(100);
      setNetworkEvents(r.events ?? []);
    } catch {
      setNetworkEvents([]);
    } finally {
      setNetworkEventsLoading(false);
    }
  }, []);

  const refreshWalletBalance = useCallback(async () => {
    const wallet = readWalletSession();
    setWalletAddress(wallet?.address || null);
    if (!wallet?.address) {
      setFlopStatusLabel("Prelaunch");
      return;
    }
    try {
      const balance = await api.wallet.balance(wallet.address);
      setFlopStatusLabel(balance.formatted || "Prelaunch");
    } catch {
      setFlopStatusLabel("Prelaunch");
    }
  }, []);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const health = await api.health();
      setRuntimeStatus(health.runtime ?? null);
    } catch {
      setRuntimeStatus(null);
    }
  }, []);

  const refreshNetworkViews = useCallback(() => {
    void loadSessions();
    void refreshNetworkActivity();
    void refreshRuntimeStatus();
    const connected = readWalletConnected();
    setWalletConnected(connected);
    void refreshWalletBalance();
  }, [loadSessions, refreshNetworkActivity, refreshRuntimeStatus, refreshWalletBalance]);

  useEffect(() => {
    loadSessions();
    api.openclaw.warmup().catch(() => {});
    api.openclaw.status().then(setOpenClawStatus).catch(() => {});
    api.guiConfig().then((r) => {
      setAgents(r.agents ?? []);
      setPrototypes(r.prototypes ?? []);
      setDefaultAgentId(r.default_agent_id ?? DEFAULT_TASK_AGENT_ID);
      setDeskDefaultModel(r.desk_default_model ?? "");
      setGlobalConfig({
        base_url: r.global?.base_url ?? r.manager?.base_url ?? "",
        model: r.global?.model ?? r.desk_default_model ?? "",
      });
    }).catch(() => {});
    api.toolsets().then((r) => { setToolsets(r.toolsets); setToolPresets(r.presets); setToolDefault(r.default); }).catch(() => {});
    // Also re-pull the roster: profiles installed/changed on disk while the GUI
    // is open (e.g. install_profiles.sh) otherwise never appear until a reload.
    refreshNetworkActivity();
    refreshRuntimeStatus();
    refreshWalletBalance();
    const poll = setInterval(() => {
      loadSessions();
      refreshAgents();
      refreshNetworkActivity();
      refreshRuntimeStatus();
      setWalletConnected(readWalletConnected());
      refreshWalletBalance();
    }, POLL_INTERVAL);
    return () => clearInterval(poll);
  }, [loadSessions, refreshAgents, refreshNetworkActivity, refreshRuntimeStatus, refreshWalletBalance]);

  useEffect(() => {
    const source = api.networkStream((event) => {
      setNetworkLive(true);
      setNetworkEvents((current) => mergeNetworkEvents(current, [event]));
      if (event.type === "network_chat_message") setNetworkChatRefreshKey((key) => key + 1);
      const label = networkEventLabel(event);
      if (label) {
        setNetworkNotice(label);
        try { playBell(bellSound); } catch { /* bell is optional */ }
        window.setTimeout(() => setNetworkNotice((current) => current === label ? null : current), 5200);
      }
      if (rankingEventChanged(event)) refreshNetworkViews();
    }, () => setNetworkLive(false));
    source.onopen = () => setNetworkLive(true);
    return () => source.close();
  }, [bellSound, refreshNetworkViews]);

  // Listen for claim-job events from JobsPanel — switch to Workspaces/Projects
  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; claim: Record<string, unknown> }>).detail;
      setDashboardTab("workbench");
      try {
        const session = await api.sessions.get(detail.sessionId);
        // Add the claimed session to the Home team so it appears as a workspace room
        setTeams((prev) => prev.map((t) => {
          if (t.id !== HOME_TEAM_ID) return t;
          const alreadyExists = t.desks.some((d) => !("isPending" in d) && (d as Session).id === session.id);
          if (alreadyExists) return t;
          const pendingDesks = t.desks.filter((d) => "isPending" in d);
          const sessionDesks = t.desks.filter((d) => !("isPending" in d));
          return { ...t, desks: [...pendingDesks, session, ...sessionDesks] };
        }));
      } catch {
        console.warn("claim-job: could not fetch session");
      }
      void loadSessions();
    };
    window.addEventListener("osa:claim-job", handler);
    return () => window.removeEventListener("osa:claim-job", handler);
  }, [loadSessions, HOME_TEAM_ID]);

  // Persist workbench to localStorage on every change
  useEffect(() => {
    if (workbenchRestoredRef.current) saveWorkbenchV2(teams, pendingTexts, taskContents, taskImages);
  }, [teams, pendingTexts, taskContents, taskImages]);

  // Load the server's Docker cleanup policy once so the ⚙ toggle reflects it.
  useEffect(() => {
    api.docker.getConfig().then((r) => setDockerPersist(r.persist)).catch(() => {});
  }, []);

  // Tab adds a desk to Home. Shift+Tab is the global shortcut and works
  // even while a field is focused — the pending desk's task box auto-focuses on
  // load, so a guard that bailed on any focused input made Shift+Tab a no-op in
  // the app's default state. Plain Tab still only fires outside fields so normal
  // tabbing inside inputs/textareas is preserved.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const tag = (document.activeElement as Element | null)?.tagName ?? "";
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (inField && !e.shiftKey) return;
      e.preventDefault();
      const newDesk = makePending();
      setFocusedDeskId(newDesk.id);
      setTeams((prev) => {
        return prev.map((t) =>
          t.id === HOME_TEAM_ID ? { ...t, desks: [...t.desks, newDesk] } : t
        );
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Tool presets (for desk config defaults) ────────────────────────────────

  const selectedDeskId = focusedDeskId ?? activePendingDeskId;
  const selectedCanvasSession = useMemo(() => {
    const item = selectedDeskId ? findDeskItem(teams, selectedDeskId) : null;
    return item && "started_at" in item ? item as Session : null;
  }, [selectedDeskId, teams]);

  const deskConfigsById = useMemo(() => {
    const map: Record<string, NonNullable<ReturnType<typeof buildDeskConfigView>>> = {};
    for (const team of teams) {
      for (const desk of team.desks) {
        const view = buildDeskConfigView(
          desk.id, teams, agents, pendingAssignments, deskBarConfigs,
          globalConfig, toolPresets, toolDefault, defaultAgentId,
        );
        if (view) map[desk.id] = view;
      }
    }
    return map;
  }, [teams, agents, pendingAssignments, deskBarConfigs, globalConfig, toolPresets, toolDefault, defaultAgentId]);

  const deskConfig = selectedDeskId ? (deskConfigsById[selectedDeskId] ?? null) : null;
  const deskConfigLocked = !selectedDeskId || deskIsRunning(findDeskItem(teams, selectedDeskId));

  // Model + backend used to query /api/models/reasoning for the focused desk.
  const reasoningContext = useMemo(() => {
    if (selectedDeskId) {
      const cfg = deskConfigsById[selectedDeskId];
      if (cfg) {
        return {
          model: cfg.model || cfg.profileModel || globalConfig.model || deskDefaultModel || "",
          baseUrl: cfg.baseUrl || globalConfig.base_url,
          agentId: cfg.agentId || undefined,
        };
      }
    }
    return {
      model: globalConfig.model || deskDefaultModel || "",
      baseUrl: globalConfig.base_url,
      agentId: undefined as string | undefined,
    };
  }, [selectedDeskId, deskConfigsById, globalConfig.model, globalConfig.base_url, deskDefaultModel]);

  // Refresh the reasoning-effort menu when the focused desk's model/backend changes.
  useEffect(() => {
    let cancelled = false;
    const { model, baseUrl, agentId } = reasoningContext;
    api.models.reasoning(model || undefined, { baseUrl, agentId }).then((r) => {
      if (cancelled) return;
      const opts = r.options as { value: ReasoningEffort; label: string }[];
      setReasoningOptions(opts);
      if (opts.length && !opts.some((o) => o.value === reasoningEffort)) {
        const fallback = opts[opts.length - 1].value;
        setReasoningEffort(fallback);
        writeStoredItem(STORAGE_KEYS.reasoningEffort.key, fallback);
      }
    }).catch(() => { if (!cancelled) setReasoningOptions(EMPTY_REASONING_OPTIONS); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasoningContext.model, reasoningContext.baseUrl, reasoningContext.agentId]);

  // Only send reasoning_effort to the backend when the focused desk's model supports it.
  const apiReasoningEffort = reasoningOptions.length > 0 ? reasoningEffort : undefined;

  function upsertDeskBarConfig(deskId: string, patch: Partial<DeskBarConfig>) {
    setDeskBarConfigs((prev) => {
      const cur = resolveDeskBarConfig(deskId, prev, globalConfig, toolPresets, toolDefault, defaultAgentId);
      return { ...prev, [deskId]: { ...cur, ...patch } };
    });
  }

  useEffect(() => {
    if (focusedDeskId && !findDeskItem(teams, focusedDeskId)) {
      setFocusedDeskId(null);
    }
    if (activePendingDeskId && !findDeskItem(teams, activePendingDeskId)) {
      setActivePendingDeskId(null);
    }
  }, [teams, focusedDeskId, activePendingDeskId]);

  async function handleDeskProfileChange(deskId: string, agentId: string) {
    setFocusedDeskId(deskId);
    const desk = findDeskItem(teams, deskId);
    if (!desk) return;
    if (deskIsRunning(desk)) return;

    if ("isPending" in desk) {
      if (!agentId) {
        setPendingAssignments((prev) => {
          const next = { ...prev };
          delete next[deskId];
          return next;
        });
        upsertDeskBarConfig(deskId, defaultDeskBarConfig(globalConfig, toolPresets, toolDefault, defaultAgentId));
        return;
      }
      const defaults = await fetchProfileDefaults(
        agentId, agents, globalConfig, toolPresets, toolDefault,
      );
      const agent = agents.find((a) => a.id === agentId);
      setPendingAssignments((prev) => ({
        ...prev,
        [deskId]: {
          agentId,
          agentName: agent?.name ?? agentId,
          agentColor: effectiveAgentColor(agent, avatars.get(agentId)),
          toolPreset: defaults.toolPreset,
          toolsEnabled: defaults.toolsEnabled,
          customized: false,
        },
      }));
      upsertDeskBarConfig(deskId, {
        agentId,
        model: defaults.model,
        toolPreset: defaults.toolPreset,
        toolsEnabled: defaults.toolsEnabled,
        customized: false,
      });
      return;
    }

    try {
      if (!agentId) {
        const updated = await api.sessions.patchDeskConfig(deskId, { agent: "" });
        upsertDeskBarConfig(deskId, defaultDeskBarConfig(globalConfig, toolPresets, toolDefault, defaultAgentId));
        setSessions((prev) => prev.map((s) => (s.id === deskId ? { ...s, ...updated } : s)));
        setTeams((prev) => prev.map((t) => ({
          ...t,
          desks: t.desks.map((d) => (!("isPending" in d) && d.id === deskId ? { ...d, ...updated } : d)),
        })));
        return;
      }

      const defaults = await fetchProfileDefaults(
        agentId, agents, globalConfig, toolPresets, toolDefault,
      );
      const updated = await api.sessions.patchDeskConfig(deskId, {
        agent: agentId,
        tools: defaults.toolsEnabled,
        model: defaults.model,
      });
      upsertDeskBarConfig(deskId, {
        agentId,
        model: updated.agent_model || defaults.model,
        toolPreset: defaults.toolPreset,
        toolsEnabled: defaults.toolsEnabled,
        customized: false,
      });
      setSessions((prev) => prev.map((s) => (s.id === deskId ? { ...s, ...updated } : s)));
      setTeams((prev) => prev.map((t) => ({
        ...t,
        desks: t.desks.map((d) => (!("isPending" in d) && d.id === deskId ? { ...d, ...updated } : d)),
      })));
    } catch (e) {
      console.warn("desk profile change failed:", e);
    }
  }

  async function handleDeskSetupSave(deskId: string, draft: DeskSetupDraft) {
    setFocusedDeskId(deskId);
    const desk = findDeskItem(teams, deskId);
    if (!desk) return;
    if (deskIsRunning(desk)) return;

    const profileModel = draft.agentId
      ? agents.find((a) => a.id === draft.agentId)?.model ?? globalConfig.model
      : globalConfig.model;
    const modelOverride = draft.model && draft.model !== profileModel ? draft.model : undefined;

    if ("isPending" in desk) {
      if (draft.agentId) {
        const agent = agents.find((a) => a.id === draft.agentId);
        setPendingAssignments((prev) => ({
          ...prev,
          [deskId]: {
            agentId: draft.agentId,
            agentName: agent?.name ?? draft.agentId,
            agentColor: effectiveAgentColor(agent, avatars.get(draft.agentId)),
            toolPreset: draft.toolPreset,
            toolsEnabled: draft.toolsEnabled,
            ...(modelOverride ? { modelOverride } : {}),
            customized: true,
          },
        }));
      } else {
        setPendingAssignments((prev) => {
          const next = { ...prev };
          delete next[deskId];
          return next;
        });
      }
      upsertDeskBarConfig(deskId, {
        agentId: draft.agentId,
        model: draft.model,
        toolPreset: draft.toolPreset,
        toolsEnabled: draft.toolsEnabled,
        customized: true,
      });
      return;
    }

    try {
      const body: { agent?: string; model?: string; tools?: string[] } = {
        tools: draft.toolsEnabled,
        model: draft.model,
      };
      if (draft.agentId) body.agent = draft.agentId;
      else body.agent = "";
      const updated = await api.sessions.patchDeskConfig(deskId, body);
      upsertDeskBarConfig(deskId, {
        agentId: draft.agentId,
        model: draft.model,
        toolPreset: draft.toolPreset,
        toolsEnabled: draft.toolsEnabled,
        customized: true,
      });
      setSessions((prev) => prev.map((s) => (s.id === deskId ? { ...s, ...updated } : s)));
      setTeams((prev) => prev.map((t) => ({
        ...t,
        desks: t.desks.map((d) => (!("isPending" in d) && d.id === deskId ? { ...d, ...updated } : d)),
      })));
    } catch (e) {
      console.warn("desk setup save failed:", e);
      throw e;
    }
  }

  async function applyDeskCustomization(deskId: string, patch: Partial<DeskSetupDraft>) {
    const cfg = deskConfigsById[deskId];
    if (!cfg) return;
    await handleDeskSetupSave(deskId, {
      agentId: patch.agentId ?? cfg.agentId,
      model: patch.model ?? cfg.model,
      toolPreset: patch.toolPreset ?? cfg.toolPreset,
      toolsEnabled: patch.toolsEnabled ?? cfg.toolsEnabled,
    });
  }

  function handleDeskFocus(deskId: string) {
    setFocusedDeskId(deskId);
    const desk = findDeskItem(teams, deskId);
    if (desk && "isPending" in desk) {
      setActivePendingDeskId(deskId);
    } else {
      setActivePendingDeskId(null);
    }
  }

  /** Click the desk avatar → focus + glow it. The avatar's ⚙ gear (next to it)
   *  opens the agent-settings subpage; we no longer pop the picker modal here. */
  function handleAvatarClick(deskId: string) {
    handleDeskFocus(deskId);
  }

  function handleActivePendingDeskChange(deskId: string | null) {
    setActivePendingDeskId(deskId);
    if (deskId) setFocusedDeskId(deskId);
  }

  // ── Desk / team callbacks ──────────────────────────────────────────────────

  async function handleDeskStart(
    deskId: string,
    msg: string,
    _agentId: string,
    images?: { name: string; url: string }[],
    anchor?: { top: number; left: number },
  ) {
    const attachments = images?.map((img) => ({ name: img.name, data: img.url }));
    const start = pendingStartParams(
      deskId, pendingAssignments, deskBarConfigs, globalConfig, toolPresets, toolDefault, true, defaultAgentId,
    );

    const teamId = teams.find((t) => t.desks.some((d) => d.id === deskId))?.id;
    let started;
    try {
      const team = teams.find((t) => t.id === teamId);
      const wallet = readWalletSession();
      if (!wallet) {
        setWalletConnected(false);
        setWalletConnectError("Connect your wallet before starting wallet-owned agent work.");
        return;
      }
      started = await api.sessions.new(
        msg, apiReasoningEffort, apiMode,
        start.model,
        attachments, start.tools,
        start.agent,
        teamId,
        team?.name,
        wallet.address,
      );
    } catch (e) {
      // Surface a failed start (e.g. backend unreachable, bad profile) instead of
      // leaving the desk silently stuck on "starting".
      window.alert((e as Error).message || "Couldn't start this desk.");
      return;
    }
    const { session_id, workspace_path, session: provisional } = started;
    const sessionRaw = provisional ?? await api.sessions.get(session_id);
    const session: Session = {
      ...sessionRaw,
      title: sessionRaw.title?.trim()
        || msg.trim().slice(0, 80).replace(/\n/g, " ")
        || "Untitled task",
    };
    setJustStartedId(session_id);
    setJustStartedAnchor(anchor ?? null);
    setPendingAssignments((prev) => {
      const next = { ...prev };
      delete next[deskId];
      return next;
    });
    setDeskBarConfigs((prev) => {
      const next = { ...prev };
      if (next[deskId]) {
        next[session_id] = next[deskId];
        delete next[deskId];
      } else {
        delete next[deskId];
      }
      return next;
    });
    setFocusedDeskId(session_id);
    setActivePendingDeskId(null);
    // Replace pending desk with session in whichever team contains it
    setTeams((prev) => prev.map((t) => ({
      ...t,
      desks: t.desks.map((d) => (d.id === deskId ? session : d)),
    })));
    setSessions((prev) => [...prev, session]);
    sessionsRef.current = [...sessionsRef.current, session];
    if (workspace_path) {
      setWorkspacePaths((prev) => ({ ...prev, [session_id]: workspace_path }));
    }
    setTaskContents((prev) => ({ ...prev, [session_id]: msg }));
    if (images && images.length > 0) {
      setTaskImages((prev) => ({ ...prev, [session_id]: images }));
    }
  }

  function handleSessionInterrupt(id: string) {
    setTeams((prev) => prev.map((t) => ({
      ...t,
      desks: t.desks.map((d) => {
        if ("isPending" in d || d.id !== id) return d;
        return { ...d, is_running: false };
      }),
    })));
  }

  // Drag an agent off the bench onto a desk. On a live/idle session it resumes the
  // workflow with that (possibly different) agent; on a pending desk it just
  // preselects the agent in the picker so the user can type a task and Start.
  async function handleAssignAgentToDesk(deskId: string, agentId: string) {
    if (agentId && !agents.some((a) => a.id === agentId)) return;

    const target = findDeskItem(teams, deskId);
    if (!target) return;
    if (deskIsRunning(target)) return;

    setFocusedDeskId(deskId);

    try {
      await handleDeskProfileChange(deskId, agentId);

      if ("isPending" in target) return;

      const s = target as Session;
      if (s.is_sleeping) await api.sessions.wake(s.id);
      await api.sessions.arrive(s.id);
      await api.sessions.resume(s.id, "Continue.", undefined, agentId, apiReasoningEffort, apiMode);

      setJustStartedId(s.id);
      const optimistic: Partial<Session> = {
        agent: agentId || null,
        is_running: true,
        is_sleeping: false,
        ended_at: null,
        task_solved: false,
      };
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...optimistic } : x)));
      sessionsRef.current = sessionsRef.current.map((x) =>
        x.id === s.id ? { ...x, ...optimistic } : x,
      );
      setTeams((prev) =>
        prev.map((t) => ({
          ...t,
          desks: t.desks.map((d) =>
            !("isPending" in d) && d.id === s.id ? { ...(d as Session), ...optimistic } : d,
          ),
        })),
      );
      void loadSessions();
    } catch (e) {
      console.warn("assign agent to desk failed:", e);
    }
  }

  function confirmAssignment(deskId: string, assignment: PendingAssignment) {
    setPendingAssignments((prev) => ({
      ...prev,
      [deskId]: { ...assignment, customized: true },
    }));
    upsertDeskBarConfig(deskId, {
      agentId: assignment.agentId,
      model: assignment.modelOverride ?? agents.find((a) => a.id === assignment.agentId)?.model ?? globalConfig.model,
      toolPreset: assignment.toolPreset,
      toolsEnabled: assignment.toolsEnabled,
      customized: true,
    });
    setActivePendingDeskId(deskId);
    setFocusedDeskId(deskId);
  }

  function patchPendingAssignment(deskId: string, patch: Partial<PendingAssignment>) {
    setPendingAssignments((prev) => {
      const cur = prev[deskId];
      if (!cur) return prev;
      return { ...prev, [deskId]: { ...cur, ...patch } };
    });
  }

  const allFloorSessions = useMemo(
    () => teams.flatMap((t) => t.desks).filter((d) => !("isPending" in d)) as Session[],
    [teams],
  );

  // One profile ↔ one desk *at the same time*: a profile is "in use" only while a
  // desk is actively RUNNING it (plus pending desks about to start). Idle / ended /
  // stale desks do NOT reserve it — otherwise old desks left on disk would pin a
  // profile forever. The roster + picker grey out in-use profiles.
  const agentsForRoster = useMemo(() => {
    const inUse = new Set<string>();
    for (const s of allFloorSessions) {
      if (s.agent && s.is_running) inUse.add(s.agent);
    }
    for (const a of Object.values(pendingAssignments)) {
      if (a.agentId) inUse.add(a.agentId);
    }
    return agents.map((a) => ({ ...a, inUse: inUse.has(a.id) }));
  }, [agents, allFloorSessions, pendingAssignments]);

  const rosterLayout = useRosterLayout();

  const {
    agentDrag, rosterHover, deskDropHoverId, sectionDropHoverId,
    handleAgentDragStart, handleRosterAgentDragStart,
  } = useAgentDrag({
    rosterRef,
    agents,
    onSessionInterrupt: handleSessionInterrupt,
    onAssignAgentToDesk: (deskId, agentId) => { void handleAssignAgentToDesk(deskId, agentId); },
    onRosterAgentClick: (agentId) => {
      const deskId = focusedDeskId ?? activePendingDeskId;
      if (!deskId) return;
      const desk = findDeskItem(teams, deskId);
      if (deskIsRunning(desk)) return;
      void handleDeskProfileChange(deskId, agentId);
    },
    onRosterOpen: () => setRosterOpen(true),
  });

  async function closeDesk(deskId: string) {
    const isPending = teams.some((t) =>
      t.desks.some((d) => d.id === deskId && "isPending" in d),
    );
    if (!isPending) {
      if (!window.confirm(
        "Delete this desk and its session data (history, workspace, sandbox)? This cannot be undone.",
      )) return;
      try {
        await api.sessions.delete(deskId);
      } catch (e) {
        console.warn("session delete failed:", e);
      }
      setSessions((prev) => prev.filter((s) => s.id !== deskId));
      sessionsRef.current = sessionsRef.current.filter((s) => s.id !== deskId);
      setWorkspacePaths((prev) => { const n = { ...prev }; delete n[deskId]; return n; });
      setTaskContents((prev) => { const n = { ...prev }; delete n[deskId]; return n; });
      setTaskImages((prev) => { const n = { ...prev }; delete n[deskId]; return n; });
    }
    setPendingTexts((prev) => { const n = { ...prev }; delete n[deskId]; return n; });
    setPendingAssignments((prev) => { const n = { ...prev }; delete n[deskId]; return n; });
    if (focusedDeskId === deskId) setFocusedDeskId(null);
    setTeams((prev) => prev.map((t) => {
      if (!t.desks.some((d) => d.id === deskId)) return t;
      const next = t.desks.filter((d) => d.id !== deskId);
      return { ...t, desks: next.length === 0 && t.id === HOME_TEAM_ID ? [makePending()] : next };
    }));
  }

  function addDeskToTeam(teamId: string) {
    if (PUBLIC_TEAM_IDS.has(teamId)) return;
    setTeams((prev) => prev.map((t) =>
      t.id === teamId ? { ...t, desks: [...t.desks, makePending()] } : t
    ));
  }

  function addRoom() {
    const roomNumber = teams.filter((team) => team.id !== HOME_TEAM_ID && !PUBLIC_TEAM_IDS.has(team.id)).length + 1;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setTeams((prev) => {
      const next = [...prev];
      const publicIndex = next.findIndex((team) => PUBLIC_TEAM_IDS.has(team.id));
      const room = makePrivateTeam(id, `Room ${roomNumber}`, [makePending()]);
      if (publicIndex >= 0) next.splice(publicIndex, 0, room);
      else next.push(room);
      return next;
    });
  }

  async function deleteRoom(teamId: string) {
    if (teamId === HOME_TEAM_ID || PUBLIC_TEAM_IDS.has(teamId)) return;
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const realDesks = team.desks.filter((desk) => !("isPending" in desk)) as Session[];
    const running = realDesks.filter((session) => session.is_running === true);
    if (running.length > 0) {
      window.alert(`Stop ${running.length} running agent(s) before deleting this room.`);
      return;
    }

    try {
      await Promise.all(realDesks.map((session) => api.sessions.delete(session.id)));
      const ids = new Set(team.desks.map((desk) => desk.id));
      setSessions((prev) => prev.filter((session) => !ids.has(session.id)));
      sessionsRef.current = sessionsRef.current.filter((session) => !ids.has(session.id));
      setWorkspacePaths((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setTaskContents((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setTaskImages((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setPendingTexts((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setPendingAssignments((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setDeskBarConfigs((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setAskManagerByTeamId((prev) => {
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
      if (focusedDeskId && ids.has(focusedDeskId)) setFocusedDeskId(null);
      if (activePendingDeskId && ids.has(activePendingDeskId)) setActivePendingDeskId(null);
      setTeams((prev) => prev.filter((item) => item.id !== teamId));
      void loadSessions();
    } catch (e) {
      window.alert((e as Error).message || "Couldn't delete this room.");
    }
  }

  function renameTeam(teamId: string, name: string) {
    if (PUBLIC_TEAM_IDS.has(teamId)) return;
    setTeams((prev) => prev.map((team) =>
      team.id === teamId ? { ...team, name: team.id === HOME_TEAM_ID ? "Home" : name } : team
    ));
  }

  async function copyDeskToHome(sessionId: string) {
    if (sessionId.startsWith("public-project-")) {
      const ok = window.confirm("Copy this project into your private OSA workspace? OSA will create private rooms and agent copies from the shared project. The public original stays untouched.");
      if (!ok) return;
    }
    try {
      const wallet = readWalletSession();
      const copied = await api.sessions.copy(sessionId, wallet ? { wallet_address: wallet.address } : {});
      const sessionIds = copied.session_ids?.length ? copied.session_ids : [copied.session_id];
      const loaded = await Promise.all(sessionIds.map(async (id) => (
        id === copied.session?.id && copied.session ? copied.session : api.sessions.get(id)
      )));
      const loadedSessions: Session[] = loaded.map((sessionRaw) => ({
        ...sessionRaw,
        title: sessionRaw.title?.trim() || "Copied Public task",
      }));
      const byId = new Map(sessionsRef.current.map((session) => [session.id, session]));
      for (const session of loadedSessions) byId.set(session.id, session);
      const nextSessions = [...byId.values()];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setFocusedDeskId(loadedSessions[0]?.id || copied.session_id);
      setActivePendingDeskId(null);
      setJustStartedId(loadedSessions[0]?.id || copied.session_id);
      setJustStartedAnchor(null);
      setTeams((prev) => mergeServerTeams(prev, nextSessions, {
        includeUnplacedPrivate: !projectScopedRef.current,
      }));
      setDashboardTab("workbench");
    } catch (e) {
      window.alert((e as Error).message || "Couldn't copy this project into Home.");
    }
  }

  async function openShareProjectDialog() {
    const wallet = readWalletSession();
    if (!wallet) {
      setWalletConnected(false);
      setWalletConnectError("Connect your wallet before sharing a project.");
      return;
    }
    const privateTeams = teams.filter((team) => !PUBLIC_TEAM_IDS.has(team.id));
    const privateSessions = privateTeams.flatMap((team) => team.desks).filter((desk) => !("isPending" in desk));
    if (!privateSessions.length) {
      window.alert("Add at least one private agent before sharing a project.");
      return;
    }
    setShareDialog({
      name: activeSavedProject || "OSA Project",
      shareFileRepo: false,
      channels: shareChannelsFromRuntime(runtimeStatus),
      loadingChannels: true,
      submitting: false,
      error: null,
    });
    try {
      const health = await api.health();
      setRuntimeStatus(health.runtime ?? null);
      setShareDialog((prev) => prev ? { ...prev, channels: shareChannelsFromRuntime(health.runtime ?? null), loadingChannels: false } : prev);
    } catch {
      setShareDialog((prev) => prev ? { ...prev, loadingChannels: false } : prev);
    }
  }

  async function submitShareProject() {
    if (!shareDialog || shareDialog.submitting) return;
    const wallet = readWalletSession();
    if (!wallet) {
      setShareDialog((prev) => prev ? { ...prev, error: "Connect your wallet before sharing a project." } : prev);
      setWalletConnected(false);
      return;
    }
    const privateTeams = teams.filter((team) => !PUBLIC_TEAM_IDS.has(team.id));
    const privateSessions = privateTeams.flatMap((team) => team.desks).filter((desk) => !("isPending" in desk));
    if (!privateSessions.length) {
      setShareDialog((prev) => prev ? { ...prev, error: "Add at least one private agent before sharing a project." } : prev);
      return;
    }
    const selectedChannels = shareDialog.channels.filter((channel) => channel.checked).map((channel) => channel.id);
    setShareDialog((prev) => prev ? { ...prev, submitting: true, error: null } : prev);
    try {
      await api.publicProjects.share({
        name: shareDialog.name.trim() || "OSA Project",
        owner_wallet_address: wallet.address,
        share_file_repo: shareDialog.shareFileRepo,
        technocore_channels: selectedChannels,
        rooms: privateTeams.map((team) => ({ id: team.id, name: team.name || serverTeamName(team.id, sessionsRef.current) })),
      });
      const latest = await api.sessions.list(50);
      sessionsRef.current = latest;
      setSessions(latest);
      setTeams((prev) => mergeServerTeams(prev, latest, {
        includeUnplacedPrivate: !projectScopedRef.current,
      }));
      setShareDialog(null);
    } catch (e) {
      setShareDialog((prev) => prev ? { ...prev, submitting: false, error: (e as Error).message || "Couldn't share this project." } : prev);
    }
  }

  async function refreshProjectListings() {
    const latest = await api.sessions.list(50);
    sessionsRef.current = latest;
    setSessions(latest);
    setTeams((prev) => mergeServerTeams(prev, latest, {
      includeUnplacedPrivate: !projectScopedRef.current,
    }));
  }

  function canDeletePublicProject(session: Session): boolean {
    const wallet = readWalletSession();
    if (!wallet?.address) return false;
    return session.public_kind === "project"
      && String(session.owner_wallet_address || "").toLowerCase() === wallet.address.toLowerCase();
  }

  function ownPublicProjectSession(): Session | null {
    const wallet = readWalletSession();
    if (!wallet?.address) return null;
    return sessionsRef.current.find((session) => (
      session.public_kind === "project"
      && String(session.owner_wallet_address || "").toLowerCase() === wallet.address.toLowerCase()
    )) || null;
  }

  async function deletePublicProject(projectId: string, title: string, confirmDelete = true) {
    const wallet = readWalletSession();
    if (!wallet) {
      setWalletConnected(false);
      setWalletConnectError("Connect the owner wallet before deleting a shared project.");
      return false;
    }
    if (confirmDelete && !window.confirm(`Delete shared project "${title}"? Reviews, copy stats, and donation records for this public listing will be removed.`)) {
      return false;
    }
    await api.publicProjects.delete(stripPublicProjectSessionId(projectId), { owner_wallet_address: wallet.address });
    await refreshProjectListings();
    setProjectDetails((prev) => (
      prev && stripPublicProjectSessionId(projectId) === prev.projectId ? null : prev
    ));
    return true;
  }

  async function deletePublicProjectFromSession(session: Session) {
    try {
      await deletePublicProject(session.id, session.title || "Public Project");
    } catch (e) {
      window.alert((e as Error).message || "Couldn't delete this shared project.");
    }
  }

  async function deletePublicProjectFromTop(project: TopAgent) {
    try {
      await deletePublicProject(project.target_id || stripPublicProjectSessionId(project.id), project.title || "Public Project");
    } catch (e) {
      window.alert((e as Error).message || "Couldn't delete this shared project.");
    }
  }

  async function handleDeleteProject() {
    const privateSessionIds = Array.from(new Set([
      ...sessionsRef.current.filter(isPrivateSession).map((session) => session.id),
      ...teams
        .filter((team) => !PUBLIC_TEAM_IDS.has(team.id))
        .flatMap((team) => team.desks)
        .filter((desk) => !("isPending" in desk))
        .map((desk) => (desk as Session).id),
    ]));
    const sharedProject = ownPublicProjectSession();
    if (privateSessionIds.length === 0 && !sharedProject && !activeSavedProject) {
      window.alert("There is no active private project to delete.");
      return;
    }
    const runningCount = sessionsRef.current.filter((session) =>
      privateSessionIds.includes(session.id) && session.is_running === true,
    ).length;
    const warning = runningCount > 0
      ? `\n\nThis will cancel ${runningCount} running agent ${runningCount === 1 ? "task" : "tasks"}.`
      : "";
    const sharedWarning = sharedProject
      ? `\n\nIt will also unshare "${sharedProject.title || "Public Project"}" from the public network.`
      : "";
    if (!window.confirm(`Delete the current project completely?${warning}${sharedWarning}\n\nPrivate desks, rooms, pending prompts, local workbench state, and the active saved project tab will be removed.`)) return;

    try {
      if (sharedProject) await deletePublicProject(sharedProject.id, sharedProject.title || "Public Project", false);
      if (privateSessionIds.length > 0) await Promise.allSettled(privateSessionIds.map((id) => api.sessions.delete(id)));
      removeStoredItems(WORKBENCH_KEY_V2, [WORKBENCH_LEGACY_KEY_V2]);
      removeStoredItems(WORKBENCH_KEY_V1, [WORKBENCH_LEGACY_KEY_V1]);
      if (activeSavedProject) {
        removeStoredItems(SNAPSHOT_PREFIX + activeSavedProject);
        const nextSnapshots = loadSnapshotIndex().filter((snapshot) => snapshot.name !== activeSavedProject);
        writeStoredItem(SNAPSHOTS_KEY, JSON.stringify(nextSnapshots));
        refreshSavedProjectTabs(nextSnapshots);
      }
      projectScopedRef.current = true;
      setActiveSavedProject(null);
      clearActiveProjectUiState();
      const latest = await api.sessions.list(50);
      sessionsRef.current = latest.filter((session) => !privateSessionIds.includes(session.id));
      setSessions(sessionsRef.current);
      setTeams([makeHomeTeam()]);
      setDashboardTab("workbench");
    } catch (e) {
      window.alert((e as Error).message || "Couldn't delete the current project.");
    }
  }

  function setTeamScene(teamId: string, sceneId: string) {
    setTeams((prev) => prev.map((t) =>
      t.id === teamId ? { ...t, scene: sceneId } : t
    ));
  }

  /** Place an imported desk on the workbench (right of team strip; panel stays closed). */
  async function ingestImportedDesk(res: {
    session_id: string;
    workspace_path: string | null;
    team_id: string | null;
  }) {
    let session: Session;
    try {
      session = await api.sessions.get(res.session_id);
    } catch {
      window.alert("Desk imported but its session couldn't be read.");
      return;
    }
    setJustStartedId(null);
    setJustStartedAnchor(null);

    if (teams.some((t) => t.desks.some((d) => d.id === session.id))) {
      setFocusedDeskId(session.id);
      return;
    }
    setTeams((prev) => {
      const targetTeamId = PUBLIC_TEAM_IDS.has(res.team_id || "") ? PUBLIC_PROJECTS_TEAM_ID : HOME_TEAM_ID;
      const idx = prev.findIndex((t) => t.id === targetTeamId);
      const target = idx >= 0 ? idx : 0;
      return prev.map((t, i) => (i === target ? { ...t, desks: [...t.desks, session] } : t));
    });
    setSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [...prev, session]));
    sessionsRef.current = sessionsRef.current.some((s) => s.id === session.id)
      ? sessionsRef.current
      : [...sessionsRef.current, session];
    if (res.workspace_path) {
      setWorkspacePaths((prev) => ({ ...prev, [session.id]: res.workspace_path! }));
    }
    setFocusedDeskId(session.id);
  }

  /** Load a desk saved via "Save desk" (a full sandbox archive) back into the
   *  workbench — restores its session history + workspace and drops it on a team. */
  async function handleLoadDesk(file: File) {
    try {
      await ingestImportedDesk(await api.sessions.importDesk(file));
    } catch (e) {
      window.alert((e as Error).message || "Couldn't load this desk archive.");
    }
  }

  async function handleLoadSavedDesk(filename: string) {
    try {
      await ingestImportedDesk(await api.sessions.importSavedDesk(filename));
    } catch (e) {
      window.alert((e as Error).message || "Couldn't load this desk archive.");
    }
  }

  function clearActiveProjectUiState() {
    setPendingTexts({});
    setTaskContents({});
    setTaskImages({});
    setPendingAssignments({});
    setDeskBarConfigs({});
    setAskManagerByTeamId({});
    setWorkspacePaths({});
    setActivePendingDeskId(null);
    setFocusedDeskId(null);
    setJustStartedId(null);
    setJustStartedAnchor(null);
  }

  function refreshSavedProjectTabs(next?: SnapshotMeta[] | null) {
    setSavedProjectTabs(next ?? loadSnapshotIndex());
  }

  function defaultProjectSnapshotName(): string {
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    return `Project ${stamp}`;
  }

  function activeProjectHasWork(): boolean {
    return teams
      .filter((team) => !PUBLIC_TEAM_IDS.has(team.id))
      .some((team) => team.desks.some((desk) => (
        "isPending" in desk
          ? Boolean((pendingTexts[desk.id] || "").trim())
          : true
      )));
  }

  function handleLoadSnapshot(name?: string) {
    projectScopedRef.current = true;
    setActiveSavedProject(name || null);
    clearActiveProjectUiState();
    refreshSavedProjectTabs();
    workbenchRestoredRef.current = false;
    void loadSessions();
  }

  function handleSavedProjectTab(name: string) {
    const raw = loadSnapshotWorkbench(name);
    if (!raw) {
      window.alert(`Saved project "${name}" could not be loaded.`);
      refreshSavedProjectTabs();
      return;
    }
    writeStoredItem(WORKBENCH_KEY_V2, raw);
    handleLoadSnapshot(name);
    setDashboardTab("workbench");
  }

  function handleNewProject() {
    let nextIndex: SnapshotMeta[] | null = null;
    if (activeProjectHasWork()) {
      saveWorkbenchV2(teams, pendingTexts, taskContents, taskImages);
      nextIndex = saveCurrentProjectSnapshot(
        teams,
        sessionsRef.current,
        activeSavedProject || defaultProjectSnapshotName(),
        "",
      );
    }
    refreshSavedProjectTabs(nextIndex);
    removeStoredItems(WORKBENCH_KEY_V2, [WORKBENCH_LEGACY_KEY_V2]);
    removeStoredItems(WORKBENCH_KEY_V1, [WORKBENCH_LEGACY_KEY_V1]);
    projectScopedRef.current = true;
    setActiveSavedProject(null);
    clearActiveProjectUiState();
    setTeams([makeHomeTeam()]);
    setDashboardTab("workbench");
  }

  const handleSearch = useCallback(async (q: string) => {
    if (!q) {
      setSearchMatchIds(new Set());
      setSearchStats(null);
      return;
    }
    try {
      const results = await api.search(q);
      const ids = new Set(results.map((s) => s.id));
      setSearchMatchIds(ids);
      const onFloorIds = teams.flatMap((t) =>
        t.desks.filter((d) => !("isPending" in d)).map((d) => d.id),
      );
      const onFloor = onFloorIds.filter((id) => ids.has(id)).length;
      setSearchStats({ onFloor, total: ids.size });
      const firstOnFloor = onFloorIds.find((id) => ids.has(id));
      if (firstOnFloor) {
        requestAnimationFrame(() => {
          document.querySelector(`[data-desk-id="${firstOnFloor}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        });
      }
    } catch {
      setSearchMatchIds(new Set());
      setSearchStats(null);
    }
  }, [teams]);

  async function handleReset() {
    const privateSessionIds = Array.from(new Set([
      ...sessionsRef.current.filter(isPrivateSession).map((session) => session.id),
      ...teams
        .filter((team) => !PUBLIC_TEAM_IDS.has(team.id))
        .flatMap((team) => team.desks)
        .filter((desk) => !("isPending" in desk))
        .map((desk) => (desk as Session).id),
    ]));
    const runningCount = sessionsRef.current.filter((session) =>
      privateSessionIds.includes(session.id) && session.is_running === true,
    ).length;
    const warning = runningCount > 0
      ? `\n\nThis will cancel ${runningCount} running agent ${runningCount === 1 ? "task" : "tasks"} before wiping the dashboard.`
      : "";
    if (!window.confirm(`Reset OSA and start fresh?${warning}\n\nThis removes private desks, rooms, pending prompts, desk settings, and local workbench state.`)) return;
    removeStoredItems(WORKBENCH_KEY_V2, [WORKBENCH_LEGACY_KEY_V2]);
    removeStoredItems(WORKBENCH_KEY_V1, [WORKBENCH_LEGACY_KEY_V1]);
    setPendingTexts({});
    setTaskContents({});
    setTaskImages({});
    setPendingAssignments({});
    setDeskBarConfigs({});
    setAskManagerByTeamId({});
    setWorkspacePaths({});
    setActivePendingDeskId(null);
    setFocusedDeskId(null);
    setJustStartedId(null);
    setJustStartedAnchor(null);
    projectScopedRef.current = false;
    setActiveSavedProject(null);
    if (privateSessionIds.length > 0) {
      await Promise.allSettled(privateSessionIds.map((id) => api.sessions.delete(id)));
      const publicOnly = sessionsRef.current.filter((session) => !privateSessionIds.includes(session.id));
      sessionsRef.current = publicOnly;
      setSessions(publicOnly);
    }
    setTeams([makeHomeTeam(), makePublicProjectsTeam(sessionsRef.current.filter((session) => session.team_id === PUBLIC_PROJECTS_TEAM_ID))]);
    try {
      const r = await api.docker.cleanup();
      if (r.skipped) {
        console.info(`Skipped agent container cleanup: ${r.reason}.`);
      } else if (r.removed > 0) {
        console.info(`Removed ${r.removed} unused agent container(s).`);
      }
    } catch {}
    void loadSessions();
  }

  const allDesks = teams.flatMap((t) => t.desks);
  const realDesks = allDesks.filter((d) => !("isPending" in d)) as Session[];
  const projectCanvasTeams = teams.filter((team) => !PUBLIC_TEAM_IDS.has(team.id));
  const activeCount = realDesks.filter((s) => s.is_running === true).length;
  const deskCount = realDesks.length;
  const networkStats = {
    flopStatusLabel,
    onlineAgents: activeCount,
    walletConnected,
    live: networkLive,
    federation: runtimeStatus,
  };

  const [walletSelectorWallets, setWalletSelectorWallets] = useState<WalletInfo[] | null>(null);

  async function connectDashboardWallet() {
    setWalletConnectPending(true);
    setWalletConnectError(null);
    try {
      let info: WalletInfo;
      try {
        info = await selectWallet();
      } catch (err: any) {
        if (err.code === "MULTIPLE_WALLETS") {
          // Multiple wallets detected — show picker modal.
          setWalletSelectorWallets(err.wallets);
          setWalletConnectPending(false);
          return;
        }
        throw err;
      }
      await connectWithProvider(info.provider);
    } catch (error) {
      console.error("connectDashboardWallet error:", error);
      setWalletConnectError((error as Error).message || "Could not connect wallet.");
      setWalletConnected(false);
    } finally {
      setWalletConnectPending(false);
    }
  }

  async function connectWithProvider(provider: WalletProvider) {
    setWalletConnectPending(true);
    setWalletConnectError(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = Array.isArray(accounts) ? String(accounts[0] || "") : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("No wallet account selected.");
      let chainId: string | null = null;
      try {
        const rawChainId = await provider.request({ method: "eth_chainId" });
        chainId = typeof rawChainId === "string" ? rawChainId : null;
      } catch { /* chain id is helpful but not required */ }
      const challenge = await api.wallet.challenge({ address, chain_id: chainId });
      const signature = await provider.request({
        method: "personal_sign",
        params: [challenge.challenge.message, address],
      });
      if (typeof signature !== "string") throw new Error("Wallet did not return a login signature.");
      const result = await api.wallet.login({
        address,
        chain_id: chainId,
        challenge_id: challenge.challenge.id,
        message: challenge.challenge.message,
        signature,
      });
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(result.wallet));
      setWalletAddress(result.wallet.address);
      setWalletConnected(true);
      await refreshWalletBalance();
    } catch (error) {
      console.error("connectWithProvider error:", error);
      setWalletConnectError((error as Error).message || "Could not connect wallet.");
      setWalletConnected(false);
    } finally {
      setWalletConnectPending(false);
    }
  }

  function disconnectDashboardWallet() {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setWalletAddress(null);
    setFlopStatusLabel("Prelaunch");
    setWalletConnected(false);
    setWalletConnectError(null);
  }

  function openProjectDetails(project: TopAgent) {
    const projectId = publicProjectIdFromTopAgent(project);
    if (projectId) setProjectDetails({ projectId, fallback: project });
  }

  function openProjectDetailsFromSession(session: Session) {
    const projectId = publicProjectIdFromSession(session);
    if (projectId) setProjectDetails({ projectId });
  }

  if (backendError) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 16, color: "var(--text-dim)", fontFamily: "system-ui, sans-serif",
        background: "var(--bg)",
      }}>
        <img src="/osa-logo.svg" alt="OSA" width={56} height={56} />
        <div style={{ fontSize: 18, color: "var(--text)" }}>OSA</div>
        <div style={{ fontSize: 13, color: "var(--red)" }}>{backendError}</div>
        <button
          onClick={() => loadSessions()}
          style={{ marginTop: 8, padding: "8px 20px", background: "var(--accent2)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!walletConnected) {
    return (
      <WalletGate
        onConnect={() => void connectDashboardWallet()}
        error={walletConnectError}
        pending={walletConnectPending}
      />
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        teams={teams}
        sessions={sessions}
        sessionCount={deskCount}
        activeCount={activeCount}
        networkStats={networkStats}
        bellSound={bellSound}
        scene={scene}
        showManager={showManager}
        managerPatrolIntervalSec={managerPatrolIntervalSec}
        managerIdleGraceSec={managerIdleGraceSec}
        onBellSoundChange={(id) => {
          setBellSound(id);
          writeStoredItem(STORAGE_KEYS.bellSound.key, id);
        }}
        onSceneChange={(id) => {
          setScene(id);
          writeStoredItem(STORAGE_KEYS.scene.key, id);
        }}
        onShowManagerChange={(v) => {
          setShowManager(v);
          writeStoredItem(STORAGE_KEYS.showManager.key, String(v));
        }}
        onManagerPatrolIntervalChange={(sec) => {
          setManagerPatrolIntervalSec(sec);
          writeStoredItem(STORAGE_KEYS.managerPatrolInterval.key, String(sec));
        }}
        onManagerIdleGraceChange={(sec) => {
          setManagerIdleGraceSec(sec);
          writeStoredItem(STORAGE_KEYS.managerIdleGrace.key, String(sec));
        }}
        onSearch={handleSearch}
        searchStats={searchStats}
        onLoadSnapshot={handleLoadSnapshot}
        onSnapshotsChange={refreshSavedProjectTabs}
        onWalletConnect={() => void connectDashboardWallet()}
        onWalletDisconnect={disconnectDashboardWallet}
        walletAddress={walletAddress}
        codeTheme={codeTheme}
        onCodeThemeChange={(id) => {
          setCodeTheme(id);
          writeStoredItem(STORAGE_KEYS.codeTheme.key, id);
        }}
        dockerPersist={dockerPersist}
        onDockerPersistChange={(v) => {
          setDockerPersist(v);
          api.docker.setConfig(v).then((r) => setDockerPersist(r.persist)).catch(() => {});
        }}
        verbose={verbose}
        onVerboseChange={(v) => {
          setVerbose(v);
          writeStoredItem(STORAGE_KEYS.verbose.key, String(v));
        }}
        agents={agents}
        rosterAgents={agentsForRoster}
        defaultModel={globalConfig.model || deskDefaultModel}
        rosterOpen={rosterOpen}
        onRosterOpenChange={setRosterOpen}
        rosterRef={rosterRef}
        rosterDragActive={agentDrag !== null}
        rosterDropHighlight={rosterHover}
        rosterLayout={rosterLayout}
        rosterSectionDropHoverId={sectionDropHoverId}
        onRosterAgentDragStart={handleRosterAgentDragStart}
        onAgentEdit={(agent) => setAgentModal({ mode: "edit", agent })}
        onDefaultEdit={() => setDefaultAgentEditorOpen(true)}
        onCreateAgent={() => setAgentModal({ mode: "create" })}
        selectedDeskId={selectedDeskId}
        deskConfig={deskConfig}
        deskConfigLocked={deskConfigLocked}
        toolsets={toolsets}
        reasoningEffort={reasoningEffort}
        reasoningOptions={reasoningOptions}
        onDeskProfileChange={(agentId) => {
          if (selectedDeskId) void applyDeskCustomization(selectedDeskId, { agentId });
        }}
        onDeskModelChange={(model) => {
          if (selectedDeskId) void applyDeskCustomization(selectedDeskId, { model });
        }}
        onDeskToolsChange={(toolPreset, toolsEnabled) => {
          if (selectedDeskId) void applyDeskCustomization(selectedDeskId, { toolPreset, toolsEnabled });
        }}
        onReasoningChange={(v) => {
          setReasoningEffort(v);
          writeStoredItem(STORAGE_KEYS.reasoningEffort.key, v);
        }}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderBottom: "1px solid var(--card-border)",
        background: "#0f1626",
      }}>
        {([
          ["workbench", "Workspaces / Projects"],
          ["work", "Work"],
          ["market", "Market & Deals"],
          ["trust", "Trust"],
          ["vault", "Vault"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setDashboardTab(id);
              if (id === "market") void refreshNetworkActivity();
            }}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid #2a3558",
              background: dashboardTab === id ? "var(--accent2)" : "#121828",
              color: dashboardTab === id ? "white" : "var(--text-dim)",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={addRoom}
          title="Create a private local workspace with its own agent desks"
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 6,
            border: "1px dashed #2a8c72",
            background: "#10251f",
            color: "#7ee0c2",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          + Workspace
        </button>
        {/* Agent pills in the topbar — draggable to desks */}
        {dashboardTab === "workbench" && agents.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              paddingLeft: 6,
              minWidth: 0,
              overflowX: "auto",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", whiteSpace: "nowrap", paddingRight: 2 }}>Agents</span>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                title={`Drag ${agent.name} onto a desk`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleRosterAgentDragStart(e, agent.id, agent.color);
                }}
                style={{
                  height: 26,
                  padding: "0 8px",
                  borderRadius: 5,
                  border: `1px solid ${agent.color || "#2a3558"}44`,
                  background: `${agent.color || "#121828"}22`,
                  color: agent.color || "#cbd5e1",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "grab",
                  whiteSpace: "nowrap",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {agent.name}
              </button>
            ))}
          </div>
        )}
        {savedProjectTabs.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              flex: 1,
              overflowX: "auto",
              paddingLeft: 4,
            }}
          >
            {savedProjectTabs.slice(0, 8).map((snapshot) => {
              const active = activeSavedProject === snapshot.name;
              return (
                <button
                  key={snapshot.name}
                  type="button"
                  onClick={() => handleSavedProjectTab(snapshot.name)}
                  title={`Open saved project "${snapshot.name}"`}
                  style={{
                    height: 28,
                    maxWidth: 180,
                    padding: "0 10px",
                    borderRadius: 6,
                    border: `1px solid ${active ? "#60a5fa" : "#2a3558"}`,
                    background: active ? "#1e3a8a" : "#121828",
                    color: active ? "white" : "var(--text-dim)",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flexShrink: 0,
                  }}
                >
                  {snapshot.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {networkNotice && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 16px",
          borderBottom: "1px solid rgba(46, 197, 142, 0.28)",
          background: "rgba(16, 37, 31, 0.96)",
          color: "#7ee0c2",
          fontSize: 12,
          fontWeight: 800,
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#7ee0c2",
            boxShadow: "0 0 10px rgba(126, 224, 194, 0.8)",
          }} />
          <span>{networkNotice}</span>
        </div>
      )}
      {dashboardTab === "work" ? (
        <div style={{ padding: "16px", color: "#cbd5e1", fontSize: 13 }}>
          <JobsPanel />
        </div>
      ) : dashboardTab === "market" ? (
        <ProtocolOsPanel
          events={networkEvents}
          live={networkLive}
          activityLoading={networkEventsLoading}
          onRefreshActivity={refreshNetworkActivity}
          onOpenProject={(projectId) => setProjectDetails({ projectId })}
        />
      ) : dashboardTab === "trust" ? (
        <div style={{ padding: "16px", color: "#cbd5e1", fontSize: 13 }}>
          <TrustPanel />
        </div>
      ) : dashboardTab === "vault" ? (
        <div style={{ padding: "16px", color: "#cbd5e1", fontSize: 13 }}>
          <VaultPanel />
        </div>
      ) : (
        <Office
          teams={teams}
          searchMatchIds={searchMatchIds}
          justStartedId={justStartedId}
          justStartedAnchor={justStartedAnchor}
          onJustStartedConsumed={() => {
            setJustStartedId(null);
            setJustStartedAnchor(null);
          }}
          workspacePaths={workspacePaths}
          taskContents={taskContents}
          taskImages={taskImages}
          pendingTexts={pendingTexts}
          verbose={verbose}
          reasoningEffort={apiReasoningEffort}
          apiMode={apiMode}
          bellSound={bellSound}
          scene={scene}
          showManager={showManager}
          managerPatrolIntervalSec={managerPatrolIntervalSec}
          managerIdleGraceSec={managerIdleGraceSec}
          agents={agents}
          pendingAssignments={pendingAssignments}
          activePendingDeskId={activePendingDeskId}
          askManagerByTeamId={askManagerByTeamId}
          onAskManagerDone={(teamId) => setAskManagerByTeamId((prev) => ({ ...prev, [teamId]: null }))}
          onPreview={handleFilePreview}
          deskPanelZ={deskPanelZ}
          onDeskPanelActivate={activateDeskPanel}
          onDeskStart={handleDeskStart}
          onDeskClose={closeDesk}
          onAddDesk={addDeskToTeam}
          onCopyDesk={copyDeskToHome}
          onPublicProjectDetails={openProjectDetailsFromSession}
          onDeletePublicProject={deletePublicProjectFromSession}
          canDeletePublicProject={canDeletePublicProject}
          onDeleteTeam={deleteRoom}
          onTeamSceneChange={setTeamScene}
          onTeamRename={renameTeam}
          onSessionInterrupt={handleSessionInterrupt}
          onAssignAgentToDesk={(deskId, agentId) => handleAssignAgentToDesk(deskId, agentId)}
          deskDropHoverId={deskDropHoverId}
          onAgentDragStart={handleAgentDragStart}
          onPendingMsgChange={(id, msg) => setPendingTexts((prev) => ({ ...prev, [id]: msg }))}
          onPendingAssignmentPatch={patchPendingAssignment}
          onActivePendingDeskChange={handleActivePendingDeskChange}
          onDeskFocus={handleDeskFocus}
          focusedDeskId={focusedDeskId}
          selectedDeskId={selectedDeskId}
          deskConfigsById={deskConfigsById}
          onAvatarClick={handleAvatarClick}
          onDeskAskManager={(teamId, sid) => setAskManagerByTeamId((prev) => ({ ...prev, [teamId]: sid }))}
          onManagerAuditHistory={(teamId) => setManagerAuditHistoryTeamId(teamId)}
          toolsets={toolsets}
          reasoningValue={reasoningEffort}
          reasoningOptions={reasoningOptions}
          onDeskConfigProfileChange={(deskId, agentId) => { void handleDeskProfileChange(deskId, agentId); }}
          onDeskConfigModelChange={(deskId, model) => { void applyDeskCustomization(deskId, { model }); }}
          onDeskConfigToolsChange={(deskId, toolPreset, toolsEnabled) => { void applyDeskCustomization(deskId, { toolPreset, toolsEnabled }); }}
          onDeskConfigReasoningChange={(v) => {
            setReasoningEffort(v);
            writeStoredItem(STORAGE_KEYS.reasoningEffort.key, v);
          }}
        />
      )}
        </div>
        <ResultCanvas
          open={resultCanvasOpen}
          teams={projectCanvasTeams}
          focusedDeskId={selectedCanvasSession?.id ?? null}
          taskContents={taskContents}
          onOpenChange={(open) => {
            setResultCanvasOpen(open);
            writeStoredItem(RESULT_CANVAS_OPEN_KEY, String(open));
          }}
          onPreview={handleFilePreview}
        />
      </div>
      {walletSelectorWallets && (
        <WalletSelectorModal
          wallets={walletSelectorWallets}
          onSelect={(provider) => {
            setWalletSelectorWallets(null);
            connectWithProvider(provider);
          }}
          onCancel={() => setWalletSelectorWallets(null)}
        />
      )}
      {onboardingOpen && (
        <OpenClawOnboarding
          status={openClawStatus}
          onRefresh={() => {
            api.openclaw.status().then(setOpenClawStatus).catch(() => {});
          }}
          onInstall={async () => {
            const result = await api.openclaw.install();
            setOpenClawStatus(result.status);
            return result;
          }}
          onConnect={async () => {
            const result = await api.openclaw.connect();
            setOpenClawStatus(result.status);
            return result;
          }}
          onClose={() => {
            setOnboardingOpen(false);
            writeStoredItem(ONBOARDING_DISMISSED_KEY, "1");
          }}
        />
      )}
      {managerAuditHistoryTeamId && (
        <ManagerAuditHistoryModal
          teamId={managerAuditHistoryTeamId}
          onClose={() => setManagerAuditHistoryTeamId(null)}
        />
      )}
      {agentDrag && (() => {
        const dragAgent = agentDrag.agentId
          ? agents.find((a) => a.id === agentDrag.agentId)
          : undefined;
        return (
          <div style={{
            position: "fixed", left: agentDrag.x - 20, top: agentDrag.y - 58,
            zIndex: 6500, pointerEvents: "none",
            filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.45))",
          }}>
            <AgentFigure
              agentId={agentDrag.agentId || undefined}
              color={agentDrag.color}
              archetype={avatars.get(agentDrag.agentId)?.archetype}
              isPrototype={dragAgent?.is_prototype}
              cloneFrom={dragAgent?.clone_from}
              state={agentDrag.state}
              scale={1}
            />
          </div>
        );
      })()}
      {defaultAgentEditorOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(8,8,16,0.72)",
        }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDefaultAgentEditorOpen(false); }}
        >
          <div style={{
            background: "#16213e", border: "1px solid #2a3558", borderRadius: 10,
            padding: 16, width: "min(520px, 92vw)", maxHeight: "85vh", overflow: "auto",
          }}>
            <GlobalDefaultPersonaEditor
              onClose={() => setDefaultAgentEditorOpen(false)}
              onSaved={() => {
                void refreshAgents();
                void loadSessions();
                setDefaultAgentEditorOpen(false);
              }}
            />
          </div>
        </div>
      )}
      {deskAgentPickerId && (
        <DeskAgentPicker
          agents={agentsForRoster}
          selectedAgentId={deskConfigsById[deskAgentPickerId]?.agentId ?? ""}
          onSelect={(agentId) => {
            const deskId = deskAgentPickerId;
            if (!deskId) return;
            void handleDeskProfileChange(deskId, agentId);
            setDeskAgentPickerId(null);
          }}
          onClose={() => setDeskAgentPickerId(null)}
        />
      )}
      {assignModal && (
        <AgentAssignModal
          deskId={assignModal.deskId}
          agent={assignModal.agent}
          toolsets={toolsets}
          onAssign={confirmAssignment}
          onClose={() => setAssignModal(null)}
        />
      )}
      {agentModal && (
        <AgentProfileModal
          mode={agentModal.mode}
          agent={agentModal.agent}
          prototypes={prototypes}
          agents={agents}
          onClose={() => setAgentModal(null)}
          onSaved={refreshAgents}
          onDeleted={refreshAgents}
        />
      )}
      {shareDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Share project"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4200,
            display: "grid",
            placeItems: "center",
            background: "rgba(4,8,18,0.74)",
            padding: 18,
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !shareDialog.submitting) setShareDialog(null); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); void submitShareProject(); }}
            style={{
              width: "min(520px, 96vw)",
              maxHeight: "calc(100vh - 36px)",
              overflow: "auto",
              borderRadius: 8,
              border: "1px solid #273453",
              background: "#101827",
              boxShadow: "0 24px 80px rgba(0,0,0,0.48)",
              padding: 16,
              boxSizing: "border-box",
              color: "var(--text)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>Share Project</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-dim)" }}>
                  Publish the current private rooms as one public OSA project.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShareDialog(null)}
                disabled={shareDialog.submitting}
                title="Close"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: "1px solid var(--card-border)",
                  background: "#121828",
                  color: "var(--text)",
                  cursor: shareDialog.submitting ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                x
              </button>
            </div>

            <label style={{ display: "grid", gap: 6, marginTop: 14, fontSize: 12, fontWeight: 800 }}>
              <span>Project name</span>
              <input
                value={shareDialog.name}
                onChange={(e) => setShareDialog((prev) => prev ? { ...prev, name: e.currentTarget.value } : prev)}
                maxLength={120}
                autoFocus
                style={{
                  height: 36,
                  borderRadius: 6,
                  border: "1px solid var(--card-border)",
                  background: "#0b1020",
                  color: "var(--text)",
                  padding: "0 10px",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={shareDialog.shareFileRepo}
                onChange={(e) => setShareDialog((prev) => prev ? { ...prev, shareFileRepo: e.currentTarget.checked } : prev)}
              />
              <span>Share File Repo</span>
            </label>

            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900 }}>Channels</div>
              <div style={{ display: "grid", gap: 7 }}>
                {shareDialog.channels.map((channel) => (
                  <label
                    key={channel.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 30,
                      borderRadius: 6,
                      border: "1px solid #273453",
                      background: channel.checked ? "rgba(34,211,238,0.10)" : "#0b1020",
                      padding: "0 10px",
                      fontSize: 12,
                      color: channel.primary ? "#93c5fd" : "var(--text)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={channel.checked}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setShareDialog((prev) => prev ? {
                          ...prev,
                          channels: prev.channels.map((item) => item.id === channel.id ? { ...item, checked } : item),
                        } : prev);
                      }}
                    />
                    <span style={{ fontWeight: 800 }}>{channel.label}</span>
                  </label>
                ))}
              </div>
              {shareDialog.loadingChannels && (
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading channels...</div>
              )}
            </div>

            {shareDialog.error && (
              <div style={{ marginTop: 12, fontSize: 12, color: "#ff8a8a" }}>{shareDialog.error}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setShareDialog(null)}
                disabled={shareDialog.submitting}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "1px solid #2a3558",
                  background: "#121828",
                  color: "var(--text-dim)",
                  cursor: shareDialog.submitting ? "default" : "pointer",
                  fontWeight: 800,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={shareDialog.submitting || shareDialog.loadingChannels}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 6,
                  border: "1px solid #2a8c72",
                  background: shareDialog.submitting || shareDialog.loadingChannels ? "#18251f" : "#16a37b",
                  color: "white",
                  cursor: shareDialog.submitting || shareDialog.loadingChannels ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                {shareDialog.submitting ? "Sharing" : "Share"}
              </button>
            </div>
          </form>
        </div>
      )}
      <FilePreview
        data={preview}
        zIndex={previewZ}
        onActivate={activateFilePreview}
        onClose={() => setPreview(null)}
        codeTheme={codeTheme}
      />
      <NetworkChatWindow
        walletAddress={walletAddress}
        refreshKey={networkChatRefreshKey}
        dockRightOffset={resultCanvasOpen ? 406 : 50}
      />
      <ProjectDetailsModal
        projectId={projectDetails?.projectId || null}
        fallback={projectDetails?.fallback || null}
        onClose={() => setProjectDetails(null)}
        onCopy={copyDeskToHome}
      />
    </div>
  );
}
