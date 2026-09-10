const stepTone: Record<string, string> = {
  request: "blue",
  match: "good",
  prove: "warn",
  settle: "bad",
};

const steps = [
  {
    id: "request",
    number: "01",
    title: "Request",
    summary: "Create the session intent: model hash, latency target, FLOPs budget, confidentiality level and fee.",
    state: "SAFE DRAFT",
  },
  {
    id: "match",
    number: "02",
    title: "Match",
    summary: "Rank capable local and federated providers with Skill Registry, trust state and reputation evidence.",
    state: "LIVE RECOMMENDATION",
  },
  {
    id: "prove",
    number: "03",
    title: "Prove",
    summary: "Miner completes inference, keeps receipts and submits proof of useful inference for review.",
    state: "OPERATOR GATED",
  },
  {
    id: "settle",
    number: "04",
    title: "Settle",
    summary: "Validators include the proof hash in a block; rewards wait for audited settlement rails.",
    state: "DISABLED",
  },
];

export function FlopSessionFlowPanel({
  onDraftRequest,
  onOpenMiner,
  onOpenValidator,
}: {
  onDraftRequest?: () => void;
  onOpenMiner?: () => void;
  onOpenValidator?: () => void;
}) {
  return <section className="osa-dashboard-card osa-flow-panel" data-testid="flop-session-flow">
    <div className="osa-flow-header">
      <div>
        <div className="osa-page-eyebrow">FLOP session flow</div>
        <h2>Request {"->"} Match {"->"} Prove {"->"} Settle</h2>
        <p>Use Market to turn an intent into a ranked recommendation. Today the dashboard can draft the request and explain the match; proving and settlement stay explicit operator phases.</p>
      </div>
      <div className="osa-flow-actions">
        {onDraftRequest && <button type="button" className="osa-primary-action" onClick={onDraftRequest}>Draft request</button>}
        {onOpenMiner && <button type="button" className="osa-secondary-action" onClick={onOpenMiner}>Miner readiness</button>}
        {onOpenValidator && <button type="button" className="osa-secondary-action" onClick={onOpenValidator}>Validator path</button>}
      </div>
    </div>
    <div className="osa-flow-steps">
      {steps.map((step) => <article key={step.id} className="osa-flow-step" data-tone={stepTone[step.id]}>
        <div className="osa-flow-step-index">{step.number}</div>
        <div>
          <strong>{step.title}</strong>
          <span>{step.summary}</span>
        </div>
        <em>{step.state}</em>
      </article>)}
    </div>
    <div className="osa-flow-guardrail">
      Current safe action: draft and inspect. This panel does not post mempool requests, open private miner connections, sign proofs, bond stake or settle FLOP.
    </div>
  </section>;
}
