import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkOperationsPanel } from "./NetworkOperationsPanel";

function notFoundResponse(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "not found" }) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("NetworkOperationsPanel", () => {
  it("explains unavailable live projections instead of rendering raw 404 errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => notFoundResponse());

    render(<NetworkOperationsPanel events={[]} live={false} loading={false} onRefresh={() => {}} />);

    expect(await screen.findByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Observe")).toBeInTheDocument();
    expect(screen.getByText("Coordinate")).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.getByText("Delegate")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Shared room backend required")).toBeInTheDocument());
    expect(screen.getByText("Delegation backend required")).toBeInTheDocument();
    expect(screen.getByText("Mailbox backend required")).toBeInTheDocument();
    expect(screen.getByTestId("network-operations-panel").textContent).not.toMatch(/404|Not Found/i);
  });
});
