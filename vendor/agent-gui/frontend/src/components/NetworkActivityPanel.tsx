import type { NetworkEvent } from "../api/client";
import { AgentFigure } from "./AgentFigure";

interface Props {
  events: NetworkEvent[];
  live: boolean;
  loading?: boolean;
  onRefresh: () => void;
  onOpenProject?: (projectId: string) => void;
}

function eventTone(type: string): { color: string; label: string; state: "idle" | "working" | "thinking" } {
  if (type.includes("technocore")) return { color: "#38bdf8", label: "Technocore Share", state: "thinking" };
  if (type.includes("copied")) return { color: "#22d3ee", label: "Copy", state: "working" };
  if (type.includes("review")) return { color: "#facc15", label: "Review", state: "thinking" };
  if (type.includes("donation")) return { color: "#7ee0c2", label: "Donation", state: "working" };
  if (type.includes("federation")) return { color: "#a78bfa", label: "Sync", state: "working" };
  if (type.includes("chat")) return { color: "#fb7185", label: "Chat", state: "thinking" };
  if (type.includes("shared")) return { color: "#e0882a", label: "Share", state: "working" };
  return { color: "#6a7a9a", label: "Event", state: "idle" };
}

function eventProjectId(event: NetworkEvent): string | null {
  const data = event.data || {};
  const raw = data.publicProjectId || data.targetId || data.publicId;
  return typeof raw === "string" && raw ? raw : null;
}

function eventSource(event: NetworkEvent): string | null {
  const source = event.data?.source;
  return typeof source === "string" && source ? source : null;
}

function isExternalEvent(event: NetworkEvent): boolean {
  return event.data?.external === true || event.data?.untrusted === true || eventSource(event) === "technocore";
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" });
}

export function NetworkActivityPanel({ events, live, loading = false, onRefresh, onOpenProject }: Props) {
  return (
    <div style={{
      flex: 1,
      overflow: "auto",
      background: "linear-gradient(180deg, #0d1724 0%, #131827 48%, #0b1020 100%)",
      color: "var(--text)",
      padding: 18,
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>OSA Network Activity</div>
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
              OSA shares, copies, reviews, donations, syncs, local chat, and own Technocore shares from this node and trusted peers.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 10px",
              borderRadius: 6,
              border: "1px solid #273453",
              color: live ? "#7ee0c2" : "var(--text-dim)",
              background: live ? "#10251f" : "#121828",
              fontSize: 11,
              fontWeight: 900,
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: live ? "#7ee0c2" : "var(--text-dim)",
                boxShadow: live ? "0 0 10px rgba(126,224,194,0.8)" : "none",
              }} />
              {live ? "LIVE" : "LOCAL"}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #2a3558",
                background: "#121828",
                color: loading ? "var(--text-dim)" : "var(--accent2)",
                cursor: loading ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {loading ? "Loading" : "Refresh"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {events.length === 0 ? (
            <div style={{
              minHeight: 360,
              border: "1px dashed #2a3558",
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 24,
            }}>
              No public network events yet.
            </div>
          ) : events.map((event) => {
            const tone = eventTone(event.type);
            const projectId = eventProjectId(event);
            return (
              <div
                key={event.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "54px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 74,
                  borderRadius: 8,
                  border: "1px solid #273453",
                  background: "#101827",
                  padding: "10px 12px",
                }}
              >
                <div style={{ height: 50, display: "grid", placeItems: "center", overflow: "hidden" }}>
                  <AgentFigure agentId="coder" color={tone.color} state={tone.state} scale={0.78} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: tone.color, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{tone.label}</span>
                    {eventSource(event) && (
                      <span style={{
                        height: 18,
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0 6px",
                        borderRadius: 5,
                        border: "1px solid #2a3558",
                        color: isExternalEvent(event) ? "#93c5fd" : "var(--text-dim)",
                        background: isExternalEvent(event) ? "#0b2540" : "#121828",
                        fontSize: 10,
                        fontWeight: 900,
                        textTransform: "uppercase",
                      }}>
                        {eventSource(event)}
                      </span>
                    )}
                    {isExternalEvent(event) && (
                      <span style={{
                        height: 18,
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0 6px",
                        borderRadius: 5,
                        border: "1px solid #3b2f1c",
                        color: "#facc15",
                        background: "#231a0c",
                        fontSize: 10,
                        fontWeight: 900,
                        textTransform: "uppercase",
                      }}>
                        untrusted
                      </span>
                    )}
                    <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{timeLabel(event.createdAt)}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {event.message}
                  </div>
                  <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {event.type}
                  </div>
                </div>
                {projectId && onOpenProject && (
                  <button
                    type="button"
                    onClick={() => onOpenProject(projectId)}
                    style={{
                      height: 30,
                      padding: "0 10px",
                      borderRadius: 6,
                      border: "1px solid #2a3558",
                      background: "#121828",
                      color: "var(--accent2)",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 900,
                    }}
                  >
                    Details
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
