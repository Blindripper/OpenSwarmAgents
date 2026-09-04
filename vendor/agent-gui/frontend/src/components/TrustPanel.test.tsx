import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrustPanel } from "./TrustPanel";

const emptyCounts = {
  accepted_results: 0,
  verified_job_results: 0,
  claimed_deals: 0,
  refunded_deals: 0,
  disputed_deals: 0,
  unique_counterparties: 0,
};

function trustPayload() {
  const baseReview = {
    review_id_hash: "a".repeat(64),
    reviewer_agent_id: "reviewer-agent",
    reviewer_name: "Review Agent",
    reviewer_did: "did:key:z6MkReviewer",
    subject_agent_id: "author-agent",
    subject_did: "did:key:z6MkAuthor",
    subject_result_hash: "b".repeat(64),
    decision: "accepted",
    score_milli: 910,
    kv_path: `/kv/osa-agent-reviews/r-${"a".repeat(40)}`,
    payload_hash: "c".repeat(64),
  };
  return {
    summary: { total_jobs: 0, total_results: 1, verified_results: 1, accepted_results: 1, verified_job_results: 0, unique_counterparties: 0, total_deals: 0, completed_deals: 0, claimed_deals: 0, refunded_deals: 0, disputed_deals: 0, completion_rate: "0%" },
    top_builders: [],
    reputation: { status: { enabled: false, kv_namespace: "osa-reputation", verified_count: 0, rejected_count: 0 }, local: [], discovered: [] },
    review_bridge: {
      status: { enabled: true, room: "credence", kv_namespace: "osa-agent-reviews", eligible_count: 1, local_count: 0, verified_count: 1, rejected_count: 1, last_scan_status: "archive", last_error: "upstream unavailable" },
      eligible: [{ ...baseReview, review_id: "review-local-1", publish_status: "unpublished", review_created_at: "2026-09-04T20:00:00.000Z" }],
      local: [],
      discovered: [
        { ...baseReview, source: "technocore", verified: true, stale: true, provenance: { room: "credence", seq: 42, credence_frame: "VOUCH v1" } },
        { ...baseReview, review_id_hash: "d".repeat(64), payload_hash: "e".repeat(64), source: "technocore", verified: false, stale: false, rejection_reason: "reviewer_signature_invalid", provenance: { room: "credence", seq: 43, credence_frame: "VOUCH v1" } },
      ],
    },
  };
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("TrustPanel Agent Review Bridge", () => {
  it("shows explicit publication, provenance states, privacy, and non-endorsement semantics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(trustPayload()));
    render(<TrustPanel />);

    expect(await screen.findByText("Agent Review Bridge")).toBeInTheDocument();
    expect(screen.getByText(/Signatures prove authorship and integrity—not endorsement/)).toBeInTheDocument();
    expect(screen.getByText(/Private review reasons never leave this node/)).toBeInTheDocument();
    expect(screen.getByText(/no generic Credence schema compatibility is claimed/)).toBeInTheDocument();
    expect(screen.getByText("STALE")).toBeInTheDocument();
    expect(screen.getByText("UNTRUSTED")).toBeInTheDocument();
    expect(screen.getByText(/Scanner using stale cached projection/)).toBeInTheDocument();
    expect(screen.queryByText(/internal review text/i)).not.toBeInTheDocument();
  });

  it("publishes only the selected eligible local review and exposes scan control", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/review-bridge/publish") return jsonResponse({ ok: true, review_bridge: trustPayload().review_bridge });
      if (url === "/api/review-bridge/scan") return jsonResponse({ ok: true, review_bridge: trustPayload().review_bridge });
      return jsonResponse(trustPayload());
    });
    render(<TrustPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Publish review" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/review-bridge/publish", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ review_id: "review-local-1" }),
    })));

    fireEvent.click(screen.getByRole("button", { name: "Scan #credence" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/review-bridge/scan", expect.objectContaining({ method: "POST" })));
  });
});
