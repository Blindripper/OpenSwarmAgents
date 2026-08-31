import { useEffect, useState } from "react";
import type React from "react";
import { api } from "../api/client";
import type { ManagerAuditRecord } from "../types";

interface Props {
  teamId?: string | null;
  onClose: () => void;
}

export function ManagerAuditHistoryModal({ teamId, onClose }: Props) {
  const [audits, setAudits] = useState<ManagerAuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.manager.audits(120);
      setAudits(data.audits || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load manager audits");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visible = teamId ? audits.filter((audit) => audit.team_id === teamId) : audits;

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div>
            <div style={titleStyle}>Manager Audits</div>
            <div style={subtitleStyle}>
              Saved audit feedback from the OSA manager.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void load()} style={secondaryBtnStyle}>
              {loading ? "Loading" : "Refresh"}
            </button>
            <button type="button" onClick={onClose} style={closeBtnStyle} title="Close manager audits">
              ×
            </button>
          </div>
        </div>

        {error && <div style={errorStyle}>{error}</div>}
        {!loading && visible.length === 0 ? (
          <div style={emptyStyle}>
            No manager audits have been saved for this room yet. Click Manager, then Run.
          </div>
        ) : (
          <div style={listStyle}>
            {visible.map((audit) => (
              <AuditCard key={audit.id} audit={audit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditCard({ audit }: { audit: ManagerAuditRecord }) {
  const unresolved = audit.results.filter((item) => item.verdict === "fail" || item.verdict === "unsure");
  const shownResults = unresolved.length ? unresolved : audit.results.slice(0, 3);
  const score = `${audit.summary.passed}/${audit.summary.total}`;
  return (
    <div style={cardStyle}>
      <div style={cardTopStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={deskTitleStyle}>{audit.desk_title || audit.goal || "OSA desk"}</div>
          <div style={metaStyle}>
            {(audit.team_name || audit.team_id || "Room")} · {new Date(audit.generated_at).toLocaleString()} · {audit.trigger}
          </div>
        </div>
        <div style={{
          ...scoreStyle,
          borderColor: audit.summary.failed ? "rgba(239,68,68,0.45)" : audit.summary.unsure ? "rgba(245,158,11,0.45)" : "rgba(34,197,94,0.45)",
          color: audit.summary.failed ? "#fca5a5" : audit.summary.unsure ? "#facc15" : "#86efac",
        }}>
          {score}
        </div>
      </div>
      <div style={summaryStyle}>
        {audit.summary.failed} failed · {audit.summary.unsure} unsure · {audit.summary.passed} passed
      </div>
      <div style={resultsStyle}>
        {shownResults.map((item) => (
          <div key={item.id} style={resultStyle}>
            <span style={{
              ...verdictStyle,
              color: item.verdict === "pass" ? "#86efac" : item.verdict === "fail" ? "#fca5a5" : "#facc15",
            }}>
              {item.verdict}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={criterionStyle}>{item.criterion}</div>
              <div style={evidenceStyle}>{item.evidence}</div>
              {item.fix_hint && <div style={fixStyle}>{item.fix_hint}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 7200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  background: "rgba(5,8,18,0.74)",
};

const modalStyle: React.CSSProperties = {
  width: "min(760px, 96vw)",
  maxHeight: "86vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: 8,
  border: "1px solid #2a3558",
  background: "#0f1626",
  boxShadow: "0 22px 70px rgba(0,0,0,0.55)",
  color: "var(--text)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: "14px 16px",
  borderBottom: "1px solid #24304f",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  marginTop: 3,
};

const secondaryBtnStyle: React.CSSProperties = {
  border: "1px solid #2a3558",
  background: "#111827",
  color: "var(--text)",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const closeBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid #2a3558",
  background: "#111827",
  color: "var(--text)",
  borderRadius: 6,
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
};

const listStyle: React.CSSProperties = {
  overflow: "auto",
  padding: 14,
  display: "grid",
  gap: 10,
};

const emptyStyle: React.CSSProperties = {
  margin: 14,
  padding: 14,
  border: "1px solid #24304f",
  borderRadius: 8,
  color: "var(--text-dim)",
  fontSize: 12,
  background: "#111827",
};

const errorStyle: React.CSSProperties = {
  margin: "12px 14px 0",
  padding: "8px 10px",
  border: "1px solid rgba(239,68,68,0.35)",
  borderRadius: 6,
  color: "#fca5a5",
  background: "rgba(239,68,68,0.08)",
  fontSize: 12,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #24304f",
  borderRadius: 8,
  background: "#111827",
  padding: 12,
};

const cardTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "flex-start",
};

const deskTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  marginTop: 3,
};

const scoreStyle: React.CSSProperties = {
  flexShrink: 0,
  border: "1px solid",
  borderRadius: 6,
  padding: "4px 7px",
  fontSize: 12,
  fontWeight: 900,
  background: "rgba(255,255,255,0.04)",
};

const summaryStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "var(--text-dim)",
};

const resultsStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 10,
};

const resultStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "58px minmax(0, 1fr)",
  gap: 8,
  padding: "8px 9px",
  borderRadius: 6,
  background: "#0f1626",
};

const verdictStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
};

const criterionStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
};

const evidenceStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  lineHeight: 1.35,
  marginTop: 3,
};

const fixStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#93c5fd",
  lineHeight: 1.35,
  marginTop: 5,
};
