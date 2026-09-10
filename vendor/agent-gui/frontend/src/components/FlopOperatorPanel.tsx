import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { DashboardNotice } from "./DashboardNotice";
import type { FlopMinerOverview, FlopOperatorCheck, FlopOperatorIntegrationStep, FlopOperatorLifecycleStep, FlopOperatorSourceRef, FlopValidatorOverview } from "../types";

type Kind = "miner" | "validator";
type Overview = FlopMinerOverview | FlopValidatorOverview;

const buttonStyle = { height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: "pointer" } as const;

const fallbackGpuProbe = { available: false, source: "browser fallback", error: "Live OSA backend is not connected to this page.", gpus: [] };

function baseFallback(kind: Kind) {
  const generated = new Date().toISOString();
  const common = {
    version: 1,
    generated_at: generated,
    mode: "offline_explainer",
    overall_status: "manual_required",
    readiness_score: 18,
    compute: { gpu_probe: fallbackGpuProbe, cpu_threads: 0, memory_total_gb: 0, memory_free_gb: 0, cuda_visible: false },
    sources: [
      { label: "FLOP yellowpaper", url: "https://flop.finance/intro/yellowpaper/", note: "PoUI, miner settlement, validator committees, DA and slashing model." },
      { label: "Technocore DID Starter", url: "https://github.com/zunmax/technocore-did-starter#-share-the-contribution-", note: "DID-backed contribution proof pattern for public operator reputation." },
      { label: "technocore-chat", url: "https://github.com/flop-labs/technocore-chat", note: "Signed rooms and KV records for bounded public operator descriptors." },
    ],
    authority: kind === "miner"
      ? { kind: "offline_readiness_console_only", gpu_leasing: false, miner_registration: false, model_registration: false, session_acceptance: false, connector_spawning: false, payment: false, settlement: false, note: "Offline mode explains the integration path only; it cannot inspect hardware or register a FLOP miner." }
      : { kind: "offline_readiness_console_only", validator_registration: false, stake_bonding: false, block_authoring: false, finality_voting: false, attestation_signing: false, da_publishing: false, payment: false, settlement: false, note: "Offline mode explains the integration path only; it cannot bond stake, join committees or sign validator attestations." },
  };
  if (kind === "miner") {
    return {
      ...common,
      schema: "osa-flop-miner-console/1",
      yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["3", "4", "6.1", "7", "8", "12", "Appendix C"], summary: "Miner mode turns local GPU capacity into attested inference work: publish identity, calibrate hardware, serve signed sessions, then settle only after receipts and validator proofs." },
      economics: { base_self_stake: "10,000 FLOP plus a capacity exposure bond", reward_share: "G_n work rewards plus session settlement after verified receipts", soft_tier: "standard GPU benchmark path", hard_tier: "confidential-compute path with measured model roots" },
      lifecycle: [
        { id: "identity", label: "Identity", state: "manual_required", detail: "Bind this node to a durable did:key before advertising capacity." },
        { id: "calibrate", label: "Calibration", state: "manual_required", detail: "Measure GPU throughput, model roots and TOPLOC/PoUI evidence." },
        { id: "serve", label: "Serve", state: "not_started", detail: "Accept sessions only after the runtime can meter work and retain signed receipts." },
        { id: "settle", label: "Settle", state: "not_available", detail: "FLOP settlement needs validator attestation quorum and replay protection." },
      ],
      integration_path: [
        { id: "did", label: "Create operator DID", state: "manual_required", detail: "Use the Technocore DID pattern to bind the local node to signed contribution records.", source: "https://github.com/zunmax/technocore-did-starter#-share-the-contribution-" },
        { id: "record", label: "Publish signed availability", state: "planned", detail: "Write bounded miner descriptors to Technocore rooms/KV once official fields are finalized.", source: "https://github.com/flop-labs/technocore-chat" },
        { id: "gpu", label: "Calibrate GPU", state: "manual_required", detail: "Benchmark model throughput, roots and capacity before any public miner claim.", source: "https://flop.finance/intro/yellowpaper/" },
        { id: "settlement", label: "Wire PoUI settlement", state: "not_available", detail: "Require co-signed transcript roots, receipts, validator quorum and replay guards before payouts.", source: "https://flop.finance/intro/yellowpaper/" },
      ],
      readiness: [
        { id: "api", label: "Live OSA backend", status: "blocked", detail: "This page cannot reach the miner status endpoint, so hardware and wallet state are not live.", evidence: null },
        { id: "identity", label: "DID contribution trail", status: "manual", detail: "Operator identity and signed public contribution history are required before advertisement.", evidence: null },
        { id: "safety", label: "Execution boundary", status: "ready", detail: "Dashboard remains read-only and does not lease GPU capacity or move FLOP.", evidence: null },
      ],
    } as FlopMinerOverview;
  }
  return {
    ...common,
    schema: "osa-flop-validator-console/1",
    yellowpaper: { url: "https://flop.finance/intro/yellowpaper/", sections: ["2", "3.6", "5.3", "13.2", "15"], summary: "Validator mode is the security role: stake, DA service, committee rotation, block/finality participation and attestation quorum for miner proofs." },
    requirements: { self_stake_floor: "effective_minimum_stake; yellowpaper baseline 305,505 FLOP", min_self_stake_ratio: "20% self-stake ratio", committee_gate: "active validator plus recent verified PoUI work", heavy_duties: ["DA store-and-serve", "committee liveness", "attestation review"] },
    economics: { validator_set: "rotating active validator set", reward_share: "validator reward slice after finalized runtime rules", governance: "active validators gate protocol changes", slash_risk: "dishonest blocks, DA failure and invalid attestations are slashable" },
    lifecycle: [
      { id: "identity", label: "Identity", state: "manual_required", detail: "Bind operator DID and contribution history before any registration flow." },
      { id: "stake", label: "Stake", state: "manual_required", detail: "Bond self-stake through an explicit wallet/runtime flow, never from this offline dashboard." },
      { id: "da", label: "DA", state: "blocked", detail: "Provision store-and-serve data availability before validator claims." },
      { id: "attest", label: "Attest", state: "not_available", detail: "Attestation signing waits for official quorum, replay and slashing protections." },
    ],
    integration_path: [
      { id: "did", label: "Bind validator DID", state: "manual_required", detail: "Use signed DID records to identify the operator and preserve contribution evidence.", source: "https://github.com/zunmax/technocore-did-starter#-share-the-contribution-" },
      { id: "queue", label: "Stake into validator queue", state: "manual_required", detail: "Query live chain parameters and bond stake only via explicit wallet confirmation.", source: "https://flop.finance/intro/yellowpaper/" },
      { id: "da", label: "Serve data availability", state: "blocked", detail: "Host and prove model-weight DA before active-set availability claims.", source: "https://flop.finance/intro/yellowpaper/" },
      { id: "attest", label: "Join attestation quorum", state: "not_available", detail: "Only official runtime rules can enable attestation signing and slashing-aware voting.", source: "https://flop.finance/intro/yellowpaper/" },
    ],
    readiness: [
      { id: "api", label: "Live OSA backend", status: "blocked", detail: "This page cannot reach the validator status endpoint, so chain and node state are not live.", evidence: null },
      { id: "stake", label: "Stake and queue", status: "manual", detail: "Validator onboarding requires explicit wallet/runtime confirmation and cannot be inferred from a static page.", evidence: null },
      { id: "safety", label: "Execution boundary", status: "ready", detail: "Dashboard does not bond stake, author blocks or sign attestations.", evidence: null },
    ],
  } as FlopValidatorOverview;
}

