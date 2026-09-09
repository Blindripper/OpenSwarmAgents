import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { FlopMinerOverview, FlopOperatorCheck, FlopOperatorIntegrationStep, FlopOperatorLifecycleStep, FlopOperatorSourceRef, FlopValidatorOverview } from "../types";

type Kind = "miner" | "validator";
type Overview = FlopMinerOverview | FlopValidatorOverview;

const buttonStyle = { height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: "pointer" } as const;

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "FLOP operator status unavailable");
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
      {error && <div role="alert" className="osa-dashboard-card" style={{ padding: 12, color: "#fca5a5", borderColor: "#7f1d1d", background: "#2a1015" }}>{error}</div>}
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
