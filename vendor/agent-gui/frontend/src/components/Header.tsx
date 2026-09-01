import { useState } from "react";
import { SettingsMenu } from "./SettingsMenu";
import { SnapshotMenu } from "./SnapshotMenu";
import type { SnapshotMeta } from "./SnapshotMenu";
import { AgentRosterMenu } from "./AgentRosterMenu";
import { DeskContextBar } from "./DeskContextBar";
import { ReasoningEffortControl } from "./ReasoningEffortControl";
import { isVllmBackend } from "../backendKind";
import type { DeskConfigView } from "../deskConfig";
import type { RosterLayout } from "../rosterLayout";
import type { RuntimeStatus } from "../api/client";
import type { AgentProfile, ReasoningEffort, Session, Team, ToolPresetId, ToolsetMeta } from "../types";

interface Props {
  teams: Team[];
  sessions: Session[];
  sessionCount: number;
  activeCount: number;
  networkStats?: {
    publicProjects: number;
    copies: number;
    donationsUsdc: number;
    osaBalanceLabel: string;
    onlineAgents: number;
    walletConnected: boolean;
    live: boolean;
    federation?: RuntimeStatus | null;
  };
  bellSound: string;
  scene: string;
  showManager: boolean;
  managerPatrolIntervalSec: number;
  managerIdleGraceSec: number;
  agents: AgentProfile[];
  rosterAgents: AgentProfile[];
  toolsets: ToolsetMeta[];
  defaultModel?: string;
  selectedDeskId: string | null;
  deskConfig: DeskConfigView | null;
  deskConfigLocked: boolean;
  reasoningEffort: ReasoningEffort;
  reasoningOptions: { value: ReasoningEffort; label: string }[];
  onDeskProfileChange: (agentId: string) => void;
  onDeskModelChange: (model: string) => void;
  onDeskToolsChange: (preset: ToolPresetId, enabled: string[]) => void;
  onReasoningChange: (v: ReasoningEffort) => void;
  rosterOpen: boolean;
  onRosterOpenChange: (open: boolean) => void;
  rosterRef: React.RefObject<HTMLDivElement | null>;
  rosterDragActive: boolean;
  rosterDropHighlight: boolean;
  rosterLayout: RosterLayout;
  rosterSectionDropHoverId?: string | null;
  onRosterAgentDragStart?: (e: React.MouseEvent, agentId: string, color?: string) => void;
  onAgentEdit?: (agent: AgentProfile) => void;
  onDefaultEdit?: () => void;
  onCreateAgent?: () => void;
  onSearch: (q: string) => void;
  searchStats?: { onFloor: number; total: number } | null;
  onBellSoundChange: (id: string) => void;
  onSceneChange: (id: string) => void;
  onShowManagerChange: (v: boolean) => void;
  onManagerPatrolIntervalChange: (sec: number) => void;
  onManagerIdleGraceChange: (sec: number) => void;
  onLoadSnapshot: (name?: string) => void;
  onSnapshotsChange?: (snapshots: SnapshotMeta[]) => void;
  onWalletConnect: () => void;
  onWalletDisconnect: () => void;
  walletAddress?: string | null;
  codeTheme: import("./FilePreview").CodeThemeId;
  onCodeThemeChange: (id: import("./FilePreview").CodeThemeId) => void;
  dockerPersist: boolean;
  onDockerPersistChange: (v: boolean) => void;
  verbose: boolean;
  onVerboseChange: (v: boolean) => void;
}

