import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultPanel } from "./VaultPanel";

const agents = [
  { agent_id: "technocore-specialist", did: "did:key:z6MkLocalDelegator", capabilities: ["request_work"], published: true },
  { agent_id: "coder", did: "did:key:z6MkLocalDelegatee", capabilities: ["coding"], published: true },
];

function delegationState() {
  const base = {
    schema: "osa-delegation-note/1",
    status: {
      enabled: true,
      room: "osa-network",
      kv_namespace: "osa-delegations",
      allowed_scopes: ["coordination", "work_request"],
      allowed_capabilities: ["request_work", "research"],
      last_scan_status: "archive",
      last_error: "upstream unavailable",
      verified_count: 1,
      rejected_count: 1,
    },
    delegations: [] as unknown[],
    local: [{
      id: "deleg-local-12345678",
      from_agent: "technocore-specialist",
      to_agent: "coder",
      delegator_did: "did:key:z6MkLocalDelegator",
      delegatee_did: "did:key:z6MkLocalDelegatee",
      scopes: ["coordination"],
      capabilities: ["request_work"],
      scope: "coordination",
      policy: "require-human",
      state: "draft",
      revision: 0,
      created_at: "2026-09-05T03:00:00.000Z",
      expires_at: "2026-09-12T03:00:00.000Z",
      revoked_at: null,
      verified: false,
      authority: "local_note_only",
    }],
    discovered: [{
      id: "delegation-remote",
      delegation_id: "deleg-remote-12345678",
      from_agent: "remote-one",
      to_agent: "remote-two",
      delegator_did: "did:key:z6MkRemoteDelegator",
      delegatee_did: "did:key:z6MkRemoteDelegatee",
      scopes: ["work_request"],
      capabilities: ["research"],
      scope: "work_request",
      policy: "require-human",
      state: "active",
      revision: 1,
      created_at: "2026-09-05T03:00:00.000Z",
      expires_at: "2026-09-06T03:00:00.000Z",
      revoked_at: null,
      kv_path: "/kv/osa-delegations/d-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payload_hash: "b".repeat(64),
      verified: true,
      stale: true,
      authority: "informational_only",
      provenance: { room: "osa-network", seq: 42 },
    }, {
      id: "delegation-bad",
      delegation_id: "deleg-bad-12345678",
      from_agent: "bad-one",
      to_agent: "bad-two",
      delegator_did: "did:key:z6MkBadDelegator",
      delegatee_did: "did:key:z6MkBadDelegatee",
      scopes: ["coordination"],
      capabilities: [],
      scope: "coordination",
      policy: "require-human",
      state: "untrusted",
      revision: 1,
      created_at: "2026-09-05T03:00:00.000Z",
      expires_at: "2026-09-06T03:00:00.000Z",
      revoked_at: null,
      kv_path: "/kv/osa-delegations/d-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      verified: false,
      stale: false,
      rejection_reason: "pointer_signer_mismatch",
      authority: "informational_only",
    }],
  };
  base.delegations = base.local;
  return base;
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("VaultPanel delegation notes", () => {
  it("shows human-gated local notes and non-authoritative federated verification states", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/agents/dids") return jsonResponse({ agents });
      if (url === "/api/capability-registry") return jsonResponse({ status: { enabled: false, kv_namespace: "osa-capabilities", scan_rooms: [], local_count: 0, discovered_count: 0, verified_count: 0, rejected_count: 0 }, local: [], discovered: [] });
      if (url.startsWith("/api/signing-policy")) return jsonResponse({ policy: "require-human" });
      return jsonResponse(delegationState());
    });
    render(<VaultPanel />);

    expect(await screen.findByText("🔗 Delegation Notes")).toBeInTheDocument();
    expect(screen.getByText(/Remote notes are informational only and never grant authority or execution rights/)).toBeInTheDocument();
    expect(screen.getByText(/managed delegate signing remains human-required/)).toBeInTheDocument();
    expect(screen.getAllByText("STALE").length).toBeGreaterThan(0);
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getAllByText(/INFORMATIONAL ONLY · grants no authority or execution rights/).length).toBe(2);
    expect(screen.queryByText(/PRIVATE KEY|node_signature/i)).not.toBeInTheDocument();
  });

  it("requires explicit UI confirmation and sends bounded create, publish, and scan actions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/agents/dids") return jsonResponse({ agents });
      if (url === "/api/capability-registry") return jsonResponse({ status: { enabled: false, kv_namespace: "osa-capabilities", scan_rooms: [], local_count: 0, discovered_count: 0, verified_count: 0, rejected_count: 0 }, local: [], discovered: [] });
      if (url.startsWith("/api/signing-policy")) return jsonResponse({ policy: "require-human" });
      if (url === "/api/delegations" && init?.method === "POST") return jsonResponse({ ok: true, delegation: delegationState().local[0], delegation_notes: delegationState() });
      if (url === "/api/delegations") return jsonResponse(delegationState());
      if (url.includes("/publish")) return jsonResponse({ ok: true, delegation_notes: delegationState() });
      if (url === "/api/delegations/scan") return jsonResponse({ ok: true, delegation_notes: delegationState() });
      return jsonResponse({ ok: true, delegation: delegationState().local[0], delegation_notes: delegationState() });
    });
    render(<VaultPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Create local draft" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/delegations", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"confirmation":"create-delegation"'),
    })));

    fireEvent.click(screen.getByRole("button", { name: "Publish note" }));
    expect(screen.getByText(/This publishes a dual-signed public KV note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/delegations/deleg-local-12345678/publish", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirmation: "publish-delegation" }),
    })));

    fireEvent.click(screen.getByRole("button", { name: "Scan notes" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/delegations/scan", expect.objectContaining({ method: "POST" })));
  });
});
