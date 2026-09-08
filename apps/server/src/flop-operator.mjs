import { spawnSync } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";

const STATUS_ORDER = Object.freeze({ ready: 4, warning: 3, manual: 2, blocked: 1, planned: 0 });

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, max = 160) {
  return String(value || "")
    .replace(/\b[A-Za-z]:\\[^\s]+|\/(?:home|tmp|var|etc|usr|root)\/[^\s]+/gi, "[redacted-path]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-key]")
    .replace(/\b(?:private[_-]?key|seed|secret|token|signature)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function boolEnv(name) {
  const value = process.env[name];
  return value === "1" || /^true$/i.test(String(value || ""));
}

function configuredEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

export function probeNvidiaGpus() {
  const result = spawnSync("nvidia-smi", ["--query-gpu=index,name,memory.total,driver_version", "--format=csv,noheader,nounits"], {
    encoding: "utf8",
    timeout: 1500,
    windowsHide: true,
  });
  if (result.error) {
    return {
      available: false,
      source: "nvidia-smi",
      error: result.error.code === "ENOENT" ? "nvidia-smi not installed or not in PATH" : safeText(result.error.message, 140),
      gpus: [],
    };
  }
  if (result.status !== 0) {
    return {
      available: false,
      source: "nvidia-smi",
      error: safeText(result.stderr || result.stdout || `nvidia-smi exited ${result.status}`, 140),
      gpus: [],
    };
  }
  const gpus = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, name, memoryMb, driver] = line.split(",").map((part) => part.trim());
      return {
        index: Number(index),
        name: safeText(name || "NVIDIA GPU", 80),
        memory_total_mb: Number(memoryMb) || null,
        driver_version: safeText(driver || "", 40) || null,
      };
    })
    .filter((gpu) => Number.isFinite(gpu.index));
  return { available: gpus.length > 0, source: "nvidia-smi", error: null, gpus };
}

function localComputeSummary(gpuProbe = probeNvidiaGpus()) {
  const cpuCount = cpus().length;
  return {
    gpu_probe: gpuProbe,
    cpu_threads: cpuCount,
    memory_total_gb: Math.round((totalmem() / 1024 / 1024 / 1024) * 10) / 10,
    memory_free_gb: Math.round((freemem() / 1024 / 1024 / 1024) * 10) / 10,
    cuda_visible: configuredEnv("CUDA_VISIBLE_DEVICES") || configuredEnv("NVIDIA_VISIBLE_DEVICES"),
  };
}

function check(id, label, status, detail, evidence = null) {
  return { id, label, status, detail: safeText(detail, 220), evidence: evidence ? safeText(evidence, 160) : null };
}

function readinessScore(checks) {
  if (!checks.length) return 0;
  const max = checks.length * STATUS_ORDER.ready;
  const score = checks.reduce((sum, item) => sum + (STATUS_ORDER[item.status] ?? 0), 0);
  return Math.round((score / max) * 100);
}

function overallStatus(checks) {
  if (checks.some((item) => item.status === "blocked")) return "blocked";
  if (checks.some((item) => item.status === "manual")) return "manual_required";
  if (checks.some((item) => item.status === "warning")) return "needs_attention";
  return "ready";
}

const yellowpaper = Object.freeze({
  url: "https://flop.finance/intro/yellowpaper/",
  miner_sections: ["3", "4", "6.1", "7", "8", "12", "Appendix C"],
  validator_sections: ["2", "3.6", "5.3", "13.2", "15"],
  miner_summary: "Miners run attested inference, meter useful G_n work, serve sessions, and claim settlement only after bound receipts and verification evidence.",
  validator_summary: "Validators author and finalize blocks, attest miner proofs by quorum, host data availability, and need stake plus recent verified PoUI work for committee eligibility.",
});

export function buildFlopMinerStatus(options = {}) {
  const runtime = options.runtime || {};
  const compute = localComputeSummary(options.gpuProbe);
  const checks = [
    check("gpu", "GPU visibility", compute.gpu_probe.available ? "ready" : "warning", compute.gpu_probe.available ? `${compute.gpu_probe.gpus.length} NVIDIA GPU(s) visible to this node.` : "No NVIDIA GPU was detected through nvidia-smi; CPU-only operation is not enough for production miner capacity.", compute.gpu_probe.error),
    check("technocore", "Technocore transport", runtime.technocoreEnabled ? "ready" : "warning", runtime.technocoreEnabled ? "Technocore transport is enabled for OSA discovery and coordination." : "Technocore transport is disabled; miner advertising would remain local."),
    check("identity", "Signed node identity", runtime.technocoreSignedMessages && runtime.technocoreDid ? "ready" : "manual", runtime.technocoreSignedMessages && runtime.technocoreDid ? "Managed DID is available for signed operator records." : "A signed DID is required before public operator announcements."),
    check("wallet", "Wallet / stake", options.walletConnected ? "manual" : "blocked", options.walletConnected ? "Wallet is connected, but FLOP miner stake registration is still an explicit on-chain action." : "Connect and verify a wallet before any future miner registration flow."),
    check("calibration", "Calibration and model roots", configuredEnv("OSA_FLOP_MINER_PROFILE") ? "manual" : "blocked", configuredEnv("OSA_FLOP_MINER_PROFILE") ? "A local miner profile flag exists; calibration evidence and measured model roots still require manual verification." : "No local FLOP miner profile is configured. Calibration, capacity stake, model availability, and measured roots are not registered."),
    check("settlement", "Settlement authority", "planned", "OSA currently exposes no real FLOP settlement lane from the dashboard; PaperRail/TCLK remains rehearsal-only."),
  ];
  return {
    schema: "osa-flop-miner-console/1",
    version: 1,
    generated_at: nowIso(),
    yellowpaper: { url: yellowpaper.url, sections: yellowpaper.miner_sections, summary: yellowpaper.miner_summary },
    mode: boolEnv("OSA_FLOP_MINER_ENABLED") ? "operator_configured" : "readiness_only",
    overall_status: overallStatus(checks),
    readiness_score: readinessScore(checks),
    compute,
    lifecycle: [
      { id: "onboard", label: "Onboard", state: "manual_required", detail: "Bond stake, calibrate hardware, register miner and model availability." },
      { id: "go_live", label: "Go live", state: "not_started", detail: "Advertise models; agents select miners off-chain." },
      { id: "serve", label: "Serve sessions", state: "not_started", detail: "Stream signed turns with receipts, TOPLOC evidence, and bounded G_n metering." },
      { id: "settle", label: "Claim settlement", state: "planned", detail: "Requires final root, last mutual receipt, validator attestation quorum, and replay guard." },
    ],
    readiness: checks,
    authority: {
      kind: "readiness_console_only",
      gpu_leasing: false,
      miner_registration: false,
      model_registration: false,
      session_acceptance: false,
      connector_spawning: false,
      payment: false,
      settlement: false,
      note: "This dashboard view does not lease GPU capacity, register stake, accept sessions, publish model roots, or claim FLOP payouts.",
    },
  };
}

