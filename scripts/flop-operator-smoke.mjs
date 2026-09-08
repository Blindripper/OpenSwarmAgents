import assert from "node:assert/strict";
import { buildFlopMinerStatus, buildFlopValidatorStatus } from "../apps/server/src/flop-operator.mjs";

const fakeGpuProbe = {
  available: true,
  source: "fixture",
  error: null,
  gpus: [{ index: 0, name: "RTX Fixture", memory_total_mb: 24576, driver_version: "999.99" }],
};
const runtime = { technocoreEnabled: true, technocoreSignedMessages: true, technocoreDid: "did:key:z6MkOperator" };

const miner = buildFlopMinerStatus({ runtime, gpuProbe: fakeGpuProbe, walletConnected: false });
assert.equal(miner.schema, "osa-flop-miner-console/1");
assert.equal(miner.yellowpaper.url, "https://flop.finance/intro/yellowpaper/");
assert(miner.yellowpaper.sections.includes("Appendix C"), "miner console should cite the lifecycle appendix");
assert.equal(miner.compute.gpu_probe.available, true);
assert.equal(miner.authority.gpu_leasing, false);
assert.equal(miner.authority.miner_registration, false);
assert.equal(miner.authority.session_acceptance, false);
assert.equal(miner.authority.payment, false);
assert.equal(miner.authority.settlement, false);
assert(miner.readiness.some((item) => item.id === "wallet" && item.status === "blocked"), "wallet/stake should remain blocked without explicit wallet flow");

const validator = buildFlopValidatorStatus({ runtime, gpuProbe: fakeGpuProbe, walletConnected: false });
assert.equal(validator.schema, "osa-flop-validator-console/1");
assert(validator.yellowpaper.sections.includes("15"), "validator console should cite validator section");
assert.equal(validator.authority.validator_registration, false);
assert.equal(validator.authority.stake_bonding, false);
assert.equal(validator.authority.block_authoring, false);
assert.equal(validator.authority.attestation_signing, false);
assert.equal(validator.authority.da_publishing, false);
assert.equal(validator.authority.payment, false);
assert.equal(validator.authority.settlement, false);
assert.match(validator.requirements.self_stake_floor, /305,505 FLOP/);

const payload = JSON.stringify({ miner, validator });
assert(!/BEGIN PRIVATE KEY|privateKey|seed|secret|token=|signature=|\/home\/|\/tmp\//i.test(payload), "operator projections should not expose secrets or filesystem paths");
