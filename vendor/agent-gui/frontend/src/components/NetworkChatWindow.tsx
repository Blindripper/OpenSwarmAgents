import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { NetworkChatMessage } from "../types";

interface Props {
  walletAddress?: string | null;
  refreshKey?: number;
  dockRightOffset?: number;
}

function shortAddress(address?: string | null): string {
  if (!address) return "node";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function defaultChatPos(dockRightOffset: number, minimized = false) {
  const width = minimized ? 220 : 360;
  const height = minimized ? 38 : 390;
  return {
    left: Math.max(16, window.innerWidth - dockRightOffset - width),
    top: Math.max(80, window.innerHeight - height - 40),
  };
}

export function NetworkChatWindow({ walletAddress, refreshKey = 0, dockRightOffset = 16 }: Props) {
  const [messages, setMessages] = useState<NetworkChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState(() => defaultChatPos(dockRightOffset));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const userMovedRef = useRef(false);

  async function refresh() {
    try {
      const result = await api.network.chat(60);
      setMessages(result.messages);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Chat refresh failed.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refreshKey]);

  useEffect(() => {
    if (userMovedRef.current) return;
    setPos(defaultChatPos(dockRightOffset, minimized));
  }, [dockRightOffset, minimized]);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      if (!dragRef.current) return;
      setPos({
        left: Math.max(8, Math.min(window.innerWidth - 160, event.clientX - dragRef.current.dx)),
        top: Math.max(8, Math.min(window.innerHeight - 40, event.clientY - dragRef.current.dy)),
      });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.network.sendChat({ message: text, wallet_address: walletAddress || null });
      setMessages((prev) => [...prev.slice(-59), result.message]);
      setDraft("");
    } catch (err) {
      setError((err as Error).message || "Message failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: minimized ? 220 : 360,
        height: minimized ? 38 : 390,
        zIndex: 3100,
        border: "1px solid #273453",
        borderRadius: 8,
        background: "#101827",
        boxShadow: "0 18px 54px rgba(0,0,0,0.42)",
        overflow: "hidden",
        color: "var(--text)",
      }}
    >
      <div
        onMouseDown={(event) => {
          userMovedRef.current = true;
          dragRef.current = { dx: event.clientX - pos.left, dy: event.clientY - pos.top };
        }}
        style={{
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "0 8px 0 12px",
          background: "#0b1020",
          borderBottom: minimized ? "none" : "1px solid #273453",
          cursor: "move",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7ee0c2", boxShadow: "0 0 10px rgba(126,224,194,0.8)" }} />
          <span style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>Network Chat</span>
        </div>
        <button
          type="button"
          onClick={() => setMinimized((value) => !value)}
          title={minimized ? "Open chat" : "Minimize chat"}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "1px solid var(--card-border)",
            background: "#121828",
            color: "var(--text)",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          {minimized ? "+" : "_"}
        </button>
      </div>

      {!minimized && (
        <div style={{ height: "calc(100% - 38px)", display: "grid", gridTemplateRows: "1fr auto" }}>
          <div style={{ overflow: "auto", padding: 10, display: "grid", gap: 8, alignContent: "end" }}>
            {messages.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12, alignSelf: "center", justifySelf: "center" }}>
                No network chat yet.
              </div>
            ) : messages.map((message) => (
              <div key={message.id} style={{ border: "1px solid #273453", borderRadius: 8, background: "#0b1020", padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--text-dim)" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>{shortAddress(message.wallet_address)}</span>
                  <span>{timeLabel(message.created_at)}</span>
                </div>
                <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.4 }}>{message.message}</div>
              </div>
            ))}
            {error && <div style={{ color: "#ff8a8a", fontSize: 11 }}>{error}</div>}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            style={{ display: "grid", gridTemplateColumns: "1fr 62px", gap: 8, padding: 10, borderTop: "1px solid #273453" }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              maxLength={500}
              placeholder="Message the network"
              style={{
                minWidth: 0,
                height: 32,
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "#0b1020",
                color: "var(--text)",
                padding: "0 10px",
                boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              style={{
                height: 32,
                borderRadius: 6,
                border: "1px solid #2a8c72",
                background: pending || !draft.trim() ? "#18251f" : "#16a37b",
                color: "white",
                cursor: pending || !draft.trim() ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
