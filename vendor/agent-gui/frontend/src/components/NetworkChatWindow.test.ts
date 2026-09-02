import { describe, expect, it } from "vitest";
import type { NetworkChatMessage } from "../types";
import { flushQueuedMessages, mergeMessages, requestWithTimeout, stageIncomingMessages } from "./NetworkChatWindow";

function message(index: number): NetworkChatMessage {
  return {
    id: `message-${index}`,
    node_id: "technocore",
    message: `Message ${index}`,
    created_at: `2026-09-01T12:00:${String(index).padStart(2, "0")}.000Z`,
    source: "technocore",
    seq: index,
  };
}

describe("Technocore slow mode", () => {
  it("renders the initial room tail immediately", () => {
    const incoming = Array.from({ length: 10 }, (_, index) => message(index + 1));
    const staged = stageIncomingMessages([], [], incoming, false, true);
    expect(staged.visible.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(staged.queued).toEqual([]);
  });

  it("releases the first three messages and queues the rest of a burst", () => {
    const incoming = Array.from({ length: 8 }, (_, index) => message(index + 2));
    const staged = stageIncomingMessages([message(1)], [], incoming, true, true);
    expect(staged.visible.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(staged.queued.map((item) => item.seq)).toEqual([5, 6, 7, 8, 9]);
  });

  it("appends small follow-up fetches to an existing queue", () => {
    const current = [message(1), message(2), message(3), message(4)];
    const queued = [message(5), message(6), message(7)];
    const staged = stageIncomingMessages(current, queued, [message(7), message(8)], true, true);
    expect(staged.visible).toBe(current);
    expect(staged.queued.map((item) => item.seq)).toEqual([5, 6, 7, 8]);
  });

  it("bounds a continuously growing high-traffic queue to the newest messages", () => {
    const incoming = Array.from({ length: 80 }, (_, index) => message(index + 2));
    const staged = stageIncomingMessages([message(1)], [], incoming, true, true);
    expect(staged.visible.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(staged.queued).toHaveLength(30);
    expect(staged.queued[0]?.seq).toBe(52);
    expect(staged.queued[staged.queued.length - 1]?.seq).toBe(81);

    const next = stageIncomingMessages(staged.visible, staged.queued, [message(82), message(83)], true, true);
    expect(next.queued).toHaveLength(30);
    expect(next.queued[next.queued.length - 1]?.seq).toBe(83);
  });

  it("keeps stable references when a poll contains no new messages", () => {
    const current = [message(1), message(2)];
    const queued = [message(3)];
    const staged = stageIncomingMessages(current, queued, [message(2), message(3)], true, true);
    expect(staged.visible).toBe(current);
    expect(staged.queued).toBe(queued);
  });

  it("flushes every queued message when slow mode is disabled", () => {
    const staged = stageIncomingMessages([message(1)], [message(2), message(3)], [message(4)], true, false);
    expect(staged.visible.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(staged.queued).toEqual([]);
  });

  it("flushes queued messages in chronological groups of three", () => {
    const flushed = flushQueuedMessages([message(1)], [message(2), message(3), message(4), message(5)]);
    expect(flushed.visible.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(flushed.queued.map((item) => item.seq)).toEqual([5]);
  });

  it("aborts and releases a chat request that never settles", async () => {
    const controller = new AbortController();
    let aborted = false;
    const pending = requestWithTimeout("Chat refresh", 10, controller, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    }));
    await expect(pending).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});

describe("Technocore delivery reconciliation", () => {
  const did = "did:key:z6MkTestIdentity";

  it("replaces a provisional outgoing message with its confirmed sequence record", () => {
    const provisional: NetworkChatMessage = {
      ...message(1),
      id: "technocore-chat-outgoing-lobby-1",
      room: "lobby",
      from: did,
      seq: undefined,
      message: "One signed message",
    };
    const confirmed: NetworkChatMessage = {
      ...provisional,
      id: "technocore-chat-lobby-42",
      seq: 42,
    };
    expect(mergeMessages([provisional], [confirmed])).toEqual([confirmed]);
  });

  it("prefers the trusted local osa-network record over its mirrored external copy", () => {
    const local: NetworkChatMessage = {
      ...message(1),
      id: "network-chat-local-1",
      room: "osa-network",
      from: did,
      seq: 77,
      source: "osa",
      signed: true,
      verified: true,
      trusted: true,
      message: "Mirrored public message",
    };
    const external: NetworkChatMessage = {
      ...local,
      id: "technocore-chat-osa-network-77",
      source: "technocore",
      external: true,
      untrusted: false,
      trusted: true,
    };
    expect(mergeMessages([external], [local])).toEqual([local]);
  });
});
