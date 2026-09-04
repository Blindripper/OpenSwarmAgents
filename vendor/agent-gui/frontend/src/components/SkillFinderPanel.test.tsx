import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillFinderPanel } from "./SkillFinderPanel";

const counts = {
  accepted_results: 2,
  verified_job_results: 1,
  claimed_deals: 1,
  refunded_deals: 0,
  disputed_deals: 0,
  unique_counterparties: 1,
};

function payload(matches: unknown[] = [], excluded = { untrusted: 0, stale: 0 }) {
  return {
    query: { raw: "coding", skills: ["coding"], source: "all" },
    status: { capability_scan: "live", reputation_scan: "live", matched_count: matches.length, returned_count: matches.length, excluded },
    available_skills: ["coding", "testing"],
    matches,
  };
}

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: "local:node:coder:did",
    source: "local",
    agent_id: "coder",
    name: "Coder",
    tagline: "Builds and verifies code",
    did: "did:key:z6MkCoder",
    node_id: "node-local",
    capabilities: ["coding", "testing"],
    matched_skills: ["coding"],
    eligible: true,
    eligibility: "local_verified",
    verification: { verified: true, stale: false, label: "LOCAL VERIFIED", note: "Signature verified; not an endorsement." },
    provenance: { kind: "local", kv_path: "/kv/osa-capabilities/coder", payload_hash: "a".repeat(64) },
    reputation: { status: "local_signed_record", label: "LOCAL SIGNED RECORD", verified: true, stale: false, counts, note: "Not an endorsement.", evidence_hash: "b".repeat(64), kv_path: "/kv/osa-reputation/coder" },
    action: { kind: "local_workspace", enabled: true, label: "Use in Workspace" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillFinderPanel", () => {
  it("shows local and federated provenance, honest reputation labels, and selects only the local profile", async () => {
    const remote = match({
      id: "federated:node:remote:did",
      source: "federated",
      agent_id: "remote-coder",
      name: "Remote Coder",
      did: "did:key:z6MkRemote",
      node_id: "node-remote",
      verification: { verified: true, stale: false, label: "SIGNATURE VERIFIED", note: "Signature verified; not an endorsement." },
      provenance: { kind: "technocore", room: "osa-network", seq: 42, kv_path: "/kv/osa-capabilities/remote-coder", payload_hash: "c".repeat(64) },
      reputation: { status: "signed_record", label: "SIGNED REPUTATION CLAIM", verified: true, stale: false, counts, note: "Not an endorsement.", evidence_hash: "d".repeat(64), kv_path: "/kv/osa-reputation/remote-coder" },
      action: { kind: "discovery_only", enabled: false, label: "Discovery only" },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      return jsonResponse(url.includes("skill=coding") ? payload([match(), remote]) : payload());
    });
    const onUseLocalAgent = vi.fn();
    render(<SkillFinderPanel onUseLocalAgent={onUseLocalAgent} />);

    await screen.findByRole("button", { name: "Find Agents" });
    fireEvent.change(screen.getByLabelText("Skill search"), { target: { value: "coding" } });
    fireEvent.click(screen.getByRole("button", { name: "Find Agents" }));

    expect(await screen.findByText("Remote Coder")).toBeInTheDocument();
    expect(screen.getByText("LOCAL VERIFIED")).toBeInTheDocument();
    expect(screen.getByText("SIGNATURE VERIFIED")).toBeInTheDocument();
    expect(screen.getByText("SIGNED REPUTATION CLAIM")).toBeInTheDocument();
    expect(screen.getByText(/Discovery only — no remote execution/)).toBeInTheDocument();
    expect(screen.getAllByText(/not an endorsement/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Use Coder in Workspace" }));
    expect(onUseLocalAgent).toHaveBeenCalledWith("coder");
    expect(screen.queryByRole("button", { name: "Use Remote Coder in Workspace" })).not.toBeInTheDocument();
  });

  it("hides invalid matches by default and clearly labels them when explicitly included", async () => {
    const unsafe = match({
      id: "federated:node:unsafe:did",
      source: "federated",
      agent_id: "unsafe",
      name: "Unsafe Claim",
      eligible: false,
      eligibility: "untrusted",
      verification: { verified: false, stale: false, label: "UNTRUSTED", rejection_reason: "agent_signature_invalid", note: "Failed verification." },
      reputation: { status: "none", label: "NO REPUTATION RECORD", verified: false, stale: false, counts: { ...counts, accepted_results: 0, verified_job_results: 0, claimed_deals: 0 }, note: "No exact identity record." },
      action: { kind: "discovery_only", enabled: false, label: "Discovery only" },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (!url.includes("skill=coding")) return jsonResponse(payload());
      return jsonResponse(url.includes("include_untrusted=1") ? payload([unsafe]) : payload([], { untrusted: 1, stale: 0 }));
    });
    render(<SkillFinderPanel onUseLocalAgent={() => {}} />);

    await screen.findByRole("button", { name: "Find Agents" });
    fireEvent.change(screen.getByLabelText("Skill search"), { target: { value: "coding" } });
    fireEvent.click(screen.getByRole("button", { name: "Find Agents" }));
    expect(await screen.findByText(/1 stale or untrusted matching claim was hidden/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Show stale and untrusted/ }));
    expect(await screen.findByText("Unsafe Claim")).toBeInTheDocument();
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getByText(/Not selectable/)).toBeInTheDocument();
  });

  it("renders an actionable error state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).includes("skill=coding")) return jsonResponse({ detail: "Registry unavailable" }, false);
      return jsonResponse(payload());
    });
    render(<SkillFinderPanel onUseLocalAgent={() => {}} />);
    await screen.findByRole("button", { name: "Find Agents" });
    fireEvent.change(screen.getByLabelText("Skill search"), { target: { value: "coding" } });
    fireEvent.click(screen.getByRole("button", { name: "Find Agents" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Registry unavailable"));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
