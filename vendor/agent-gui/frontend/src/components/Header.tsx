import { useState } from "react";
import { SettingsMenu } from "./SettingsMenu";
import { SnapshotMenu } from "./SnapshotMenu";
import { LoadDeskMenu } from "./LoadDeskMenu";
import { AgentRosterMenu } from "./AgentRosterMenu";
import { DeskContextBar } from "./DeskContextBar";
import { ReasoningEffortControl } from "./ReasoningEffortControl";
import { isVllmBackend } from "../backendKind";
import type { DeskConfigView } from "../deskConfig";
import type { RosterLayout } from "../rosterLayout";
import type { AgentProfile, ReasoningEffort, Session, Team, ToolPresetId, ToolsetMeta } from "../types";

interface Props {
  teams: Team[];
  sessions: Session[];
  sessionCount: number;
  activeCount: number;
  networkStats?: {
    publicAgents: number;
    publicRooms: number;
    publicProjects: number;
    copies: number;
    donationsUsdc: number;
    onlineAgents: number;
    walletConnected: boolean;
    live: boolean;
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
  onReset: () => void;
  onLoadSnapshot: () => void;
  onLoadDesk?: (file: File) => void;
  onLoadSavedDesk?: (filename: string) => void;
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
  onReset, onLoadSnapshot, onLoadDesk, onLoadSavedDesk, codeTheme, onCodeThemeChange,
  dockerPersist, onDockerPersistChange, verbose, onVerboseChange,
}: Props) {
  const [logoOk, setLogoOk] = useState(true);

  const reasoningDisabled = deskConfig ? isVllmBackend(deskConfig.baseUrl) : true;
  const showReasoning = Boolean(
    deskConfig && !reasoningDisabled && reasoningOptions.length > 0,
  );
  const stats = networkStats ?? {
    publicAgents: 0,
    publicRooms: 0,
    publicProjects: 0,
    copies: 0,
    donationsUsdc: 0,
    onlineAgents: activeCount,
    walletConnected: false,
    live: false,
  };

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
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent2)", letterSpacing: 0 }}>AI Think Tank</span>
            </div>
          </div>
        : <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: "var(--accent2)" }}>O</span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>OSA</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent2)", letterSpacing: 0 }}>AI Think Tank</span>
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
        gridTemplateColumns: "repeat(5, minmax(92px, 1fr))",
        minWidth: 0,
        gap: 8,
      }}>
        <TopMetric label="PUBLIC ITEMS" value={String(stats.publicAgents + stats.publicRooms + stats.publicProjects)} hint={`${stats.publicAgents} agents, ${stats.publicRooms} rooms, ${stats.publicProjects} projects shared to the public network`} />
        <TopMetric label="ONLINE" value={String(stats.onlineAgents)} hint="Agents currently running on this node" tone={stats.onlineAgents > 0 ? "green" : "muted"} />
        <TopMetric label="COPIES" value={String(stats.copies)} hint="Total public copies across agents, rooms, and projects" />
        <TopMetric label="DONATIONS" value={`${stats.donationsUsdc.toFixed(stats.donationsUsdc % 1 ? 2 : 0)} USDC`} hint="Donation intents recorded by this OSA network view" tone={stats.donationsUsdc > 0 ? "green" : "muted"} />
        <TopMetric label="WALLET" value={stats.walletConnected ? "Connected" : "No wallet"} hint="Wallet pubkey anchors donation and review identity" tone={stats.walletConnected ? "green" : "muted"} />
      </div>

      <div style={{ width: 1, height: 28, background: "var(--card-border)", flexShrink: 0 }} />

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div
          title="OpenSwarmAgents"
          style={{
            height: 28,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 9px",
            border: "1px solid #2a3558",
            borderRadius: 6,
            background: "#121828",
            color: "var(--accent2)",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          <img src="/osa-logo.svg" alt="" height={16} width={16} />
          AI Think Tank
        </div>

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

        <button
          type="button"
          onClick={onReset}
          title="Reset workbench"
          style={{
            height: 28, padding: "0 8px",
            background: "#121828", border: "1px solid #2a3558",
            borderRadius: 6, color: "var(--text-dim)", fontSize: 10, cursor: "pointer",
          }}
        >
          Reset
        </button>

        {onLoadDesk && onLoadSavedDesk && (
          <LoadDeskMenu onLoadDesk={onLoadDesk} onLoadSavedDesk={onLoadSavedDesk} />
        )}

        <SnapshotMenu teams={teams} sessions={sessions} onLoadSnapshot={onLoadSnapshot} />

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
