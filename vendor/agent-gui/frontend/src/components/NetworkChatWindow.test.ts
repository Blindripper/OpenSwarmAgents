import { describe, expect, it } from "vitest";
import type { NetworkChatMessage } from "../types";
import { flushQueuedMessages, stageIncomingMessages } from "./NetworkChatWindow";

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
});
