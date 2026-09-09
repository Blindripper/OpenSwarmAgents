import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchmakingPanel } from "./MatchmakingPanel";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    provider_id: "local:node-local:coder:did:key:z6MkCoder",
    agent_id: "coder",
    name: "Coder",
    source: "local",
    node_id: "node-local",
    did: "did:key:z6MkCoder",
    score: 98,
    eligible: true,
    matched_skills: ["coding", "testing"],
    missing_skills: [],
    verification: { state: "verified", verified: true, stale: false, label: "LOCAL VERIFIED" },
    reputation: { status: "local_signed_record", evidence_count: 4 },
    authority: { kind: "local_selectable", selectable_for_local_workspace: true, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
    reasons: ["matches coding, testing", "local profile"],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  const candidates = [candidate(), candidate({
    provider_id: "federated:node-remote:remote-coder:did:key:z6MkRemote",
    agent_id: "remote-coder",
    name: "Remote Coder",
    source: "federated",
    node_id: "node-remote",
    did: "did:key:z6MkRemote",
    score: 92,
    reputation: { status: "signed_record", evidence_count: 7 },
    authority: { kind: "recommendation_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false },
  })];
  return {
    schema: "osa-matchmaking/1",
    version: 1,
    generated_at: "2026-09-08T14:00:00.000Z",
    query: { job_id: null, include_claimed: false, include_stale: false, include_untrusted: false },
    policy: { source_of_truth: "osa-skill-registry/1 + canonical job views", matching: "deterministic", signature_meaning: "authorship", authority: "recommendation_only", remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false, settlement: false },
    status: { job_count: 1, matched_count: 1, partial_count: 0, no_match_count: 0, provider_count: 2, available_skill_count: 2, registry_schema: "osa-skill-registry/1" },
    matches: [{
      id: "match-browser-job",
      job: { id: "kibble:42", source: "technocore", room: "kibble", seq: "42", title: "Fix API bug", preview: "JOB v1: Fix API bug and add tests", text_hash: "a".repeat(64), required_skills: ["coding", "testing"], observed_at: "2026-09-08T14:00:00.000Z", claimed: false },
      candidate_count: candidates.length,
      top_score: 98,
      status: "matched",
      candidates,
    }],
    ...overrides,
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

describe("MatchmakingPanel", () => {
  it("renders job-to-agent recommendations without bids or execution controls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(payload()));
    render(<MatchmakingPanel />);

    expect(await screen.findByText("Matchmaking")).toBeInTheDocument();
    expect(screen.getByText("Fix API bug")).toBeInTheDocument();
    expect(screen.getByText("Coder")).toBeInTheDocument();
    expect(screen.getByText("Remote Coder")).toBeInTheDocument();
    expect(screen.getByText("LOCAL SELECTABLE")).toBeInTheDocument();
    expect(screen.getAllByText("RECOMMENDATION ONLY").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NO AUTO-BID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NO EXECUTION").length).toBeGreaterThan(0);
    expect(screen.getByTestId("matchmaking").textContent).not.toMatch(/privateKey|PRIVATE KEY|seed|pkcs8|agent_signature|node_signature|signature:\s*[A-Za-z0-9_-]{32,}|\/home|\/tmp/i);
    expect(fetchSpy.mock.calls.every(([input, init]) => String(input).includes("/api/matchmaking") && !init?.method)).toBe(true);
    expect(screen.queryByRole("button", { name: /bid|start|run|execute/i })).not.toBeInTheDocument();
  });

  it("keeps unsafe providers opt-in for matching inspection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const unsafe = String(input).includes("include_untrusted=1");
      return jsonResponse(unsafe ? payload({ matches: [{ ...payload().matches[0], candidates: [candidate({ name: "Unsafe Claim", eligible: false, verification: { state: "untrusted", verified: false, stale: false, label: "UNTRUSTED" }, authority: { kind: "recommendation_only", selectable_for_local_workspace: false, remote_execution: false, connector_spawning: false, auto_bidding: false, payment: false } })] }] }) : payload({ status: { ...payload().status, provider_count: 1 } }));
    });
    render(<MatchmakingPanel />);

    expect(await screen.findByText("Coder")).toBeInTheDocument();
    expect(screen.queryByText("Unsafe Claim")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include stale and untrusted providers/ }));
    await waitFor(() => expect(screen.getByText("Unsafe Claim")).toBeInTheDocument());
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getAllByText("RECOMMENDATION ONLY").length).toBeGreaterThan(0);
  });

  it("shows the built-in recommendation model instead of raw 404 text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => notFoundResponse());
    render(<MatchmakingPanel />);

    expect(await screen.findByText(/built-in Matchmaking model/i)).toBeInTheDocument();
    expect(screen.getByText("Example: build a wallet-safe FLOP miner dashboard")).toBeInTheDocument();
    expect(screen.getByText("Federated Technocore Specialist")).toBeInTheDocument();
    expect(screen.getByTestId("matchmaking").textContent).not.toMatch(/404|Not Found/i);
  });
});