function tone(status: string): "good" | "warn" | "bad" | "blue" | undefined {
  if (status === "ready") return "good";
  if (status === "manual" || status === "manual_required" || status === "warning") return "warn";
  if (status === "blocked" || status === "not_available") return "bad";
  return "blue";
}

function CheckRow({ check }: { check: FlopOperatorCheck }) {
  return <div style={{ display: "grid", gap: 6, padding: 12, border: "1px solid #1e2a45", borderRadius: 8, background: "#0b1220" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <strong style={{ color: "#e2e8f0", fontSize: 13 }}>{check.label}</strong>
      <span className="osa-pill" data-tone={tone(check.status)}>{check.status.replace(/_/g, " ").toUpperCase()}</span>
    </div>
    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>{check.detail}</div>
    {check.evidence && <div style={{ color: "#64748b", fontSize: 11, overflowWrap: "anywhere" }}>{check.evidence}</div>}
  </div>;
}

function LifecycleRow({ step, index }: { step: FlopOperatorLifecycleStep; index: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", gap: 10, alignItems: "start", padding: 11, border: "1px solid #1e2a45", borderRadius: 8, background: "rgba(15,23,42,.68)" }}>
    <div style={{ width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center", border: "1px solid #2a3558", background: "#111827", color: "#93c5fd", fontWeight: 950, fontSize: 12 }}>{index + 1}</div>
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ color: "#cbd5e1", fontSize: 13 }}>{step.label}</strong>
        <span className="osa-pill" data-tone={tone(step.state)}>{step.state.replace(/_/g, " ").toUpperCase()}</span>
      </div>
      <div style={{ marginTop: 5, color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>{step.detail}</div>
    </div>
  </div>;
}

function IntegrationRow({ step, index }: { step: FlopOperatorIntegrationStep; index: number }) {
  return <div className="osa-operator-step">
    <div className="osa-operator-step-index">{String(index + 1).padStart(2, "0")}</div>
    <div style={{ minWidth: 0 }}>
      <div className="osa-operator-step-head">
        <strong>{step.label}</strong>
        <span className="osa-pill" data-tone={tone(step.state)}>{step.state.replace(/_/g, " ").toUpperCase()}</span>
      </div>
      <div className="osa-operator-step-copy">{step.detail}</div>
      <a className="osa-operator-source-link" href={step.source} target="_blank" rel="noreferrer">Source reference</a>
    </div>
  </div>;
}

function SourceBlock({ sources = [] }: { sources?: FlopOperatorSourceRef[] }) {
  return <section className="osa-dashboard-card osa-operator-card" style={{ display: "grid", gap: 10 }}>
    <div className="osa-operator-section-title">Source Evidence</div>
    <div className="osa-source-grid">
      {sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="osa-source-card">
        <strong>{source.label}</strong>
        <span>{source.note}</span>
      </a>)}
    </div>
  </section>;
}

function EconomicsBlock({ view }: { view: Overview }) {
  const entries = Object.entries(view.economics || {}).filter(([, value]) => Boolean(value));
  if (!entries.length) return null;
  return <section className="osa-dashboard-card osa-operator-card" style={{ display: "grid", gap: 10 }}>
    <div className="osa-operator-section-title">Network Economics</div>
    <div className="osa-economics-grid">
      {entries.map(([key, value]) => <div key={key} className="osa-economics-item">
        <div>{key.replace(/_/g, " ").toUpperCase()}</div>
        <strong>{value}</strong>
      </div>)}
    </div>
  </section>;
}

function IntegrationBlock({ view }: { view: Overview }) {
  const steps = view.integration_path || [];
  if (!steps.length) return null;
  return <section className="osa-dashboard-card osa-operator-card" style={{ display: "grid", gap: 12 }}>
    <div>
      <div className="osa-operator-section-title">Integration Path</div>
      <div className="osa-operator-muted">Mapped from FLOP miner/validator docs, Technocore DID Starter and technocore-chat signed rooms/KV.</div>
    </div>
    <div className="osa-operator-timeline">{steps.map((step, index) => <IntegrationRow key={step.id} step={step} index={index} />)}</div>
  </section>;
}

function GpuBlock({ view }: { view: Overview }) {
  const gpuProbe = view.compute.gpu_probe;
  return <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Local Compute</div>
        <div style={{ marginTop: 3, color: "#94a3b8", fontSize: 12 }}>{gpuProbe.source}</div>
      </div>
      <span className="osa-pill" data-tone={gpuProbe.available ? "good" : "warn"}>{gpuProbe.available ? "GPU VISIBLE" : "NO GPU"}</span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
      <div><div style={{ color: "#93c5fd", fontSize: 20, fontWeight: 950 }}>{view.compute.cpu_threads}</div><div style={{ color: "#94a3b8", fontSize: 11 }}>CPU threads</div></div>
      <div><div style={{ color: "#7ee0c2", fontSize: 20, fontWeight: 950 }}>{view.compute.memory_total_gb}</div><div style={{ color: "#94a3b8", fontSize: 11 }}>GB RAM</div></div>
      <div><div style={{ color: view.compute.cuda_visible ? "#7ee0c2" : "#fde68a", fontSize: 20, fontWeight: 950 }}>{view.compute.cuda_visible ? "set" : "auto"}</div><div style={{ color: "#94a3b8", fontSize: 11 }}>CUDA env</div></div>
    </div>
    {gpuProbe.gpus.length ? <div style={{ display: "grid", gap: 7 }}>
      {gpuProbe.gpus.map((gpu) => <div key={`${gpu.index}-${gpu.name}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 7, border: "1px solid #1e2a45", background: "#09111e", fontSize: 12 }}>
        <span style={{ color: "#cbd5e1", fontWeight: 850 }}>{gpu.index}: {gpu.name}</span>
        <span style={{ color: "#94a3b8" }}>{gpu.memory_total_mb || "?"} MB</span>
      </div>)}
    </div> : <div style={{ color: "#facc15", fontSize: 12, lineHeight: 1.45 }}>{gpuProbe.error || "No GPU device reported."}</div>}
  </section>;
}

function RequirementsBlock({ view }: { view: Overview }) {
  const validator = "requirements" in view ? view.requirements : null;
  return <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
    <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Protocol Boundary</div>
    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>{view.authority.note}</div>
    {validator ? <div style={{ display: "grid", gap: 7, color: "#cbd5e1", fontSize: 12 }}>
      <div><b>Stake:</b> {validator.self_stake_floor}</div>
      <div><b>Self ratio:</b> {validator.min_self_stake_ratio}</div>
      <div><b>Committee:</b> {validator.committee_gate}</div>
      <div><b>Heavy duties:</b> {validator.heavy_duties.join(", ")}</div>
    </div> : <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      <span className="osa-pill" data-tone="blue">TOPLOC REQUIRED</span>
      <span className="osa-pill" data-tone="blue">G_N METERING</span>
      <span className="osa-pill" data-tone="warn">ON-CHAIN MANUAL</span>
    </div>}
  </section>;
}

function OperatorPage({ kind }: { kind: Kind }) {
  const [view, setView] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(kind === "miner" ? await api.flop.miner() : await api.flop.validator());
    } catch {
      setView(baseFallback(kind));
      setError("Preview mode: live operator telemetry is not connected on this page. The built-in FLOP and Technocore plan shows the manual path without registering hardware, stake or settlement.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const title = kind === "miner" ? "Miner" : "Validator";
  const eyebrow = kind === "miner" ? "FLOP compute operator" : "FLOP security operator";
  const matches = useMemo(() => view?.readiness || [], [view]);

  return <div className="osa-dashboard-page" data-testid={`flop-${kind}-panel`}>
    <div className="osa-dashboard-inner">
      <header className="osa-page-hero osa-operator-hero" data-kind={kind}>
        <div>
          <div className="osa-page-eyebrow">{eyebrow}</div>
          <div className="osa-page-title">{title}</div>
          <div className="osa-page-copy">{view?.yellowpaper.summary || "Loading FLOP operator model..."}</div>
        </div>
        <div className="osa-operator-hero-status">
          {view && <span className="osa-pill" data-tone={tone(view.overall_status)}>{view.overall_status.replace(/_/g, " ").toUpperCase()}</span>}
          {view && <span className="osa-pill" data-tone="blue">{view.readiness_score}% READY</span>}
          <button type="button" onClick={() => void load()} disabled={loading} style={buttonStyle}>{loading ? "Refreshing" : "Refresh"}</button>
        </div>
      </header>
      {error && <DashboardNotice eyebrow="Preview mode" title={`${title} operator guide`}>
        <span>{error}</span>
        <div className="osa-notice-actions"><span>Use this page to understand readiness. Connect the live OSA backend before checking hardware, signing operator records or joining protocol flows.</span></div>
      </DashboardNotice>}
      {view && <>
        <div className="osa-stat-strip">
          <div className="osa-dashboard-card osa-stat-card"><div>{view.readiness.filter((item) => item.status === "ready").length}</div><span>Ready checks</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>{view.readiness.filter((item) => ["manual", "warning"].includes(item.status)).length}</div><span>Manual checks</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>{view.readiness.filter((item) => item.status === "blocked").length}</div><span>Blocked checks</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>{view.yellowpaper.sections.length}</div><span>Spec sections</span></div>
        </div>
        <IntegrationBlock view={view} />
        <div className="osa-dashboard-grid-2">
          <div style={{ display: "grid", gap: 14 }}>
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Readiness</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 9 }}>{matches.map((item) => <CheckRow key={item.id} check={item} />)}</div>
            </section>
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Lifecycle</div>
              <div style={{ display: "grid", gap: 8 }}>{view.lifecycle.map((step, index) => <LifecycleRow key={step.id} step={step} index={index} />)}</div>
            </section>
          </div>
          <aside style={{ display: "grid", gap: 14 }}>
            <GpuBlock view={view} />
            <RequirementsBlock view={view} />
            <EconomicsBlock view={view} />
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Authority Flags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {Object.entries(view.authority).filter(([key, value]) => typeof value === "boolean" && value === false && key !== "kind").map(([key]) => <span key={key} className="osa-pill" data-tone="bad">NO {key.replace(/_/g, " ").toUpperCase()}</span>)}
              </div>
            </section>
            <SourceBlock sources={view.sources} />
          </aside>
        </div>
      </>}
    </div>
  </div>;
}

export function MinerPanel() {
  return <OperatorPage kind="miner" />;
}

export function ValidatorPanel() {
  return <OperatorPage kind="validator" />;
}
