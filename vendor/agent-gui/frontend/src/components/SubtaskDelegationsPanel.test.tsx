import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtaskDelegationOverview, SubtaskDelegationRecord } from "../types";
import { SubtaskDelegationsPanel } from "./SubtaskDelegationsPanel";

const localDid = "did:key:z6MkLocalSender";
const localRecipientDid = "did:key:z6MkLocalRecipient";

function record(overrides: Partial<SubtaskDelegationRecord> = {}): SubtaskDelegationRecord {
  return {
    id: "subtask-record-1",
    kind: "incoming",
    state: "pending",
    delegation_id: "subtask-1234567890abcdef",
    task_id: "task-subtask-1234567890abcdef",
    room: "mb-osa-1234567890abcdef1234567890abcdef1234",
    sender_did: localDid,
    sender_node_id: "node-local",
    recipient_did: localRecipientDid,
    recipient_node_id: "node-local",
    required_capabilities: ["research", "synthesis"],
    task_text: "Bounded external task text",
    result_text: "Bounded result text",
    created_at: "2026-09-06T10:00:00.000Z",
    updated_at: "2026-09-06T10:00:00.000Z",
    expiry: "2026-09-13T10:00:00.000Z",
    verified: true,
    local_confirmation: false,
    no_payment: true,
    no_settlement: true,
    authority: "none",
    sender_agent_id: "technocore-specialist",
    recipient_agent_id: "coder",
    provenance: { kind: "technocore", room: "mb-osa-123", seq: 12 },
    ...overrides,
  };
}

function overview(overrides: Partial<SubtaskDelegationOverview> = {}): SubtaskDelegationOverview {
  return {
    schema: "osa-subtask-delegation/1",
    version: 1,
    generated_at: "2026-09-06T10:00:00.000Z",
    policy: {
      visibility: "public-unlisted",
      warning: "Public/unlisted on Technocore.",
      authority: "none",
      no_payment: true,
      no_settlement: true,
      public_text_only: true,
      workspace_creation: true,
      connector_spawning: false,
      remote_execution: false,
    },
    semantics: {
      adapter: "osa-subtask-delegation/1",
      official_a2a_compatibility: "narrow profile only; not full official A2A HTTP/JSON-RPC compatibility",
      mailbox_transport: "deterministic mb-osa-* recipient rooms",
      signatures_mean: "authorship and integrity only",
      authority: "none",
      remote_execution: false,
      value_settlement: false,
    },
    status: {
      enabled: true,
      rooms: ["mb-osa-1234567890abcdef1234567890abcdef1234"],
      last_attempt_at: null,
      last_synced_at: null,
      last_scan_status: "live",
      last_error: null,
      discovered_count: 1,
      verified_count: 1,
      rejected_count: 0,
      local_count: 0,
      incoming_count: 0,
      outgoing_count: 0,
      result_count: 0,
      quarantine_count: 0,
    },
    senders: [{ agent_id: "technocore-specialist", name: "Technocore Specialist", did: localDid, node_id: "node-local", node_did: null, mailbox_room: "mb-osa-sender", capabilities: ["research", "synthesis"], source: "local", verified: true, stale: false }],
    recipients: [{ key: `local:node-local:coder:${localRecipientDid}`, source: "local", agent_id: "coder", name: "Coder", did: localRecipientDid, node_id: "node-local", node_did: null, verified: true, stale: false, eligibility: "local_verified_capability_match", capabilities: ["research", "synthesis"], mailbox_room: "mb-osa-recipient", provenance: { kind: "local", node_id: "node-local" } }],
    capability_options: ["research", "synthesis", "testing"],
    incoming: [],
    outgoing: [],
    results: [],
    quarantine: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, status: ok ? 200 : 400, statusText: ok ? "OK" : "Bad Request", json: () => Promise.resolve(body) } as Response);
}

