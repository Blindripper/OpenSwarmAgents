import type { NetworkEvent } from "../api/client";
import { AgentMailboxesPanel } from "./AgentMailboxesPanel";
import { NetworkActivityPanel } from "./NetworkActivityPanel";
import { SharedWorkspaceRoomsPanel } from "./SharedWorkspaceRoomsPanel";
import { SubtaskDelegationsPanel } from "./SubtaskDelegationsPanel";

interface Props {
  events: NetworkEvent[];
  live: boolean;
  loading?: boolean;
  onRefresh: () => void;
  onOpenProject?: (projectId: string) => void;
}

export function NetworkOperationsPanel({ events, live, loading = false, onRefresh, onOpenProject }: Props) {
  return <div className="osa-dashboard-page" data-testid="network-operations-panel">
    <div className="osa-dashboard-inner">
      <header className="osa-page-hero">
        <div>
          <div className="osa-page-eyebrow">Federated coordination command center</div>
          <div className="osa-page-title">Network</div>
          <div className="osa-page-copy">The Network area is for observing public OSA activity, opening bounded team rooms, sending signed agent mail and delegating subtasks across verified Technocore identities. It does not run remote agents or move funds.</div>
        </div>
        <button type="button" onClick={onRefresh} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
          {loading ? "Refreshing" : "Refresh activity"}
        </button>
      </header>
      <div className="osa-command-grid">
        <div className="osa-action-card" data-accent="blue">
          <strong>Observe</strong>
          <span>Watch signed public network events from this node and trusted peers.</span>
          <em>Use: monitor shares, reviews, donations, chats and sync state.</em>
        </div>
        <div className="osa-action-card" data-accent="green">
          <strong>Coordinate</strong>
          <span>Open private-name shared rooms for bounded team notes.</span>
          <em>Requires: explicit disclosure confirmation before publishing.</em>
        </div>
        <div className="osa-action-card" data-accent="cyan">
          <strong>Message</strong>
          <span>Send signed agent mailbox messages with no execution authority.</span>
          <em>Never include secrets, wallet data, commands or files.</em>
        </div>
        <div className="osa-action-card" data-accent="amber">
          <strong>Delegate</strong>
          <span>Create inspectable subtask envelopes for verified recipients.</span>
          <em>Acceptance into a workspace is always an explicit human step.</em>
        </div>
      </div>
      <div className="osa-dashboard-grid-2">
        <div style={{ display: "grid", gap: 14 }}>
          <SharedWorkspaceRoomsPanel />
          <SubtaskDelegationsPanel />
          <AgentMailboxesPanel />
        </div>
        <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <NetworkActivityPanel events={events} live={live} loading={loading} onRefresh={onRefresh} onOpenProject={onOpenProject} />
        </aside>
      </div>
    </div>
  </div>;
}
