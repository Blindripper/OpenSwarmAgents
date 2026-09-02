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
const slowModeKey = "osa-network-chat-slow-mode";
const minimizedChatSize = { width: 240, height: 38 };
const minChatSize = { width: 340, height: 360 };
const preferredChatSize = { width: 680, height: 740 };
const chatMessageLimit = 60;
const chatRefreshMs = 500;
const channelRefreshMs = 15000;
const chatRequestTimeoutMs = 6500;
const channelRequestTimeoutMs = 8000;
const slowBurstThreshold = 6;
const slowBatchSize = 3;
const slowFlushMs = 500;
const maxSlowQueue = 30;

interface ChatSize {
  width: number;
  height: number;
}

function shortAddress(address?: string | null): string {
  if (!address) return "node";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function loadPinnedChannels(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pinnedChannelsKey) || "[]");
    if (Array.isArray(parsed)) {
      const channels = parsed.filter((item) => typeof item === "string" && item.length > 0).slice(0, 16);
      return channels.includes(defaultChannel) ? channels : [defaultChannel, ...channels];
    }
  } catch { /* ignore stored UI state */ }
  return [defaultChannel];
}

function uniqueChannels(channels: string[]): string[] {
  return [...new Set(channels.filter(Boolean))].slice(0, 16);
}

function loadSlowMode(): boolean {
  return window.localStorage.getItem(slowModeKey) !== "0";
}

