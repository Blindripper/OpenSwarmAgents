import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMailboxMessage, AgentMailboxOverview } from "../types";
import { AgentMailboxesPanel, canReplyToMailboxMessage, mailboxMessageLabel } from "./AgentMailboxesPanel";

const localDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
const remoteDid = "did:key:z6MktCjMnQxY8SdzpQwL2oCePJqBM2SYA11vngd4D2fa5g9Z";

function message(overrides: Partial<AgentMailboxMessage> = {}): AgentMailboxMessage {
  return {
    id: "mailbox-in-1",
    box: "inbox",
    profile: "osa-agent-mailbox/1",
    frame_type: "MESSAGE",
    frame_id: "frame-mb-1",
    message_id: "msg-mb-1",
    sender: { source: "federated", agent_id: "remote-coder", name: "Remote Coder", did: remoteDid, node_id: "node-remote" },
    recipient: { source: "local", agent_id: "coder", name: "Coder", did: localDid, node_id: "node-local" },
    room: "mb-osa-0123456789012345678901234567890123456789",
    text: "Verified bounded chat text",
    created_at: "2026-09-05T10:00:00.000Z",
    expires_at: "2026-09-05T11:00:00.000Z",
    envelope_hash: "a".repeat(64),
    verified: true,
    trust: "verified",
    delivery_status: "received",
    last_seen_at: "2026-09-05T10:00:00.000Z",
    public_unlisted: true,
    authority: "none",
    handling: "bounded-chat-text-only",
    remote_execution: false,
    ...overrides,
  };
}

function overview(): AgentMailboxOverview {
  const quarantine = message({ id: "mailbox-quarantine-1", box: "quarantine", verified: false, trust: "untrusted", delivery_status: "quarantined", rejection: "signature_unverified", text: null });
  return {
    profile: "osa-agent-mailbox/1",
    a2a_profile: "osa-a2a-room/1",
    generated_at: "2026-09-05T10:00:00.000Z",
    derivation: { algorithm: "mb-osa- + first 40 lowercase hex characters of SHA-256(UTF-8 recipient DID)", hash: "sha256", hash_bits: 160, prefix: "mb-osa-", room_limit: 48 },
    limits: { maxRoomLength: 48, hashHexLength: 40, maxTextBytes: 1000, maxTtlMs: 86400000, maxClientMessageIdLength: 128, projection_limit: 1000, sync_room_limit: 100 },
    policy: { visibility: "public-unlisted", warning: "Mailbox content is public on Technocore. Never include secrets.", acknowledgement_field: "public_unlisted_acknowledged", accepted_frame_types: ["MESSAGE", "ACK"], sent_frame_types: ["MESSAGE"], authority: "none", signatures_mean: "authorship and integrity only", remote_execution: false, task_dispatch: false, session_spawning: false, workspace_creation: false, connector_spawning: false },
    senders: [{ agent_id: "coder", name: "Coder", did: localDid, node_id: "node-local", mailbox_room: "mb-osa-local" }],
    selected_sender: { agent_id: "coder", name: "Coder", did: localDid, node_id: "node-local", mailbox_room: "mb-osa-local" },
    recipients: [{ key: `federated:node-remote:remote-coder:${remoteDid}`, source: "federated", agent_id: "remote-coder", name: "Remote Coder", did: remoteDid, node_id: "node-remote", verified: true, stale: false, eligibility: "fresh_verified_capability_registry", mailbox_room: "mb-osa-remote" }],
    sync: null,
    counts: { inbox: 1, outbox: 0, quarantine: 1 },
    inbox: [message()],
    outbox: [],
    quarantine: [quarantine],
  };
}

function jsonResponse(body: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, status: ok ? 200 : 400, statusText: ok ? "OK" : "Bad Request", json: () => Promise.resolve(body) } as Response);
}

function notFoundResponse(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: () => Promise.resolve({ detail: "not found" }) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("AgentMailboxesPanel", () => {
  it("requires acknowledgement and a second explicit confirmation before sending bounded public text", async () => {
    const payload = overview();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/agent-mailboxes/send") return jsonResponse({ ok: true, idempotent_replay: false, message: message({ id: "mailbox-out-1", box: "outbox", delivery_status: "sent" }) });
      return jsonResponse(payload);
    });
    render(<AgentMailboxesPanel />);

    expect(await screen.findByText("Agent Mailboxes")).toBeInTheDocument();
    expect(screen.getByText(/PUBLIC \/ UNLISTED ON TECHNOCORE/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Mailbox message" }), { target: { value: "Hello verified remote agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Review public send" }));
    expect(await screen.findByText(/Acknowledge that this message is public\/unlisted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge public unlisted mailbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Review public send" }));
    expect(screen.getByRole("dialog", { name: "Confirm public mailbox send" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/agent-mailboxes/send", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm and publish" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/agent-mailboxes/send", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"public_unlisted_acknowledged":true'),
    })));
    const sendCall = fetchSpy.mock.calls.find(([input]) => String(input) === "/api/agent-mailboxes/send");
    const body = JSON.parse(String((sendCall?.[1] as RequestInit)?.body || "{}"));
    expect(body.sender_agent_id).toBe("coder");
    expect(body.sender_did).toBe(localDid);
    expect(body.recipient).toEqual(expect.objectContaining({ source: "federated", agent_id: "remote-coder", did: remoteDid, node_id: "node-remote" }));
    expect(body).not.toHaveProperty("room");
    expect(body).not.toHaveProperty("task_id");
  });

  it("renders verified inbox and explicit quarantine/no-authority states without exposing raw signatures", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(overview()));
    render(<AgentMailboxesPanel />);

    expect(await screen.findByText("Verified bounded chat text")).toBeInTheDocument();
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
    expect(screen.getAllByText("NO AUTHORITY").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Reply safely" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quarantine (1)" }));
    expect(await screen.findByText("Quarantined: signature_unverified")).toBeInTheDocument();
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getByTestId("agent-mailboxes").textContent).not.toMatch(/privateKey|BEGIN PRIVATE KEY|connector token:\s*\S+|signature:\s*[A-Za-z0-9_-]{32,}/i);
  });

  it("permits replies only to verified inbox authors that remain eligible", () => {
    const inbound = message();
    expect(mailboxMessageLabel(inbound)).toBe("VERIFIED");
    expect(canReplyToMailboxMessage(inbound, overview().recipients)).toBe(true);
    expect(canReplyToMailboxMessage({ ...inbound, verified: false, trust: "untrusted" }, overview().recipients)).toBe(false);
    expect(canReplyToMailboxMessage(inbound, [])).toBe(false);
  });

  it("shows a Network setup notice instead of raw 404 text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => notFoundResponse());
    render(<AgentMailboxesPanel />);

    expect(await screen.findByText("Mailbox backend required")).toBeInTheDocument();
    expect(screen.getByText(/choose a local sender/i)).toBeInTheDocument();
    expect(screen.getByTestId("agent-mailboxes").textContent).not.toMatch(/404|Not Found/i);
  });
});
