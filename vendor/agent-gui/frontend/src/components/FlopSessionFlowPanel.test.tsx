import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlopSessionFlowPanel } from "./FlopSessionFlowPanel";

describe("FlopSessionFlowPanel", () => {
  it("explains the request-match-prove-settle flow with only safe navigation actions", () => {
    const onDraftRequest = vi.fn();
    const onOpenMiner = vi.fn();
    const onOpenValidator = vi.fn();
    render(<FlopSessionFlowPanel onDraftRequest={onDraftRequest} onOpenMiner={onOpenMiner} onOpenValidator={onOpenValidator} />);

    expect(screen.getByText("Request -> Match -> Prove -> Settle")).toBeInTheDocument();
    expect(screen.getByText("Request")).toBeInTheDocument();
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByText("Prove")).toBeInTheDocument();
    expect(screen.getByText("Settle")).toBeInTheDocument();
    expect(screen.getByText(/model hash, latency target, FLOPs budget, confidentiality level and fee/i)).toBeInTheDocument();
    expect(screen.getByText(/does not post mempool requests/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /post|submit|bid|execute|settle|stake/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Draft request" }));
    fireEvent.click(screen.getByRole("button", { name: "Miner readiness" }));
    fireEvent.click(screen.getByRole("button", { name: "Validator path" }));
    expect(onDraftRequest).toHaveBeenCalledTimes(1);
    expect(onOpenMiner).toHaveBeenCalledTimes(1);
    expect(onOpenValidator).toHaveBeenCalledTimes(1);
  });
});
