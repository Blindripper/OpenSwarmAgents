import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinerPanel, ValidatorPanel } from "./FlopOperatorPanel";

const gpuProbe = { available: true, source: "fixture", error: null, gpus: [{ index: 0, name: "RTX Fixture", memory_total_mb: 24576, driver_version: "999.99" }] };

function minerPayload() {
  return {
    schema: "osa-flop-miner-console/1",
    version: 1,
    generated_at: "2026-09-08T14:30:00.000Z",
    yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["3", "4", "Appendix C"], summary: "Miners run attested inference and earn verified work settlement." },
    mode: "readiness_only",
    overall_status: "blocked",
    readiness_score: 42,
    compute: { gpu_probe: gpuProbe, cpu_threads: 16, memory_total_gb: 64, memory_free_gb: 32, cuda_visible: false },
    lifecycle: [{ id: "onboard", label: "Onboard", state: "manual_required", detail: "Bond stake, calibrate hardware, register model availability." }],
    readiness: [{ id: "gpu", label: "GPU visibility", status: "ready", detail: "1 NVIDIA GPU visible.", evidence: null }, { id: "wallet", label: "Wallet / stake", status: "blocked", detail: "Connect wallet first.", evidence: null }],
    authority: { kind: "readiness_console_only", gpu_leasing: false, miner_registration: false, model_registration: false, session_acceptance: false, connector_spawning: false, payment: false, settlement: false, note: "This dashboard view does not lease GPU capacity." },
  };
}

function validatorPayload() {
  return {
    schema: "osa-flop-validator-console/1",
    version: 1,
    generated_at: "2026-09-08T14:31:00.000Z",
    yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["15"], summary: "Validators author blocks, finalize, attest miner proofs and host DA." },
    mode: "readiness_only",
    overall_status: "blocked",
    readiness_score: 33,
    requirements: { self_stake_floor: "effective_minimum_stake; yellowpaper baseline 305,505 FLOP", min_self_stake_ratio: "20%", committee_gate: "recent verified PoUI work", heavy_duties: ["DA store-and-serve", "committee-keeping GPU work"] },
    compute: { gpu_probe: gpuProbe, cpu_threads: 16, memory_total_gb: 64, memory_free_gb: 32, cuda_visible: false },
    lifecycle: [{ id: "register", label: "Register", state: "manual_required", detail: "Self-sign registration and freeze stake." }],
    readiness: [{ id: "consensus", label: "Consensus client", status: "blocked", detail: "No validator client configured.", evidence: null }],
    authority: { kind: "readiness_console_only", validator_registration: false, stake_bonding: false, block_authoring: false, finality_voting: false, attestation_signing: false, da_publishing: false, payment: false, settlement: false, note: "This dashboard view does not bond stake." },
  };
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("FlopOperatorPanel", () => {
  it("renders Miner readiness without operational side-effect controls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(minerPayload()));
    render(<MinerPanel />);

    expect(await screen.findByText("Miner")).toBeInTheDocument();
    expect(screen.getByText("FLOP compute operator")).toBeInTheDocument();
    expect(screen.getByText(/RTX Fixture/)).toBeInTheDocument();
    expect(screen.getByText("NO GPU LEASING")).toBeInTheDocument();
    expect(screen.getByText("NO MINER REGISTRATION")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start|stake|register|settle|lease/i })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.every(([input]) => String(input).includes("/api/flop/miner"))).toBe(true);
    expect(screen.getByTestId("flop-miner-panel").textContent).not.toMatch(/privateKey|PRIVATE KEY|seed|secret|signature|\/home|\/tmp/i);
  });

  it("renders Validator readiness as manual/on-chain gated", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse(validatorPayload()));
    render(<ValidatorPanel />);

    expect(await screen.findByText("Validator")).toBeInTheDocument();
    expect(screen.getByText("FLOP security operator")).toBeInTheDocument();
    expect(screen.getByText(/305,505 FLOP/)).toBeInTheDocument();
    expect(screen.getByText("NO STAKE BONDING")).toBeInTheDocument();
    expect(screen.getByText("NO ATTESTATION SIGNING")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start|stake|register|attest|author/i })).not.toBeInTheDocument();
  });
});
