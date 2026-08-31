import React from "react";
import type { OpenClawStatus } from "../api/client";

interface Props {
  status: OpenClawStatus | null;
  onRefresh: () => void;
  onInstall: () => Promise<{ ok: boolean; installed: boolean; status: OpenClawStatus; output?: string }>;
  onConnect: () => Promise<{ ok: boolean; status: OpenClawStatus; message: string; connect_command?: string }>;
  onClose: () => void;
}

export function OpenClawOnboarding({ status, onRefresh, onInstall, onConnect, onClose }: Props) {
  const [busy, setBusy] = React.useState<"install" | "connect" | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const linked = status?.agent_gui_linked === true;
  const available = status?.available === true;
  const complete = status?.setup_complete === true;

  async function runInstall() {
    setBusy("install");
    setActionMessage(null);
    try {
      const result = await onInstall();
      setActionMessage(result.installed ? "OpenClaw installed. Start OpenClaw auth next." : "OpenClaw is already installed.");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "OpenClaw install failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runConnect() {
    setBusy("connect");
    setActionMessage(null);
    try {
      const result = await onConnect();
      setActionMessage(result.message || "OpenClaw setup/auth started.");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "OpenClaw setup could not be launched.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget && complete) onClose(); }}>
      <div style={modalStyle}>
        <div style={brandRowStyle}>
          <img src="/osa-logo.svg" alt="OSA" width={38} height={38} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={titleStyle}>OSA</div>
            <div style={subtitleStyle}>Wallet Project Network</div>
          </div>
        </div>

        <div style={headlineStyle}>Connect OpenClaw</div>
        <div style={copyStyle}>
          OSA uses OpenClaw as the local agent runner. This wizard can install OpenClaw and launch its setup/auth flow so Home agents work without manual CLI setup.
        </div>

        <div style={stepsStyle}>
          <StatusLine ok={linked} label="AgentGUI linked" value={linked ? "ready" : "building"} />
          <StatusLine
            ok={available}
            label="OpenClaw connector"
            value={available ? (status?.version || status?.command || "ready") : "not detected"}
          />
          <StatusLine ok={complete} label="Home/Latest Projects" value={complete ? "ready" : "waiting"} />
        </div>

        {!available && (
          <div style={noticeStyle}>
            {status?.install_hint || "Install or sign in to OpenClaw on this host, then check again."}
          </div>
        )}
        <div style={authNoticeStyle}>
          {status?.auth_hint || "OpenAI subscription authentication stays inside OpenClaw/OpenAI. OSA does not collect or store those credentials."}
        </div>
        {actionMessage && (
          <div style={actionMessageStyle}>
            {actionMessage}
          </div>
        )}

        <div style={actionsStyle}>
          {!available && (
            <button type="button" onClick={runInstall} disabled={busy !== null} style={secondaryBtnStyle}>
              {busy === "install" ? "Installing" : "Install OpenClaw"}
            </button>
          )}
          {available && !complete && (
            <button type="button" onClick={runConnect} disabled={busy !== null} style={secondaryBtnStyle}>
              {busy === "connect" ? "Starting" : "Open OpenClaw Auth"}
            </button>
          )}
          <button type="button" onClick={onRefresh} style={secondaryBtnStyle}>
            Check OpenClaw
          </button>
          <button type="button" onClick={onClose} style={primaryBtnStyle}>
            {complete ? "Enter Home" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div style={statusLineStyle}>
      <span style={{ ...dotStyle, background: ok ? "var(--green)" : "#f1c40f" }} />
      <span style={statusLabelStyle}>{label}</span>
      <span style={statusValueStyle}>{value}</span>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 7000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  background: "rgba(5,8,18,0.78)",
};

const modalStyle: React.CSSProperties = {
  width: "min(460px, 94vw)",
  borderRadius: 8,
  border: "1px solid #2a3558",
  background: "#111827",
  boxShadow: "0 22px 70px rgba(0,0,0,0.55)",
  padding: 18,
  color: "var(--text)",
};

const brandRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  letterSpacing: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "var(--accent2)",
  letterSpacing: 0,
};

const headlineStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  marginBottom: 8,
};

const copyStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--text-dim)",
  marginBottom: 14,
};

const stepsStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginBottom: 12,
};

const statusLineStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "12px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  minHeight: 30,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid #25304f",
  background: "#0f1626",
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
};

const statusLabelStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 12,
  fontWeight: 700,
};

const statusValueStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
};

const noticeStyle: React.CSSProperties = {
  border: "1px solid rgba(241,196,15,0.28)",
  background: "rgba(241,196,15,0.08)",
  color: "#f7d774",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.4,
  marginBottom: 12,
};

const authNoticeStyle: React.CSSProperties = {
  border: "1px solid rgba(96,165,250,0.26)",
  background: "rgba(96,165,250,0.08)",
  color: "#bfdbfe",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.4,
  marginBottom: 12,
};

const actionMessageStyle: React.CSSProperties = {
  border: "1px solid #2a3558",
  background: "#0f1626",
  color: "var(--text-dim)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.4,
  marginBottom: 12,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
};

const secondaryBtnStyle: React.CSSProperties = {
  border: "1px solid #2a3558",
  background: "#0f1626",
  color: "var(--text-dim)",
  borderRadius: 6,
  padding: "8px 11px",
  fontSize: 12,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  border: "1px solid var(--accent2)",
  background: "var(--accent2)",
  color: "#fff",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};
