import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FederatedWorkbenchOverview, FederatedWorkbenchTask } from "../types";
import { FederatedWorkbenchPanel } from "./FederatedWorkbenchPanel";

function task(overrides: Partial<FederatedWorkbenchTask> = {}): FederatedWorkbenchTask {
  return {
    id: "fwb-node-remote-task-1",
    kind: "task",
    state: "verified",
    importable: true,
    origin_node_id: "node-remote",
    origin_node_did: "did:key:z6MkRemoteNode",
    origin_agent_id: "researcher",
    origin_agent_name: "Researcher",
    origin_agent_did: "did:key:z6MkRemoteAgent",
    task_id: "task-remote-1",
    goal_id: "goal-remote-1",
    goal_title: "Remote goal",
    title: "Remote verified task",
    summary: "Sanitized bounded external task metadata",
    status: "pending",
    task_type: "research",
    required_capabilities: ["research", "synthesis"],
    priority: 5,
    created_at: "2026-09-08T07:00:00.000Z",
    updated_at: "2026-09-08T07:01:00.000Z",
    last_seen_at: "2026-09-08T07:02:00.000Z",
    imported_session_id: null,
    imported_task_id: null,
    trust: { state: "verified", stale: false, verified: true },
    identity_binding: { node_id: "node-remote", node_did: "did:key:z6MkRemoteNode", agent_id: "researcher", agent_did: "did:key:z6MkRemoteAgent", task_id: "task-remote-1", goal_id: "goal-remote-1" },
    provenance: { source: "federation-snapshot", node_id: "node-remote", observed_at: "2026-09-08T07:02:00.000Z", head: "head-remote", source_hash: "abc123" },
    authority: "inspect_only",
    remote_execution: false,
    connector_spawning: false,
    files_shared: false,
    no_payment: true,
    no_settlement: true,
    source_hash: "abc123",
    ...overrides,
  };
}

function overview(overrides: Partial<FederatedWorkbenchOverview> = {}): FederatedWorkbenchOverview {
  return {
    schema: "osa-federated-workbench/1",
    version: 1,
    generated_at: "2026-09-08T07:03:00.000Z",
    policy: {
      visibility: "public-projection",
      authority: "inspect_only",
      signatures_mean: "authorship and integrity only",
      no_automatic_execution: true,
      remote_execution: false,
      connector_spawning: false,
      files_shared: false,
      no_payment: true,
      no_settlement: true,
    },
    status: {
      enabled: true,
      stale_after_ms: 60000,
      task_count: 3,
      verified_count: 1,
      stale_count: 1,
      untrusted_count: 1,
      imported_count: 0,
      quarantine_count: 1,
      last_import_at: null,
      last_error: null,
    },
    tasks: [
      task(),
      task({ id: "fwb-node-remote-task-stale", state: "stale", importable: false, title: "Remote stale task", trust: { state: "stale", stale: true, verified: true, reason: "snapshot_stale" } }),
      task({ id: "fwb-node-remote-task-untrusted", state: "untrusted", importable: false, title: "Remote untrusted task", trust: { state: "untrusted", stale: false, verified: false, reason: "signature_unverified" } }),
    ],
    quarantine: [{ id: "fwb-quarantine-node-remote", kind: "quarantine", state: "quarantined", origin_node_id: "node-remote", origin_node_did: "did:key:z6MkRemoteNode", reason: "stale_snapshot_rejected", first_seen_at: "2026-09-08T07:00:00.000Z", last_seen_at: "2026-09-08T07:02:00.000Z", authority: "none", remote_execution: false, connector_spawning: false, files_shared: false, no_payment: true, no_settlement: true }],
    ...overrides,
  };
}

function response(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: async () => body } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("FederatedWorkbenchPanel", () => {
  it("renders verified, stale, untrusted, and quarantined rows without sensitive payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => response(overview()));
    render(<FederatedWorkbenchPanel />);

    expect(await screen.findByText("Federated Workbench")).toBeInTheDocument();
    expect(screen.getByText("Remote verified task")).toBeInTheDocument();
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Stale/ }));
    expect(screen.getByText("Remote stale task")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Untrusted/ }));
    expect(screen.getByText("Remote untrusted task")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quarantine/ }));
    expect(screen.getByText("stale_snapshot_rejected")).toBeInTheDocument();
    expect(screen.getByTestId("federated-workbench").textContent).not.toMatch(/signature|privateKey|connector token|secret\s*[:=]|\/home\/|C:\\/i);
  });

  it("does not import until confirmation and sends only the explicit idempotent import body", async () => {
    let current = overview();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/federated-workbench/fwb-node-remote-task-1/import" && init?.method === "POST") {
        current = overview({ tasks: [task({ state: "imported", importable: false, imported_session_id: "session-fwb-1", imported_task_id: "task-local-1" })], status: { ...overview().status, task_count: 1, verified_count: 0, imported_count: 1, stale_count: 0, untrusted_count: 0, quarantine_count: 0, last_import_at: "2026-09-08T07:04:00.000Z" }, quarantine: [] });
        return response({ ok: true, idempotent_replay: false, task: { id: "task-local-1" }, session: { id: "session-fwb-1" }, status: current });
      }
      return response(current);
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<FederatedWorkbenchPanel />);

    expect(await screen.findByText("Remote verified task")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(screen.getByRole("dialog", { name: "Confirm federated task import" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/federated-workbench/fwb-node-remote-task-1/import", expect.objectContaining({ method: "POST" })));
    const call = fetchSpy.mock.calls.find(([input, init]) => String(input).endsWith("/import") && init?.method === "POST");
    const body = JSON.parse(String(call?.[1]?.body || "{}"));
    expect(body.confirmation).toBe("import-federated-task");
    expect(body.idempotency_key).toMatch(/^fwb-import-/);
    expect(body).not.toHaveProperty("command");
    expect(body).not.toHaveProperty("files");
    expect(body).not.toHaveProperty("connector");
    expect(body).not.toHaveProperty("payment");
    expect(dispatchSpy.mock.calls.some(([event]) => event instanceof CustomEvent && event.type === "osa:federated-workbench-import" && (event as CustomEvent).detail?.sessionId === "session-fwb-1")).toBe(true);
  });
});