function messageIdentity(message: NetworkChatMessage): string {
  if (message.from?.startsWith("did:key:")) return `<${message.from.slice(8, 18)}...>`;
  if (message.source === "technocore") {
    return message.from ? `~${message.from.slice(0, 28)}` : "technocore";
  }
  return shortAddress(message.wallet_address);
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function maxChatSize(dockRightOffset: number): ChatSize {
  return {
    width: Math.max(minChatSize.width, window.innerWidth - dockRightOffset - 24),
    height: Math.max(minChatSize.height, window.innerHeight - 120),
  };
}

function clampChatSize(size: ChatSize, dockRightOffset: number): ChatSize {
  const maxSize = maxChatSize(dockRightOffset);
  return {
    width: Math.max(minChatSize.width, Math.min(maxSize.width, size.width)),
    height: Math.max(minChatSize.height, Math.min(maxSize.height, size.height)),
  };
}

function defaultChatSize(dockRightOffset: number): ChatSize {
  return clampChatSize(preferredChatSize, dockRightOffset);
}

function defaultChatPos(dockRightOffset: number, size: ChatSize, minimized = false) {
  const width = minimized ? minimizedChatSize.width : size.width;
  const height = minimized ? minimizedChatSize.height : size.height;
  return {
    left: Math.max(16, window.innerWidth - dockRightOffset - width),
    top: Math.max(80, window.innerHeight - height - 40),
  };
}

function defaultChannelRecord(id: string): NetworkChannel {
  return { id, name: id, source: id === defaultChannel ? "osa" : "technocore", pinned: id === defaultChannel, public: id === defaultChannel, category: id === defaultChannel ? "main" : "other", description: "" };
}

function compareMessages(a: NetworkChatMessage, b: NetworkChatMessage): number {
  const byTime = String(a.created_at || "").localeCompare(String(b.created_at || ""));
  if (byTime !== 0) return byTime;
  const bySeq = Number(a.seq || 0) - Number(b.seq || 0);
  if (bySeq !== 0) return bySeq;
  return a.id.localeCompare(b.id);
}

function sameTechnocoreDelivery(a: NetworkChatMessage, b: NetworkChatMessage): boolean {
  if ((a.room || defaultChannel) !== (b.room || defaultChannel) || a.message !== b.message) return false;
  if (a.from && b.from && a.from !== b.from) return false;
  const aSeq = Number.isFinite(a.seq) && Number(a.seq) > 0;
  const bSeq = Number.isFinite(b.seq) && Number(b.seq) > 0;
  const aProvisional = a.id.startsWith("technocore-chat-outgoing-");
  const bProvisional = b.id.startsWith("technocore-chat-outgoing-");
  if ((aProvisional && bSeq) || (bProvisional && aSeq)) return true;
  return aSeq && bSeq && Number(a.seq) === Number(b.seq)
    && new Set([a.source, b.source]).has("technocore");
}

function preferredTechnocoreDelivery(a: NetworkChatMessage, b: NetworkChatMessage): NetworkChatMessage {
  if (a.source === "osa" && b.source === "technocore") return a;
  if (b.source === "osa" && a.source === "technocore") return b;
  if (Number.isFinite(b.seq) && !Number.isFinite(a.seq)) return b;
  return a;
}

function mergeAllMessages(previous: NetworkChatMessage[], incoming: NetworkChatMessage[]): NetworkChatMessage[] {
  const merged: NetworkChatMessage[] = [];
  for (const message of [...previous, ...incoming]) {
    const sameIdIndex = merged.findIndex((existing) => existing.id === message.id);
    if (sameIdIndex >= 0) {
      merged[sameIdIndex] = message;
      continue;
    }
    const deliveryIndex = merged.findIndex((existing) => sameTechnocoreDelivery(existing, message));
    if (deliveryIndex >= 0) {
      merged[deliveryIndex] = preferredTechnocoreDelivery(merged[deliveryIndex], message);
      continue;
    }
    merged.push(message);
  }
  return merged.sort(compareMessages);
}

export function mergeMessages(previous: NetworkChatMessage[], incoming: NetworkChatMessage[]): NetworkChatMessage[] {
  return mergeAllMessages(previous, incoming).slice(-100);
}

function boundedSlowQueue(messages: NetworkChatMessage[]): NetworkChatMessage[] {
  return mergeAllMessages([], messages).slice(-maxSlowQueue);
}

export async function requestWithTimeout<T>(
  label: string,
  timeoutMs: number,
  controller: AbortController,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let timeout = 0;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = window.setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), timeoutPromise]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function stageIncomingMessages(
  current: NetworkChatMessage[],
  queued: NetworkChatMessage[],
  incoming: NetworkChatMessage[],
  initialized: boolean,
  slowMode: boolean,
): { visible: NetworkChatMessage[]; queued: NetworkChatMessage[] } {
  const knownIds = new Set([...current, ...queued].map((message) => message.id));
  const freshMessages = mergeMessages([], incoming.filter((message) => !knownIds.has(message.id)));
  if (freshMessages.length === 0 && (slowMode || queued.length === 0)) {
    return { visible: current, queued };
  }
  if (!initialized || !slowMode) {
    return { visible: mergeMessages(current, [...queued, ...incoming]), queued: [] };
  }
  if (queued.length) {
    return { visible: current, queued: freshMessages.length ? boundedSlowQueue([...queued, ...freshMessages]) : queued };
  }
  if (freshMessages.length <= slowBurstThreshold) {
    return { visible: mergeMessages(current, freshMessages), queued };
  }
  return {
    visible: mergeMessages(current, freshMessages.slice(0, slowBatchSize)),
    queued: boundedSlowQueue(freshMessages.slice(slowBatchSize)),
  };
}

export function flushQueuedMessages(
  current: NetworkChatMessage[],
  queued: NetworkChatMessage[],
): { visible: NetworkChatMessage[]; queued: NetworkChatMessage[] } {
  return {
    visible: mergeMessages(current, queued.slice(0, slowBatchSize)),
    queued: queued.slice(slowBatchSize),
  };
}

export function isNearChatBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= 48;
}

export function shouldCompleteInitialChannelLoad(messageCount: number, indexedCount: number | null | undefined, emptyResponses: number): boolean {
  if (messageCount > 0 || indexedCount === 0) return true;
  return indexedCount == null && emptyResponses >= 2;
}

