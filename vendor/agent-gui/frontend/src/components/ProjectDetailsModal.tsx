import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectExplorerReport, PublicProjectDetail, PublicProjectReview, TopAgent } from "../types";
import { AgentFigure } from "./AgentFigure";

interface Props {
  projectId: string | null;
  fallback?: TopAgent | null;
  onClose: () => void;
  onCopy?: (sessionId: string) => void;
  onReview?: (project: TopAgent) => void;
}

function shortAddress(address?: string | null): string {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function projectSessionId(project: TopAgent): string {
  return project.id.startsWith("public-project-") ? project.id : `public-project-${project.target_id || project.id}`;
}

function ReviewList({ reviews }: { reviews: PublicProjectReview[] }) {
  if (!reviews.length) {
    return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No reviews yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {reviews.map((review) => (
        <div
          key={review.id}
          style={{
            border: "1px solid #273453",
            borderRadius: 8,
            background: "#0b1020",
            padding: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0, fontSize: 12, fontWeight: 900, color: "#facc15" }}>
              {review.rating.toFixed(1)} stars{review.title ? ` · ${review.title}` : ""}
            </div>
            <div style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
              {shortAddress(review.wallet_address)}
            </div>
          </div>
          {review.comment && (
            <div style={{ marginTop: 6, color: "var(--text)", fontSize: 12, lineHeight: 1.45 }}>
              {review.comment}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectDetailsModal({ projectId, fallback, onClose, onCopy, onReview }: Props) {
  const [detail, setDetail] = useState<PublicProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [explorerReport, setExplorerReport] = useState<ProjectExplorerReport | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerError, setExplorerError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.publicProjects.get(projectId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Unable to load project details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    setExplorerReport(null);
    setExplorerError(null);
    setExplorerLoading(false);
  }, [projectId]);

  async function sendExplorer() {
    if (!projectId) return;
    setExplorerLoading(true);
    setExplorerError(null);
    try {
      const result = await api.publicProjects.explore(projectId);
      setExplorerReport(result.report);
    } catch (err) {
      setExplorerError((err as Error).message || "Explorer could not inspect this project.");
    } finally {
      setExplorerLoading(false);
    }
  }

  if (!projectId) return null;
  const project = detail?.project || fallback || null;
  const reviews = detail?.reviews || [];
  const stats = detail?.stats || project || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Public project details"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3200,
        display: "grid",
        placeItems: "center",
        background: "rgba(4,8,18,0.76)",
        padding: 18,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(820px, 100%)",
          maxHeight: "min(760px, calc(100vh - 36px))",
          overflow: "auto",
          borderRadius: 8,
          border: "1px solid #273453",
          background: "#101827",
          boxShadow: "0 24px 80px rgba(0,0,0,0.48)",
          padding: 16,
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{project?.title || "Public Project"}</div>
            <div style={{ marginTop: 5, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              {project?.summary || (loading ? "Loading project details..." : "No project summary available.")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              border: "1px solid var(--card-border)",
              background: "#121828",
              color: "var(--text)",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            x
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
          {[
            ["Copies", String(stats?.copy_count ?? project?.copy_count ?? 0)],
            ["Donations", `${Number(stats?.donation_total_usdc || project?.donation_total_usdc || 0)} USDC`],
            ["Reviews", stats?.review_count || project?.review_count ? `${Number(stats?.rating_avg || project?.rating_avg || 0).toFixed(1)} avg` : "0"],
            ["Owner", shortAddress(project?.owner_wallet_address)],
          ].map(([label, value]) => (
            <div key={label} style={{ border: "1px solid #273453", borderRadius: 8, padding: 10, background: "#0b1020" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 900 }}>{label}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--text)", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>

        {error && <div style={{ marginTop: 12, color: "#ff8a8a", fontSize: 12 }}>{error}</div>}

        <div
          style={{
            marginTop: 14,
            border: "1px solid #263b63",
            borderRadius: 8,
            background: "#0b1428",
            padding: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AgentFigure
              agentId="explorer"
              color="#60a5fa"
              state={explorerLoading ? "working" : "idle"}
              scale={0.9}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "#93c5fd" }}>Explorer</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
                Sends the Explorer agent through the public rooms, tasks, reviews, copies, and donations so you can judge what this project does before copying it.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void sendExplorer()}
              disabled={explorerLoading}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #2563eb",
                background: explorerLoading ? "#172554" : "#1d4ed8",
                color: "white",
                cursor: explorerLoading ? "default" : "pointer",
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              {explorerLoading ? "Inspecting..." : "Send Explorer"}
            </button>
          </div>
          {explorerError && (
            <div style={{ marginTop: 10, color: "#ff8a8a", fontSize: 12 }}>{explorerError}</div>
          )}
          {explorerReport && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text)" }}>
                {explorerReport.summary}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#7ee0c2", marginBottom: 6 }}>Strengths</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                    {explorerReport.strengths.map((item) => (
                      <li key={item} style={{ fontSize: 12, lineHeight: 1.45 }}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#facc15", marginBottom: 6 }}>Cautions</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                    {explorerReport.cautions.map((item) => (
                      <li key={item} style={{ fontSize: 12, lineHeight: 1.45 }}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div style={{ borderTop: "1px solid #263b63", paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#93c5fd", marginBottom: 5 }}>Copy fit</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>{explorerReport.copy_fit}</div>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>Project Rooms</div>
          {detail?.rooms?.length ? detail.rooms.map((room) => (
            <div key={room.id} style={{ border: "1px solid #273453", borderRadius: 8, padding: 12, background: "#0d1424" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--accent2)" }}>{room.name}</div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {room.tasks.map((task) => (
                  <div key={task.id} style={{ borderLeft: "3px solid #2a8c72", paddingLeft: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 900 }}>{task.title}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
                      {task.agent} · {task.model}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45 }}>{task.description}</div>
                    {task.result_summary && (
                      <div style={{ marginTop: 5, fontSize: 11, color: "#7ee0c2" }}>{task.result_summary}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )) : (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Loading rooms..." : "No public room details available."}</div>
          )}
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>Reviews</div>
          <ReviewList reviews={reviews} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {project && onReview && (
            <button
              type="button"
              onClick={() => onReview(project)}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #7a6420",
                background: "#241f10",
                color: "#facc15",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Review
            </button>
          )}
          {project && onCopy && (
            <button
              type="button"
              onClick={() => onCopy(projectSessionId(project))}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "var(--accent2)",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Copy Project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
