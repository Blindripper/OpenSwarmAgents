import { useState, useCallback } from "react";
import type { AgentProfile } from "../types";

interface Props {
  nodeDid: string | null;
  agents: AgentProfile[];
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

function shortDid(value: string) {
  const display = value.replace(/^did:key:/, "");
  if (display.length <= 18) return display;
  return `${display.slice(0, 8)}...${display.slice(-8)}`;
}

function DotMenu() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="5" cy="2.5" r="1.2" fill="currentColor" />
      <circle cx="5" cy="5" r="1.2" fill="currentColor" />
      <circle cx="5" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CopyButton({ did, label }: { did: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = failed ? "Failed" : copied ? "Copied" : "Copy";
  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
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
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label || "Copy DID"}
      title={label || "Copy DID"}
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
  );
}

export function DidMenu({ nodeDid, agents }: Props) {
  const [open, setOpen] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const toggleOpen = useCallback(() => setOpen((o) => !o), []);

  const displayDid = nodeDid || "—";
  const shortDisplay = shortDid(displayDid);
  const agentCount = agents.filter((a) => a.id).length;

  // Close on outer click
  const handleRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onDoc = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, []);

  const containerStyle: React.CSSProperties = {
    position: "relative",
    minWidth: 0,
    height: 34,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "0 6px 0 8px",
    borderRadius: 6,
    border: "1px solid #2a8c72",
    background: "#10251f",
    boxSizing: "border-box",
    cursor: "pointer",
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: 36,
    left: 0,
    zIndex: 300,
    width: 340,
    background: "#0f1626",
    border: "1px solid #2a3558",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    padding: 8,
    maxHeight: 400,
    overflow: "auto",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 800,
    color: "#8892b0",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    padding: "6px 6px 4px",
  };

  const agentRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 6px",
    borderRadius: 5,
    cursor: "pointer",
    fontSize: 11,
    color: "#e0e0e0",
  };

  const agentDidStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    fontSize: 10,
    color: "#7ee0c2",
  };

  return (
    <div ref={handleRef} style={containerStyle} onClick={toggleOpen} title={nodeDid || "Node DID"}>
      {/* Top-level display */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-dim)", letterSpacing: 0 }}>DID</span>
          <span style={{
            fontSize: 12,
            fontWeight: 900,
            color: "#7ee0c2",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {shortDisplay}
          </span>
        </div>
        <CopyButton did={nodeDid || ""} label="Copy node DID" />
        <div style={{ color: "#7ee0c2", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <DotMenu />
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={dropdownStyle} onClick={(e) => e.stopPropagation()}>
          {/* Node DID */}
          <div style={sectionTitleStyle}>Node DID</div>
          <div style={{
            ...agentRowStyle,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 4,
          }}>
            <span style={agentDidStyle}>{nodeDid || "—"}</span>
            <CopyButton did={nodeDid || ""} />
          </div>

          {/* Agent DIDs */}
          {agentCount > 0 && (
            <>
              <div style={sectionTitleStyle}>
                Agent DIDs ({agentCount})
              </div>
              {agents
                .filter((a) => a.id)
                .map((agent) => {
                  const isExpanded = expandedAgent === agent.id;
                  const agentDid = agent.did || agent.id;
                  return (
                    <div key={agent.id}>
                      <div
                        style={{
                          ...agentRowStyle,
                          background: isExpanded ? "rgba(255,255,255,0.06)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                      >
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: agent.color || "#2a3558",
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>
                          {agent.name}
                        </span>
                        <span style={agentDidStyle}>{agentDid}</span>
                        <CopyButton did={agentDid} label={`Copy ${agent.name} DID`} />
                      </div>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}