export function NetworkChatWindow({ walletAddress, refreshKey = 0, dockRightOffset = 16 }: Props) {
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, NetworkChatMessage[]>>({});
  const messagesByChannelRef = useRef<Record<string, NetworkChatMessage[]>>({});
  const [queuedMessagesByChannel, setQueuedMessagesByChannel] = useState<Record<string, NetworkChatMessage[]>>({});
  const queuedMessagesByChannelRef = useRef<Record<string, NetworkChatMessage[]>>({});
  const lastFetchedSeqByChannelRef = useRef<Record<string, number>>({});
  const initialEmptyResponsesByChannelRef = useRef<Record<string, number>>({});
  const initializedChannelsRef = useRef(new Set<string>());
  const [initializedChannels, setInitializedChannels] = useState(new Set<string>());
  const refreshingChannelsRef = useRef(new Set<string>());
  const chatAbortControllersRef = useRef(new Map<string, AbortController>());
  const refreshingChannelListRef = useRef(false);
  const channelAbortControllerRef = useRef<AbortController | null>(null);
  const refreshFailuresByChannelRef = useRef<Record<string, number>>({});
  const refreshBackoffUntilByChannelRef = useRef<Record<string, number>>({});
  const [channels, setChannels] = useState<NetworkChannel[]>([defaultChannelRecord(defaultChannel)]);
  const channelsRef = useRef<NetworkChannel[]>(channels);
  const [pinnedChannels, setPinnedChannels] = useState<string[]>(loadPinnedChannels);
  const [activeChannel, setActiveChannel] = useState(() => loadPinnedChannels()[0] || defaultChannel);
  const [channelListOpen, setChannelListOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [slowMode, setSlowMode] = useState(loadSlowMode);
  const slowModeRef = useRef(slowMode);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [size, setSize] = useState(() => defaultChatSize(dockRightOffset));
  const [pos, setPos] = useState(() => defaultChatPos(dockRightOffset, defaultChatSize(dockRightOffset)));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const userMovedRef = useRef(false);
  const userResizedRef = useRef(false);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showNewest, setShowNewest] = useState(false);

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const pinnedTabs = pinnedChannels.map((id) => channelById.get(id) || defaultChannelRecord(id));
  const availableChannels = channels.filter((channel) => !pinnedChannels.includes(channel.id));
  const normalizedChannelSearch = channelSearch.trim().toLocaleLowerCase();
  const filteredChannels = normalizedChannelSearch
    ? availableChannels.filter((channel) => [channel.name, channel.id, channel.topic, channel.description, channel.category]
      .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedChannelSearch)))
    : availableChannels;
  const mainChannels = filteredChannels.filter((channel) => channel.category === "main");
  const otherChannels = filteredChannels.filter((channel) => channel.category !== "main");
  const activeChannelRecord = channelById.get(activeChannel);
  const activeName = activeChannelRecord?.name || activeChannel || defaultChannel;
  const activeRoomInfo = String(activeChannelRecord?.topic || activeChannelRecord?.description || "").trim();
  const loadingMessages = !initializedChannels.has(activeChannel);
  const messages = messagesByChannel[activeChannel] || [];
  const queuedMessages = queuedMessagesByChannel[activeChannel] || [];
  const normalizedMessageSearch = messageSearch.trim().toLocaleLowerCase();
  const visibleMessages = normalizedMessageSearch
    ? messages.filter((message) => [message.message, message.from, message.wallet_address, messageIdentity(message)]
      .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedMessageSearch)))
    : messages;
  const visibleSize = minimized ? minimizedChatSize : size;

  useEffect(() => {
    messagesByChannelRef.current = messagesByChannel;
  }, [messagesByChannel]);

  useEffect(() => {
    queuedMessagesByChannelRef.current = queuedMessagesByChannel;
  }, [queuedMessagesByChannel]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    slowModeRef.current = slowMode;
  }, [slowMode]);

  function storeChannelMessages(channel: string, next: NetworkChatMessage[]) {
    messagesByChannelRef.current = { ...messagesByChannelRef.current, [channel]: next };
    setMessagesByChannel((previous) => ({ ...previous, [channel]: next }));
  }

  function storeQueuedMessages(channel: string, next: NetworkChatMessage[]) {
    queuedMessagesByChannelRef.current = { ...queuedMessagesByChannelRef.current, [channel]: next };
    setQueuedMessagesByChannel((previous) => ({ ...previous, [channel]: next }));
  }

  function updateSlowMode(next: boolean) {
    slowModeRef.current = next;
    setSlowMode(next);
  }

  function markChannelInitialized(channel: string) {
    if (initializedChannelsRef.current.has(channel)) return;
    initializedChannelsRef.current.add(channel);
    setInitializedChannels((previous) => {
      if (previous.has(channel)) return previous;
      const next = new Set(previous);
      next.add(channel);
      return next;
    });
  }

  async function refreshMessages(channel = activeChannel) {
    if (Date.now() < (refreshBackoffUntilByChannelRef.current[channel] || 0)) return;
    if (refreshingChannelsRef.current.has(channel)) return;
    refreshingChannelsRef.current.add(channel);
    const controller = new AbortController();
    chatAbortControllersRef.current.set(channel, controller);
    const cachedMessages = messagesByChannelRef.current[channel] || [];
    const initialized = initializedChannelsRef.current.has(channel);
    const lastVisibleTechnocoreSeq = Math.max(
      0,
      ...cachedMessages
        .filter((message) => message.source === "technocore" && Number.isFinite(message.seq))
        .map((message) => Number(message.seq)),
    );
    const lastTechnocoreSeq = Math.max(lastVisibleTechnocoreSeq, lastFetchedSeqByChannelRef.current[channel] || 0);
    try {
      const result = await requestWithTimeout(
        `Chat refresh for ${channel}`,
        chatRequestTimeoutMs,
        controller,
        (signal) => api.network.chat(chatMessageLimit, channel, lastTechnocoreSeq || undefined, signal),
      );
      const indexedCount = channelsRef.current.find((item) => item.id === channel)?.count;
      const emptyResponses = result.messages.length > 0
        ? 0
        : (initialEmptyResponsesByChannelRef.current[channel] || 0) + 1;
      initialEmptyResponsesByChannelRef.current[channel] = emptyResponses;
      if (shouldCompleteInitialChannelLoad(result.messages.length, indexedCount, emptyResponses)) {
        initialEmptyResponsesByChannelRef.current[channel] = 0;
        markChannelInitialized(channel);
      }
      const fetchedSeq = Math.max(
        lastTechnocoreSeq,
        ...result.messages
          .filter((message) => message.source === "technocore" && Number.isFinite(message.seq))
          .map((message) => Number(message.seq)),
      );
      lastFetchedSeqByChannelRef.current[channel] = fetchedSeq;

      const current = messagesByChannelRef.current[channel] || [];
      const queued = queuedMessagesByChannelRef.current[channel] || [];
      const staged = stageIncomingMessages(current, queued, result.messages, initialized, slowModeRef.current);
      if (staged.visible !== current) storeChannelMessages(channel, staged.visible);
      if (staged.queued !== queued) storeQueuedMessages(channel, staged.queued);
      refreshFailuresByChannelRef.current[channel] = 0;
      refreshBackoffUntilByChannelRef.current[channel] = 0;
      setError(null);
    } catch (err) {
      const failures = Math.min(5, (refreshFailuresByChannelRef.current[channel] || 0) + 1);
      refreshFailuresByChannelRef.current[channel] = failures;
      refreshBackoffUntilByChannelRef.current[channel] = Date.now() + Math.min(2000, 250 * (2 ** (failures - 1)));
      setError((err as Error).message || "Chat refresh failed.");
    } finally {
      if (chatAbortControllersRef.current.get(channel) === controller) {
        chatAbortControllersRef.current.delete(channel);
        refreshingChannelsRef.current.delete(channel);
      }
    }
  }

  async function refreshChannels() {
    if (refreshingChannelListRef.current) return;
    refreshingChannelListRef.current = true;
    const controller = new AbortController();
    channelAbortControllerRef.current = controller;
    try {
      const result = await requestWithTimeout(
        "Channel refresh",
        channelRequestTimeoutMs,
        controller,
        (signal) => api.network.channels(60, signal),
      );
      const nextChannels = result.channels.length ? result.channels : [defaultChannelRecord(defaultChannel)];
      setChannels(nextChannels);
      setPinnedChannels((previous) => uniqueChannels([
        defaultChannel,
        ...previous,
        ...nextChannels.filter((channel) => channel.pinned).map((channel) => channel.id)
      ]));
    } catch {
      setChannels((previous) => previous.length ? previous : [defaultChannelRecord(defaultChannel)]);
    } finally {
      if (channelAbortControllerRef.current === controller) {
        channelAbortControllerRef.current = null;
        refreshingChannelListRef.current = false;
      }
    }
  }

  useEffect(() => {
    window.localStorage.setItem(pinnedChannelsKey, JSON.stringify(pinnedChannels));
  }, [pinnedChannels]);

  useEffect(() => {
    window.localStorage.setItem(slowModeKey, slowMode ? "1" : "0");
    if (slowMode) return;
    for (const [channel, queued] of Object.entries(queuedMessagesByChannelRef.current)) {
      if (!queued.length) continue;
      storeChannelMessages(channel, mergeMessages(messagesByChannelRef.current[channel] || [], queued));
      storeQueuedMessages(channel, []);
    }
  }, [slowMode]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await refreshChannels();
      if (!cancelled) timer = window.setTimeout(() => void tick(), channelRefreshMs);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      channelAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await refreshMessages(activeChannel);
      if (!cancelled) timer = window.setTimeout(() => void tick(), chatRefreshMs);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeChannel, slowMode]);

  useEffect(() => {
    if (!slowMode) return;
    const timer = window.setInterval(() => {
      const queued = queuedMessagesByChannelRef.current[activeChannel] || [];
      if (!queued.length) return;
      const flushed = flushQueuedMessages(messagesByChannelRef.current[activeChannel] || [], queued);
      storeChannelMessages(activeChannel, flushed.visible);
      storeQueuedMessages(activeChannel, flushed.queued);
    }, slowFlushMs);
    return () => window.clearInterval(timer);
  }, [activeChannel, slowMode]);

  useEffect(() => {
    if (refreshKey > 0) void refreshMessages(activeChannel);
  }, [refreshKey]);

  useEffect(() => () => {
    for (const controller of chatAbortControllersRef.current.values()) controller.abort();
    chatAbortControllersRef.current.clear();
    refreshingChannelsRef.current.clear();
  }, []);

  useEffect(() => {
    if (pinnedChannels.includes(activeChannel)) return;
    setActiveChannel(pinnedChannels[0] || defaultChannel);
  }, [activeChannel, pinnedChannels]);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowNewest(false);
    setMessageSearch("");
  }, [activeChannel]);

  const newestVisibleMessageId = visibleMessages[visibleMessages.length - 1]?.id || "";

  useEffect(() => {
    const viewport = messageScrollRef.current;
    if (!viewport || normalizedMessageSearch || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeChannel, minimized, normalizedMessageSearch, newestVisibleMessageId, size.height]);

  function jumpToNewest() {
    stickToBottomRef.current = true;
    setShowNewest(false);
    const viewport = messageScrollRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }

  useEffect(() => {
    const nextSize = userResizedRef.current ? clampChatSize(size, dockRightOffset) : defaultChatSize(dockRightOffset);
    if (!userResizedRef.current) setSize(nextSize);
    if (!userMovedRef.current) setPos(defaultChatPos(dockRightOffset, nextSize, minimized));
  }, [dockRightOffset, minimized]);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      if (resizeRef.current) {
        userResizedRef.current = true;
        const maxWidth = Math.max(minChatSize.width, window.innerWidth - pos.left - 8);
        const maxHeight = Math.max(minChatSize.height, window.innerHeight - pos.top - 8);
        setSize({
          width: Math.max(minChatSize.width, Math.min(maxWidth, resizeRef.current.width + event.clientX - resizeRef.current.startX)),
          height: Math.max(minChatSize.height, Math.min(maxHeight, resizeRef.current.height + event.clientY - resizeRef.current.startY)),
        });
        return;
      }
      if (!dragRef.current) return;
      setPos({
        left: Math.max(8, Math.min(window.innerWidth - visibleSize.width - 8, event.clientX - dragRef.current.dx)),
        top: Math.max(8, Math.min(window.innerHeight - 40, event.clientY - dragRef.current.dy)),
      });
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pos.left, pos.top, visibleSize.width]);

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
      storeChannelMessages(activeChannel, mergeMessages(messagesByChannelRef.current[activeChannel] || [], [result.message]));
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
      data-testid="network-chat-window"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: visibleSize.width,
        height: visibleSize.height,
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
          <div style={{ position: "relative", borderBottom: "1px solid #273453", background: "#101827", minWidth: 0, boxSizing: "border-box" }}>
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
              <div style={{ position: "absolute", zIndex: 4, top: 38, left: 0, right: 0, maxHeight: 260, width: "100%", boxSizing: "border-box", overflow: "auto", padding: 8, display: "grid", gap: 10, borderBottom: "1px solid #273453", background: "#101827", boxShadow: "0 14px 28px rgba(0,0,0,0.36)" }}>
                <input
                  value={channelSearch}
                  onChange={(event) => setChannelSearch(event.currentTarget.value)}
                  placeholder="Search channels"
                  aria-label="Search channels"
                  autoFocus
                  style={{
                    width: "100%",
                    height: 30,
                    borderRadius: 6,
                    border: "1px solid #2a3558",
                    background: "#0b1020",
                    color: "var(--text)",
                    padding: "0 9px",
                    boxSizing: "border-box",
                  }}
                />
                {[
                  ["Main channels", mainChannels],
                  ["Other channels", otherChannels],
                ].map(([label, group]) => (
                  <div key={label as string} style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>
                      {label as string}
                    </div>
                    {(group as NetworkChannel[]).map((channel) => (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => pinChannel(channel.id)}
                        title={channel.description || channel.url || channel.name}
                        style={{
                          minHeight: 34,
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 8,
                          borderRadius: 6,
                          border: "1px solid #273453",
                          background: "#0b1020",
                          color: "var(--text)",
                          cursor: "pointer",
                          padding: "6px 8px",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        <span style={{ minWidth: 0, display: "grid", gap: 2, textAlign: "left" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.name}</span>
                          {(channel.topic || channel.description) && (
                            <span style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.topic || channel.description}</span>
                          )}
                        </span>
                        <span style={{ color: "#7ee0c2", fontWeight: 900 }}>{pinnedChannels.includes(channel.id) ? "PINNED" : "PIN"}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {filteredChannels.length === 0 && (
                  <div style={{ color: "var(--text-dim)", fontSize: 11, padding: "4px 0 2px" }}>No matching channels.</div>
                )}
              </div>
            )}
            {activeRoomInfo && (
              <div
                data-testid="network-chat-room-info"
                title={activeRoomInfo}
                style={{ width: "100%", minHeight: 34, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "start", gap: 8, padding: "7px 10px", borderTop: "1px solid #1d2943", background: "#0d1524", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7ee0c2", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Room info</span>
                <span style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.35, overflowWrap: "anywhere" }}>{activeRoomInfo}</span>
              </div>
            )}
            <div style={{ height: 38, width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "0 8px", borderTop: "1px solid #1d2943", boxSizing: "border-box" }}>
              <input
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.currentTarget.value)}
                placeholder="Search messages"
                aria-label="Search messages"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid #2a3558",
                  background: "#0b1020",
                  color: "var(--text)",
                  padding: "0 9px",
                  boxSizing: "border-box",
                }}
              />
              <label
                title="Slow mode releases bursts in small batches and keeps only the newest buffered messages when traffic is faster than the display."
                style={{ height: 28, flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "0 8px", border: slowMode ? "1px solid #2a8c72" : "1px solid #2a3558", borderRadius: 6, background: slowMode ? "#10251f" : "#121828", color: slowMode ? "#7ee0c2" : "var(--text-dim)", fontSize: 10, fontWeight: 900, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={slowMode}
                  onChange={(event) => updateSlowMode(event.currentTarget.checked)}
                  aria-label="Slow mode"
                  style={{ margin: 0, accentColor: "#16a37b" }}
                />
                Slow mode
                {queuedMessages.length > 0 && <span>({queuedMessages.length})</span>}
              </label>
            </div>
          </div>

          <div style={{ position: "relative", height: "100%", minHeight: 0, minWidth: 0 }}>
            <div
              ref={messageScrollRef}
              data-testid="network-chat-messages"
              onScroll={(event) => {
                const viewport = event.currentTarget;
                const atNewest = isNearChatBottom(viewport.scrollHeight, viewport.scrollTop, viewport.clientHeight);
                if (stickToBottomRef.current === atNewest) return;
                stickToBottomRef.current = atNewest;
                setShowNewest(!atNewest);
              }}
              style={{ height: "100%", minHeight: 0, minWidth: 0, overflowY: "scroll", overflowX: "hidden", scrollbarGutter: "stable", boxSizing: "border-box" }}
            >
              <div style={{ minHeight: "100%", padding: 10, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8, boxSizing: "border-box" }}>
            {visibleMessages.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12, margin: "auto", textAlign: "center" }}>
                {loadingMessages
                  ? `Loading ${activeName}...`
                  : normalizedMessageSearch
                    ? `No messages match "${messageSearch.trim()}".`
                    : `No cached messages in ${activeName}.`}
              </div>
            ) : visibleMessages.map((message) => (
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
                    {message.delivery_status && message.delivery_status !== "sent" && (
                      <span
                        title={message.warning || message.delivery_status}
                        style={{ height: 17, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, border: "1px solid #244c35", background: "#102419", color: "#86efac", fontSize: 10, fontWeight: 900 }}
                      >
                        {message.delivery_status}
                      </span>
                    )}
                  </div>
                )}
                {message.verified && message.from?.startsWith("did:key:") && (
                  <div style={{ marginTop: 5 }}>
                    <span style={{ height: 17, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, border: "1px solid #244c35", background: "#102419", color: "#86efac", fontSize: 10, fontWeight: 900 }}>
                      verified DID
                    </span>
                  </div>
                )}
                <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.4 }}>{message.message}</div>
              </div>
            ))}
            {error && <div style={{ color: "#ff8a8a", fontSize: 11 }}>{error}</div>}
              </div>
            </div>
            {showNewest && !normalizedMessageSearch && (
              <button
                type="button"
                onClick={jumpToNewest}
                aria-label="Jump to newest message"
                data-testid="network-chat-newest"
                style={{
                  position: "absolute",
                  right: 18,
                  bottom: 12,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 14,
                  border: "1px solid #2a8c72",
                  background: "#10251f",
                  color: "#7ee0c2",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                Newest ↓
              </button>
            )}
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
          <div
            data-testid="network-chat-resize"
            title="Resize chat"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              userResizedRef.current = true;
              resizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                width: size.width,
                height: size.height,
              };
            }}
            style={{
              position: "absolute",
              right: 3,
              bottom: 3,
              width: 16,
              height: 16,
              cursor: "nwse-resize",
              background: "linear-gradient(135deg, transparent 0 45%, #2a3558 45% 55%, transparent 55%), linear-gradient(135deg, transparent 0 65%, #7ee0c2 65% 75%, transparent 75%)",
              opacity: 0.9,
            }}
          />
        </div>
      )}
    </div>
  );
}
