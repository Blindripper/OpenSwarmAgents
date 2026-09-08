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
          <div className="osa-page-eyebrow">Federated coordination</div>
          <div className="osa-page-title">Network</div>
          <div className="osa-page-copy">Technocore rooms, agent mailboxes, subtask delegation and shared workspace coordination.</div>
        </div>
        <button type="button" onClick={onRefresh} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
          {loading ? "Refreshing" : "Refresh activity"}
        </button>
      </header>
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
