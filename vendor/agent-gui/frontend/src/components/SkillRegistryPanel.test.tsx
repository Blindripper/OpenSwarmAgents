import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRegistryPanel } from "./SkillRegistryPanel";

const counts = {
  accepted_results: 2,
  verified_job_results: 1,
  claimed_deals: 1,
  refunded_deals: 0,
  disputed_deals: 0,
  unique_counterparties: 1,
};

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: "local:node-local:coder:did:key:z6MkCoder",
    source: "local",
    agent_id: "coder",
    name: "Coder",
    tagline: "Builds and verifies code",
    did: "did:key:z6MkCoder",
    node_id: "node-local",
    skills: ["coding", "testing"],
    eligible: true,
    verification: { verified: true, stale: false, state: "verified", label: "LOCAL VERIFIED", note: "Signature verified; not an endorsement." },
    provenance: { kind: "local", kv_path: "/kv/osa-capabilities/coder", payload_hash: "a".repeat(64) },
    reputation: { status: "local_signed_record", label: "LOCAL SIGNED RECORD", verified: true, stale: false, counts, note: "Not an endorsement." },
    authority: { kind: "local_workspace_profile", selectable_for_local_workspace: true, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, note: "Human selectable." },
    ...overrides,
  };
}

function payload(providers = [provider()], excluded = { untrusted: 0, stale: 0 }) {
  return {
    schema: "osa-skill-registry/1",
    version: 1,
    generated_at: "2026-09-08T00:00:00.000Z",
    query: { raw: "", skills: [], source: "all", include_stale: false, include_untrusted: false },
    policy: { source_of_truth: "osa-capability-registry/1", reputation_context: "exact_node_agent_did_join", signature_meaning: "authorship", default_visibility: "fresh_verified_claims_only", authority: "catalog_only", matching_phase: "5.2", remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
    status: { capability_scan: "live", reputation_scan: "live", available_skill_count: 2, skill_count: providers.length ? 1 : 0, provider_count: providers.length, excluded },
    available_skills: ["coding", "testing"],
    providers,
    skills: providers.length ? [{
      id: "skill-coding",
      schema: "osa-skill/1",
      version: 1,
      skill: "coding",
      label: "coding",
      provider_count: providers.length,
      eligible_provider_count: providers.filter((item) => Boolean((item as { eligible?: boolean }).eligible)).length,
      local_provider_count: providers.filter((item) => (item as { source?: string }).source === "local").length,
      federated_provider_count: providers.filter((item) => (item as { source?: string }).source === "federated").length,
      verified_provider_count: providers.filter((item) => Boolean((item as { verification?: { verified?: boolean } }).verification?.verified)).length,
      stale_provider_count: providers.filter((item) => Boolean((item as { verification?: { stale?: boolean } }).verification?.stale)).length,
      untrusted_provider_count: providers.filter((item) => !Boolean((item as { verification?: { verified?: boolean } }).verification?.verified)).length,
      reputation_evidence_count: 4,
      reputation_counts: counts,
      providers,
    }] : [],
  };
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

function notFoundResponse() {
  return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: () => Promise.resolve({ detail: "not found" }) } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillRegistryPanel", () => {
  it("renders machine-readable skill providers without execution or bid actions", async () => {
    const remote = provider({
      id: "federated:node-remote:remote-coder:did:key:z6MkRemote",
      source: "federated",
      agent_id: "remote-coder",
      name: "Remote Coder",
      did: "did:key:z6MkRemote",
      node_id: "node-remote",
      verification: { verified: true, stale: false, state: "verified", label: "SIGNATURE VERIFIED", note: "Signature verified; not an endorsement." },
      provenance: { kind: "technocore", room: "credence", seq: 7, kv_path: "/kv/osa-capabilities/remote-coder", payload_hash: "b".repeat(64) },
      reputation: { status: "signed_record", label: "SIGNED REPUTATION CLAIM", verified: true, stale: false, counts, note: "Not an endorsement." },
      authority: { kind: "catalog_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, note: "Catalog only." },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(payload([provider(), remote])));
    render(<SkillRegistryPanel />);

    expect(await screen.findByText("Skill Registry")).toBeInTheDocument();
    expect(screen.getByText("Coder")).toBeInTheDocument();
    expect(screen.getByText("Remote Coder")).toBeInTheDocument();
    expect(screen.getByText("LOCAL SELECTABLE")).toBeInTheDocument();
    expect(screen.getByText("CATALOG ONLY")).toBeInTheDocument();
    expect(screen.getAllByText("NO AUTO-BID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NO EXECUTION").length).toBeGreaterThan(0);
    expect(screen.getByTestId("skill-registry").textContent).not.toMatch(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}/i);
    expect(screen.queryByRole("button", { name: /bid|start|run|execute/i })).not.toBeInTheDocument();
  });

  it("keeps stale and untrusted claims hidden until explicitly included", async () => {
    const unsafe = provider({
      id: "federated:node-remote:unsafe:did:key:z6MkUnsafe",
      source: "federated",
      agent_id: "unsafe",
      name: "Unsafe Claim",
      did: "did:key:z6MkUnsafe",
      node_id: "node-remote",
      eligible: false,
      verification: { verified: false, stale: false, state: "untrusted", label: "UNTRUSTED", rejection_reason: "agent_signature_invalid", note: "Failed verification." },
      reputation: { status: "none", label: "NO REPUTATION RECORD", verified: false, stale: false, counts: { ...counts, accepted_results: 0, verified_job_results: 0, claimed_deals: 0 }, note: "No reputation." },
      authority: { kind: "catalog_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, note: "Catalog only." },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      return jsonResponse(url.includes("include_untrusted=1") ? payload([unsafe]) : payload([], { untrusted: 1, stale: 0 }));
    });
    render(<SkillRegistryPanel />);

    expect(await screen.findByText("1 hidden stale/untrusted")).toBeInTheDocument();
    expect(screen.queryByText("Unsafe Claim")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include stale and untrusted/ }));
    await waitFor(() => expect(screen.getByText("Unsafe Claim")).toBeInTheDocument());
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getByText("Rejected: agent_signature_invalid")).toBeInTheDocument();
  });

  it("shows the built-in registry model instead of raw 404 text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => notFoundResponse());
    render(<SkillRegistryPanel />);

    expect(await screen.findByText(/built-in Skill Registry model/i)).toBeInTheDocument();
    expect(screen.getAllByText("Technocore Specialist").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Federated Miner Specialist").length).toBeGreaterThan(0);
    expect(screen.getByTestId("skill-registry").textContent).not.toMatch(/404|Not Found/i);
  });
});