function notFoundResponse(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: () => Promise.resolve({ detail: "not found" }) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("SubtaskDelegationsPanel", () => {
  it("requires public and delegate confirmations before creating an outbound delegation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/subtask-delegations" && init?.method !== "POST") return jsonResponse(overview());
      if (url === "/api/subtask-delegations" && init?.method === "POST") return jsonResponse({ ok: true, delegation: record({ kind: "outgoing", state: "sent" }), status: overview() });
      return jsonResponse(overview());
    });
    render(<SubtaskDelegationsPanel />);

    expect(await screen.findByText("Subtask Delegations")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Subtask text" }), { target: { value: "Bounded external delegation text" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge public subtask warning" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge delegate task confirmation" }));
    fireEvent.click(screen.getByRole("button", { name: "Review delegation" }));
    expect(screen.getByRole("dialog", { name: "Confirm subtask delegation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and delegate" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/subtask-delegations", expect.objectContaining({ method: "POST" })));
    const call = fetchSpy.mock.calls.find(([input, init]) => String(input) === "/api/subtask-delegations" && init?.method === "POST");
    const body = JSON.parse(String(call?.[1]?.body || "{}"));
    expect(body.sender_agent_id).toBe("technocore-specialist");
    expect(body.recipient_key).toContain(localRecipientDid);
    expect(body.public_confirmation).toBe(true);
    expect(body.delegate_task_confirmation).toBe(true);
    expect(body.delegate_task).toBe(true);
    expect(body.no_payment).toBe(true);
    expect(body.no_settlement).toBe(true);
    expect(body.task_text).toBe("Bounded external delegation text");
    expect(Array.isArray(body.required_capabilities)).toBe(true);
    expect(body.idempotency_key).toMatch(/^subtask-create-/);
  });

  it("dispatches workspace focus on accept and publishes a signed result with explicit confirmation", async () => {
    const incoming = record({ state: "pending", workspace_session_id: null, workspace_task_id: null, task_text: "Accepted external task text" });
    const working = record({ state: "result_ready", workspace_session_id: "session-123", workspace_task_id: "task-123", accepted_at: "2026-09-06T10:05:00.000Z", result_text: "Authoritative result preview" });
    let currentOverview = overview({ incoming: [incoming], results: [], quarantine: [] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/subtask-delegations" && !init?.method) return jsonResponse(currentOverview);
      if (url === "/api/subtask-delegations" && init?.method === "POST") return jsonResponse(currentOverview);
      if (url === "/api/subtask-delegations/subtask-1234567890abcdef/accept") {
        currentOverview = overview({ incoming: [working], results: [], quarantine: [] });
        return jsonResponse({ ok: true, delegation: working, session_id: "session-123", session: { id: "session-123" }, task: { id: "task-123" }, status: currentOverview });
      }
      if (url === "/api/subtask-delegations/subtask-1234567890abcdef/publish-result") {
        currentOverview = overview({ incoming: [record({ state: "result_sent", workspace_session_id: "session-123", workspace_task_id: "task-123", published_at: "2026-09-06T10:10:00.000Z" })], results: [record({ kind: "result", state: "result_sent", workspace_session_id: "session-123", workspace_task_id: "task-123", result_text: "Published signed result" })] });
        return jsonResponse({ ok: true, delegation: record({ kind: "incoming", state: "result_sent", workspace_session_id: "session-123", workspace_task_id: "task-123", published_at: "2026-09-06T10:10:00.000Z" }), task: { id: "task-123" }, result: { id: "result-1", taskId: "task-123", agentId: "technocore-specialist", summary: "Published signed result" }, status: currentOverview });
      }
      return jsonResponse(overview({ incoming: [working], results: [], quarantine: [] }));
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<SubtaskDelegationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("subtask-record-list").textContent).toContain("Accepted external task text");
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept into Workspace" }));
    expect(await screen.findByRole("button", { name: "Confirm and accept" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and accept" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/subtask-delegations/subtask-1234567890abcdef/accept", expect.objectContaining({ method: "POST" })));
    expect(dispatchSpy).toHaveBeenCalled();
    expect(dispatchSpy.mock.calls.some(([event]) => event instanceof CustomEvent && event.type === "osa:claim-job" && (event as CustomEvent).detail?.sessionId === "session-123")).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: "Publish signed result" }));
    expect(await screen.findByRole("button", { name: "Confirm and publish" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and publish" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/subtask-delegations/subtask-1234567890abcdef/publish-result", expect.objectContaining({ method: "POST" })));
    const publishCall = fetchSpy.mock.calls.find(([input, init]) => String(input) === "/api/subtask-delegations/subtask-1234567890abcdef/publish-result" && init?.method === "POST");
    const publishBody = JSON.parse(String(publishCall?.[1]?.body || "{}"));
    expect(publishBody.public_confirmation).toBe(true);
    expect(publishBody.publish_confirmation).toBe(true);
    expect(publishBody.idempotency_key).toBe("publish-subtask-1234567890abcdef");
  });

  it("renders quarantine and provenance labels without exposing secrets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(overview({ quarantine: [record({ kind: "quarantine", state: "quarantined", verified: false, rejection_reason: "signature_unverified", quarantine_reason: "signature_unverified", task_text: "", result_text: "" })] })));
    render(<SubtaskDelegationsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /Quarantine/ }));
    expect(await screen.findByText(/Quarantine: signature_unverified/)).toBeInTheDocument();
    expect(screen.getByText("UNVERIFIED")).toBeInTheDocument();
    expect(screen.getByText("NO AUTHORITY")).toBeInTheDocument();
    expect(screen.getByTestId("subtask-delegations").textContent).not.toMatch(/BEGIN PRIVATE KEY|-----BEGIN|connector token:\s*\S+|seed phrase:\s*\S+|privateKey\s*[:=]|secret\s*[:=]\s*[A-Za-z0-9+/=_-]{16,}/i);
  });

  it("shows a Network setup notice instead of raw 404 text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => notFoundResponse());
    render(<SubtaskDelegationsPanel />);

    expect(await screen.findByText("Delegation backend required")).toBeInTheDocument();
    expect(screen.getByText(/sends bounded public TASK envelopes/i)).toBeInTheDocument();
    expect(screen.getByTestId("subtask-delegations").textContent).not.toMatch(/404|Not Found/i);
  });
});