export function buildFlopValidatorStatus(options = {}) {
  const runtime = options.runtime || {};
  const compute = localComputeSummary(options.gpuProbe);
  const checks = [
    check("identity", "Validator identity", runtime.technocoreSignedMessages && runtime.technocoreDid ? "ready" : "manual", runtime.technocoreSignedMessages && runtime.technocoreDid ? "Managed DID is available for signed local records." : "A durable operator identity is required before validator onboarding."),
    check("stake", "Stake floor", options.walletConnected ? "manual" : "blocked", options.walletConnected ? "Yellowpaper baseline self-stake must be bonded on-chain; dashboard does not freeze funds." : "Wallet verification is required before any future validator registration flow."),
    check("consensus", "Consensus client", configuredEnv("OSA_FLOP_VALIDATOR_RPC") || boolEnv("OSA_FLOP_VALIDATOR_ENABLED") ? "manual" : "blocked", configuredEnv("OSA_FLOP_VALIDATOR_RPC") || boolEnv("OSA_FLOP_VALIDATOR_ENABLED") ? "A validator config flag exists; consensus liveness must still be verified externally." : "No FLOP validator client/RPC configuration is present."),
    check("da", "Data availability", configuredEnv("OSA_FLOP_DA_ENDPOINT") ? "manual" : "blocked", configuredEnv("OSA_FLOP_DA_ENDPOINT") ? "A DA endpoint flag exists; serve-or-slash readiness still needs external verification." : "No DA store-and-serve endpoint is configured."),
    check("poui", "Recent verified PoUI work", compute.gpu_probe.available ? "manual" : "blocked", compute.gpu_probe.available ? "GPU capacity is visible, but recent verified PoUI work must be produced on-chain for committee eligibility." : "Committee eligibility requires recent useful work; no GPU miner backend is visible here."),
    check("attestation", "Attestation quorum", "planned", "Validator attestation and BFT quorum participation are not executable from this dashboard yet."),
  ];
  return {
    schema: "osa-flop-validator-console/1",
    version: 1,
    generated_at: nowIso(),
    yellowpaper: { url: yellowpaper.url, sections: yellowpaper.validator_sections, summary: yellowpaper.validator_summary },
    mode: boolEnv("OSA_FLOP_VALIDATOR_ENABLED") ? "operator_configured" : "readiness_only",
    overall_status: overallStatus(checks),
    readiness_score: readinessScore(checks),
    requirements: {
      self_stake_floor: "effective_minimum_stake; yellowpaper baseline 305,505 FLOP, parameterized by chain state",
      min_self_stake_ratio: "20% of self plus delegated stake",
      committee_gate: "active validator plus recent verified PoUI work within the work recency window",
      heavy_duties: ["DA store-and-serve", "committee-keeping GPU work"],
    },
    compute,
    lifecycle: [
      { id: "register", label: "Register", state: "manual_required", detail: "Self-sign registration and freeze stake into ValidatorQueue." },
      { id: "rotate", label: "Rotation", state: "not_started", detail: "Promotion into ActiveValidators happens through rotation and performance floors." },
      { id: "validate", label: "Validate", state: "not_started", detail: "Author BABE blocks, vote finality, host DA, and co-sign miner attestations." },
      { id: "recover", label: "Recover", state: "planned", detail: "Slashing, ejection cooldown, and rejoin flows require explicit chain/runtime handling." },
    ],
    readiness: checks,
    authority: {
      kind: "readiness_console_only",
      validator_registration: false,
      stake_bonding: false,
      block_authoring: false,
      finality_voting: false,
      attestation_signing: false,
      da_publishing: false,
      payment: false,
      settlement: false,
      note: "This dashboard view does not bond stake, join committees, author blocks, sign attestations, host DA, or move FLOP.",
    },
  };
}