function TopMetric({ label, value, hint, tone = "accent" }: { label: string; value: string; hint: string; tone?: "accent" | "green" | "muted" }) {
  const color = tone === "green" ? "#7ee0c2" : tone === "muted" ? "var(--text-dim)" : "var(--accent2)";
  return (
    <div
      title={hint}
      style={{
        minWidth: 0,
        height: 34,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 10px",
        borderRadius: 6,
        border: "1px solid #2a3558",
        background: "#121828",
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-dim)", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 900, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function shortDid(value: string) {
  const display = value.replace(/^did:key:/, "");
  if (display.length <= 18) return display;
  return `${display.slice(0, 6)}...${display.slice(-6)}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function TechnocoreDidMetric({ did }: { did: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = failed ? "Failed" : copied ? "Copied" : "Copy";
  async function handleCopy() {
    setFailed(false);
    try {
      await copyText(did);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 1600);
    }
  }
  return (
    <div
      title={`Technocore DID: ${did}`}
      style={{
        minWidth: 0,
        height: 34,
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 6px 0 8px",
        borderRadius: 6,
        border: "1px solid #2a8c72",
        background: "#10251f",
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-dim)", letterSpacing: 0 }}>TC DID</span>
        <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee0c2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortDid(did)}</span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy Technocore DID"
        title="Copy Technocore DID"
        style={{
          width: 38,
          height: 22,
          borderRadius: 5,
          border: "1px solid #2a8c72",
          background: copied ? "#1f9f7a" : failed ? "#5c1f2b" : "#121828",
          color: copied ? "white" : failed ? "#fda4af" : "#7ee0c2",
          fontSize: 10,
          fontWeight: 900,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {status}
      </button>
    </div>
  );
}

function PeerMetric({ value, hint, tone }: { value: string; hint: string; tone: "accent" | "green" | "muted" }) {
  const color = tone === "green" ? "#7ee0c2" : tone === "muted" ? "var(--text-dim)" : "var(--accent2)";
  return (
    <div
      title={hint}
      style={{
        width: 82,
        height: 28,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 8px",
        borderRadius: 6,
        border: "1px solid #2a3558",
        background: "#121828",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 8.5, fontWeight: 900, color: "var(--text-dim)", letterSpacing: 0 }}>PEERS</span>
      <span style={{ fontSize: 10.5, fontWeight: 900, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function federationMetric(runtime?: RuntimeStatus | null) {
  if (!runtime?.federationEnabled) {
    return { value: "Local", hint: "Federation is disabled on this node.", tone: "muted" as const };
  }
  if (runtime.federationTrustConfigError) {
    return { value: "Check", hint: runtime.federationTrustConfigError, tone: "muted" as const };
  }
  const known = Number(runtime.federationKnownPeerCount || 0);
  const syncable = Number(runtime.federationDiscoveredPeerCount || 0);
  const configured = Number(runtime.federationPeerCount || 0);
  const trusted = Number(runtime.federationTrustedNodeCount || 0);
  const mode = runtime.federationSignatureVerificationEnabled ? "Verified" : "Token";
  const discovery = runtime.federationDiscoveryEnabled ? ` · ${syncable}/${known} discovery` : "";
  return {
    value: `${mode} ${syncable}/${known}`,
    hint: `${configured} configured peer${configured === 1 ? "" : "s"} · ${trusted} trusted peer${trusted === 1 ? "" : "s"}${discovery}${runtime.federationAdvertiseUrl ? ` · advertises ${runtime.federationAdvertiseUrl}` : ""}`,
    tone: syncable > 0 || configured > 0 ? "green" as const : "accent" as const,
  };
}

export function Header({
  teams, sessions, sessionCount, activeCount,
  networkStats,
  bellSound, scene, showManager, managerPatrolIntervalSec, managerIdleGraceSec,
  agents, rosterAgents, toolsets, defaultModel,
  selectedDeskId, deskConfig, deskConfigLocked,
  reasoningEffort, reasoningOptions,
  onDeskProfileChange, onDeskModelChange, onDeskToolsChange, onReasoningChange,
  rosterOpen, onRosterOpenChange, rosterRef, rosterDragActive, rosterDropHighlight,
  rosterLayout, rosterSectionDropHoverId,
  onRosterAgentDragStart, onAgentEdit, onDefaultEdit, onCreateAgent,
  onSearch, searchStats,
  onBellSoundChange, onSceneChange, onShowManagerChange,
  onManagerPatrolIntervalChange, onManagerIdleGraceChange,
  onLoadSnapshot, onSnapshotsChange, onWalletConnect, onWalletDisconnect, walletAddress, codeTheme, onCodeThemeChange,
  dockerPersist, onDockerPersistChange, verbose, onVerboseChange,
}: Props) {
  const [logoOk, setLogoOk] = useState(true);

  const reasoningDisabled = deskConfig ? isVllmBackend(deskConfig.baseUrl) : true;
  const showReasoning = Boolean(
    deskConfig && !reasoningDisabled && reasoningOptions.length > 0,
  );
  const stats = networkStats ?? {
    publicProjects: 0,
    copies: 0,
    donationsUsdc: 0,
    osaBalanceLabel: "0 OSA",
    onlineAgents: activeCount,
    walletConnected: false,
    live: false,
  };
  const walletButtonLabel = stats.walletConnected
    ? `Disconnect ${walletAddress ? shortAddress(walletAddress) : "Wallet"}`
    : "Connect Wallet";
  const federation = federationMetric(stats.federation);
  const technocoreDid = stats.federation?.technocoreDid || null;

  return (
    <div style={{
      background: "var(--bg2)",
      borderBottom: "1px solid var(--card-border)",
      display: "flex",
      alignItems: "center",
      padding: "8px 16px",
      gap: 12,
      flexShrink: 0,
      zIndex: 200,
      minHeight: 56,
      width: "100%",
      boxSizing: "border-box",
    }}>
      {logoOk
        ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <img src="/osa-logo.svg" alt="OSA" height={34} width={34}
              style={{ display: "block", flexShrink: 0 }}
              onError={() => setLogoOk(false)} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: 0 }}>OSA</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent2)", letterSpacing: 0 }}>Project Network</span>
            </div>
          </div>
        : <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: "var(--accent2)" }}>O</span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>OSA</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent2)", letterSpacing: 0 }}>Project Network</span>
            </div>
          </div>}

      <div style={{ width: 1, height: 28, background: "var(--card-border)", flexShrink: 0 }} />

      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        padding: "5px 10px", background: "#10251f", borderRadius: 6, border: "1px solid #2a8c72",
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: stats.live ? "var(--green)" : "var(--text-dim)",
          ...(stats.live ? {
            boxShadow: "0 0 7px var(--green)",
            animation: "blink 1.5s ease-in-out infinite",
          } : {}),
        }} />
        <span style={{ fontSize: 12, fontWeight: 900, color: stats.live ? "#7ee0c2" : "var(--text-dim)", whiteSpace: "nowrap" }}>
          {stats.live ? "Network Live" : "Network Syncing"}
        </span>
      </div>

      <div style={{ width: 1, height: 28, background: "var(--card-border)", flexShrink: 0 }} />

      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(6, minmax(96px, 1fr))",
        minWidth: 0,
        gap: 8,
      }}>
        <TopMetric label="PROJECTS" value={String(stats.publicProjects)} hint="Shared projects visible in Latest Projects and Top100 Projects" />
        <TopMetric label="WORKING" value={String(stats.onlineAgents)} hint="Agents currently doing reward-eligible work on this node" tone={stats.onlineAgents > 0 ? "green" : "muted"} />
        <TopMetric label="COPIES" value={String(stats.copies)} hint="Total public project copies in this network view" />
        <TopMetric label="Earned Donations" value={`${stats.donationsUsdc.toFixed(stats.donationsUsdc % 1 ? 2 : 0)} USDC`} hint="Donation intents recorded by this OSA network view" tone={stats.donationsUsdc > 0 ? "green" : "muted"} />
        {technocoreDid
          ? <TechnocoreDidMetric did={technocoreDid} />
          : <TopMetric label="PEERS" value={federation.value} hint={federation.hint} tone={federation.tone} />}
        <TopMetric label="$OSA" value={stats.osaBalanceLabel} hint="Current $OSA balance for the connected wallet. Shows 0 until token deployment and on-chain balance lookup are configured." />
      </div>

      <div style={{ width: 1, height: 28, background: "var(--card-border)", flexShrink: 0 }} />

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <AgentRosterMenu
          agents={rosterAgents}
          defaultModel={defaultModel}
          open={rosterOpen}
          onOpenChange={onRosterOpenChange}
          rosterRef={rosterRef}
          dragActive={rosterDragActive}
          dropHighlight={rosterDropHighlight}
          rosterLayout={rosterLayout}
          sectionDropHoverId={rosterSectionDropHoverId}
          onAgentDragStart={onRosterAgentDragStart}
          onAgentEdit={onAgentEdit}
          onDefaultEdit={onDefaultEdit}
          onCreateAgent={onCreateAgent}
        />

        <PeerMetric value={federation.value} hint={federation.hint} tone={federation.tone} />

        <SnapshotMenu
          teams={teams}
          sessions={sessions}
          onLoadSnapshot={onLoadSnapshot}
          onSnapshotsChange={onSnapshotsChange}
        />

        <button
          type="button"
          onClick={stats.walletConnected ? onWalletDisconnect : onWalletConnect}
          title={stats.walletConnected ? "Disconnect this browser wallet session" : "Connect an EVM wallet"}
          style={{
            height: 28,
            padding: "0 10px",
            background: stats.walletConnected ? "#10251f" : "#121828",
            border: `1px solid ${stats.walletConnected ? "#2a8c72" : "#2a3558"}`,
            borderRadius: 6,
            color: stats.walletConnected ? "#7ee0c2" : "var(--text-dim)",
            fontSize: 10,
            fontWeight: 800,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {walletButtonLabel}
        </button>

        <SettingsMenu
          bellSound={bellSound}
          onBellSoundChange={onBellSoundChange}
          scene={scene}
          onSceneChange={onSceneChange}
          showManager={showManager}
          onShowManagerChange={onShowManagerChange}
          managerPatrolIntervalSec={managerPatrolIntervalSec}
          managerIdleGraceSec={managerIdleGraceSec}
          onManagerPatrolIntervalChange={onManagerPatrolIntervalChange}
          onManagerIdleGraceChange={onManagerIdleGraceChange}
          codeTheme={codeTheme}
          onCodeThemeChange={onCodeThemeChange}
          dockerPersist={dockerPersist}
          onDockerPersistChange={onDockerPersistChange}
          verbose={verbose}
          onVerboseChange={onVerboseChange}
        />
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
