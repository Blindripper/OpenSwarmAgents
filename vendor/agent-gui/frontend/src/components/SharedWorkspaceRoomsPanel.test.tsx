import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedWorkspaceOverview, SharedWorkspaceRoom } from "../types";
import { SharedWorkspaceRoomsPanel } from "./SharedWorkspaceRoomsPanel";

const localDid = "did:key:z6MkvG23xuQfyW4dAkZe93XPPNPF7ijSNhFCBxnwtWYAv47F";
function room(overrides: Partial<SharedWorkspaceRoom> = {}): SharedWorkspaceRoom { return { id: "123e4567-e89b-42d3-a456-426614174000", workspace_id: "123e4567-e89b-42d3-a456-426614174000", room: "p-osa-ws-123e4567-e89b-42d3-a456-426614174000", session_id: "home-task-1", title: "Release Room", owner_node_id: "node-local", owner_node_did: localDid, members: [{ source: "local", agent_id: "coder", name: "Coder", did: localDid, node_id: "node-local" }], created_at: "2026-09-08T07:00:00.000Z", updated_at: "2026-09-08T07:00:00.000Z", expires_at: "2026-09-15T07:00:00.000Z", publish_status: "sent", events: [{ event_id: "a".repeat(64), type: "OPEN", sender_did: localDid, created_at: "2026-09-08T07:00:00.000Z", verified: true, state: "accepted" }], event_count: 1, quarantine_count: 0, ...overrides }; }
function overview(overrides: Partial<SharedWorkspaceOverview> = {}): SharedWorkspaceOverview { return { schema: "osa-shared-workspace/1", generated_at: "2026-09-08T07:00:00.000Z", policy: { visibility: "private-name-unlisted", warning: "Unlisted, not confidential", authority: "none", signatures_mean: "authorship and integrity only", remote_execution: false, files_shared: false, no_payment: true, no_settlement: true }, limits: { maxWireBytes: 4096, maxTextBytes: 1200, maxTitleBytes: 120, maxMembers: 16, maxEvents: 500 }, status: { enabled: true, room_count: 0, event_count: 0, quarantine_count: 0, last_scan_status: "idle" }, workspaces: [{ id: "home-task-1", title: "Release Room", agent_id: "coder", team_id: "home-room", team_name: "Home", status: "done" }], candidates: [{ key: `local:node-local:coder:${localDid}`, source: "local", agent_id: "coder", name: "Coder", did: localDid, node_id: "node-local", verified: true, stale: false }], rooms: [], ...overrides }; }
function response(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response); }
afterEach(() => vi.restoreAllMocks());

describe("SharedWorkspaceRoomsPanel", () => {
  it("requires disclosure plus a second confirmation before opening a bounded room", async () => {
    let current = overview();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/shared-workspaces" && init?.method === "POST") { const next = room(); current = overview({ rooms: [next], status: { ...current.status, room_count: 1, event_count: 1 } }); return response({ ok: true, idempotent_replay: false, room: next, status: current }); }
      return response(current);
    });
    render(<SharedWorkspaceRoomsPanel />);
    expect(await screen.findByText("Shared Workspace Rooms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge shared room disclosure" }));
    fireEvent.click(screen.getByRole("button", { name: "Review team room" }));
    expect(screen.getByRole("dialog", { name: "Confirm shared Workspace room" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and open" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/shared-workspaces", expect.objectContaining({ method: "POST" })));
    const call = fetchSpy.mock.calls.find(([input, init]) => String(input) === "/api/shared-workspaces" && init?.method === "POST");
    const body = JSON.parse(String(call?.[1]?.body || "{}"));
    expect(body.session_id).toBe("home-task-1"); expect(body.member_keys).toHaveLength(1); expect(body.private_room_warning_acknowledged).toBe(true); expect(body.share_confirmation).toBe(true);
    expect(body).not.toHaveProperty("files"); expect(body).not.toHaveProperty("command");
  });

  it("shows verified/quarantined provenance and double-confirms signed notes", async () => {
    const active = room({ events: [room().events[0], { event_id: "b".repeat(64), type: "NOTE", sender_did: localDid, text: "Verified bounded note", created_at: "2026-09-08T07:01:00.000Z", verified: true, state: "accepted" }, { event_id: "c".repeat(64), type: "NOTE", sender_did: "did:key:z6MkOutsider1111111111111111", created_at: "2026-09-08T07:02:00.000Z", verified: false, state: "quarantined", rejection: "workspace_member_binding_mismatch" }], event_count: 2, quarantine_count: 1 });
    const current = overview({ rooms: [active], status: { ...overview().status, room_count: 1, event_count: 2, quarantine_count: 1 } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input).endsWith("/notes") && init?.method === "POST" ? response({ ok: true, idempotent_replay: false, room: active, event: active.events[1] }) : response(current));
    render(<SharedWorkspaceRoomsPanel />);
    expect(await screen.findByText("Verified bounded note")).toBeInTheDocument();
    expect(screen.getByText("workspace_member_binding_mismatch")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Room note signer" }), { target: { value: "coder" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Shared room note" }), { target: { value: "New bounded note" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge shared note disclosure" }));
    fireEvent.click(screen.getByRole("button", { name: "Review signed note" }));
    expect(screen.getByRole("dialog", { name: "Confirm shared room note" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and publish" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, init]) => String(input).endsWith("/notes") && init?.method === "POST")).toBe(true));
    const noteCall = fetchSpy.mock.calls.find(([input, init]) => String(input).endsWith("/notes") && init?.method === "POST");
    const body = JSON.parse(String(noteCall?.[1]?.body || "{}"));
    expect(body.text).toBe("New bounded note"); expect(body.publish_confirmation).toBe(true); expect(body.private_room_warning_acknowledged).toBe(true);
  });
});
