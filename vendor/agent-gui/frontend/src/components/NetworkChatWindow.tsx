import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { NetworkChannel, NetworkChatMessage } from "../types";

interface Props {
  walletAddress?: string | null;
  refreshKey?: number;
  dockRightOffset?: number;
}

const defaultChannel = "osa-network";
const pinnedChannelsKey = "osa-network-chat-pinned-channels";

function shortAddress(address?: string | null): string {
  if (!address) return "node";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function loadPinnedChannels(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pinnedChannelsKey) || "[]");
    if (Array.isArray(parsed)) {
      const channels = parsed.filter((item) => typeof item === "string" && item.length > 0).slice(0, 8);
      return channels.includes(defaultChannel) ? channels : [defaultChannel, ...channels];
    }
  } catch { /* ignore stored UI state */ }
  return [defaultChannel];
}

function uniqueChannels(channels: string[]): string[] {
  return [...new Set(channels.filter(Boolean))].slice(0, 8);
}

function messageIdentity(message: NetworkChatMessage): string {
  if (message.source === "technocore") {
    if (message.from?.startsWith("did:key:")) return `<${message.from.slice(8, 18)}...>`;
    return message.from ? `~${message.from.slice(0, 28)}` : "technocore";
  }
  return shortAddress(message.wallet_address);
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function defaultChatPos(dockRightOffset: number, minimized = false) {
  const width = minimized ? 240 : 390;
  const height = minimized ? 38 : 470;
  return {
    left: Math.max(16, window.innerWidth - dockRightOffset - width),
    top: Math.max(80, window.innerHeight - height - 40),
  };
}

function defaultChannelRecord(id: string): NetworkChannel {
  return { id, name: id, source: id === defaultChannel ? "osa" : "technocore", pinned: id === defaultChannel, public: id === defaultChannel };
}

export function NetworkChatWindow({ walletAddress, refreshKey = 0, dockRightOffset = 16 }: Props) {
  const [messages, setMessages] = useState<NetworkChatMessage[]>([]);
  const [channels, setChannels] = useState<NetworkChannel[]>([defaultChannelRecord(defaultChannel)]);
  const [pinnedChannels, setPinnedChannels] = useState<string[]>(loadPinnedChannels);
  const [activeChannel, setActiveChannel] = useState(() => loadPinnedChannels()[0] || defaultChannel);
  const [channelListOpen, setChannelListOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState(() => defaultChatPos(dockRightOffset));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const userMovedRef = useRef(false);

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const pinnedTabs = pinnedChannels.map((id) => channelById.get(id) || defaultChannelRecord(id));
  const availableChannels = channels.filter((channel) => !pinnedChannels.includes(channel.id));
  const activeName = channelById.get(activeChannel)?.name || activeChannel || defaultChannel;

  async function refreshMessages(channel = activeChannel) {
    try {
      const result = await api.network.chat(60, channel);
      setMessages(result.messages);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Chat refresh failed.");
    }
  }

  async function refreshChannels() {
    try {
      const result = await api.network.channels(60);
      const nextChannels = result.channels.length ? result.channels : [defaultChannelRecord(defaultChannel)];
      setChannels(nextChannels);
      setPinnedChannels((previous) => uniqueChannels([
        defaultChannel,
        ...previous,
        ...nextChannels.filter((channel) => channel.pinned).map((channel) => channel.id)
      ]));
    } catch {
      setChannels((previous) => previous.length ? previous : [defaultChannelRecord(defaultChannel)]);
    }
  }

  useEffect(() => {
    window.localStorage.setItem(pinnedChannelsKey, JSON.stringify(pinnedChannels));
  }, [pinnedChannels]);

  useEffect(() => {
    void refreshChannels();
    const timer = window.setInterval(() => void refreshChannels(), 20000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshMessages(activeChannel);
    const timer = window.setInterval(() => void refreshMessages(activeChannel), 12000);
    return () => window.clearInterval(timer);
  }, [activeChannel]);

  useEffect(() => {
    void refreshMessages(activeChannel);
  }, [refreshKey, activeChannel]);

  useEffect(() => {
    if (pinnedChannels.includes(activeChannel)) return;
    setActiveChannel(pinnedChannels[0] || defaultChannel);
  }, [activeChannel, pinnedChannels]);

  useEffect(() => {
    if (userMovedRef.current) return;
    setPos(defaultChatPos(dockRightOffset, minimized));
  }, [dockRightOffset, minimized]);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      if (!dragRef.current) return;
      setPos({
        left: Math.max(8, Math.min(window.innerWidth - 180, event.clientX - dragRef.current.dx)),
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

  function pinChannel(id: string) {
    setPinnedChannels((previous) => uniqueChannels([...previous, id]));
    setActiveChannel(id);
    setChannelListOpen(false);
  }

  function unpinChannel(id: string) {
    if (id === defaultChannel) return;
    setPinnedChannels((previous) => previous.filter((channel) => channel !== id));
  }

  async function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.network.sendChat({
        message: text,
        wallet_address: walletAddress || null,
        channel: activeChannel
      });
      setMessages((prev) => [...prev.slice(-59), result.message]);
      setDraft("");
      void refreshMessages(activeChannel);
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
        width: minimized ? 240 : 390,
        height: minimized ? 38 : 470,
        zIndex: 3100,
        border: "1px solid #273453",
        borderRadius: 8,
        background: "#101827",
        boxShadow: "0 18px 54px rgba(0,0,0,0.42)",
        overflow: "hidden",
        color: "var(--text)",
        boxSizing: "border-box",
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
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7ee0c2", boxShadow: "0 0 10px rgba(126,224,194,0.8)" }} />
          <span style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeName}</span>
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
        <div style={{ height: "calc(100% - 38px)", width: "100%", minWidth: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", boxSizing: "border-box" }}>
          <div style={{ borderBottom: "1px solid #273453", background: "#101827", minWidth: 0, boxSizing: "border-box" }}>
            <div style={{ height: 38, width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", overflowX: "auto" }}>
              {pinnedTabs.map((channel) => {
                const active = channel.id === activeChannel;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setActiveChannel(channel.id)}
                    title={channel.name}
                    style={{
                      flex: "0 0 auto",
                      height: 26,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: 130,
                      borderRadius: 6,
                      border: active ? "1px solid #2a8c72" : "1px solid #2a3558",
                      background: active ? "#10251f" : "#121828",
                      color: active ? "#7ee0c2" : "var(--text-dim)",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 900,
                      padding: "0 8px",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.name}</span>
                    {channel.id !== defaultChannel && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Unpin channel"
                        onClick={(event) => {
                          event.stopPropagation();
                          unpinChannel(channel.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            unpinChannel(channel.id);
                          }
                        }}
                        style={{ color: active ? "#7ee0c2" : "var(--text-dim)", fontSize: 12, lineHeight: 1 }}
                      >
                        x
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setChannelListOpen((value) => !value);
                  void refreshChannels();
                }}
                title="Channels"
                style={{
                  flex: "0 0 auto",
                  width: 28,
                  height: 26,
                  borderRadius: 6,
                  border: "1px solid #2a3558",
                  background: channelListOpen ? "#0b2540" : "#121828",
                  color: channelListOpen ? "#93c5fd" : "var(--text-dim)",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                #
              </button>
            </div>
            {channelListOpen && (
              <div style={{ maxHeight: 112, width: "100%", boxSizing: "border-box", overflow: "auto", padding: "0 8px 8px", display: "grid", gap: 6 }}>
                {(availableChannels.length ? availableChannels : channels).map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => pinChannel(channel.id)}
                    title={channel.url || channel.name}
                    style={{
                      height: 28,
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      border: "1px solid #273453",
                      background: "#0b1020",
                      color: "var(--text)",
                      cursor: "pointer",
                      padding: "0 8px",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{channel.name}</span>
                    <span style={{ color: "#7ee0c2", fontWeight: 900 }}>{pinnedChannels.includes(channel.id) ? "PINNED" : "PIN"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ overflow: "auto", minWidth: 0, padding: 10, display: "grid", gap: 8, alignContent: "end", boxSizing: "border-box" }}>
            {messages.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12, alignSelf: "center", justifySelf: "center" }}>
                No messages in {activeName}.
              </div>
            ) : messages.map((message) => (
              <div key={message.id} style={{ border: "1px solid #273453", borderRadius: 8, background: "#0b1020", padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--text-dim)" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{messageIdentity(message)}</span>
                  <span>{timeLabel(message.created_at)}</span>
                </div>
                {message.source === "technocore" && (
                  <div style={{ marginTop: 5, display: "flex", gap: 6 }}>
                    <span style={{ height: 17, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, border: "1px solid #1d4f73", background: "#0b2540", color: "#93c5fd", fontSize: 10, fontWeight: 900 }}>
                      technocore
                    </span>
                    <span style={{ height: 17, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, border: "1px solid #3b2f1c", background: "#231a0c", color: "#facc15", fontSize: 10, fontWeight: 900 }}>
                      untrusted
                    </span>
                  </div>
                )}
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
            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 62px", gap: 8, padding: 10, borderTop: "1px solid #273453" }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              maxLength={500}
              placeholder={`Message ${activeName}`}
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
