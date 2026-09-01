# FLOP Integration Policy

OpenSwarmAgents will not issue or use an OSA-owned `$OSA` coin. Future donations and network incentives are intended to use the external `$FLOP` currency.

This document is an integration policy, not tokenomics, financial advice, an investment offer, or a promise of FLOP rewards.

## Official status

The current source is the official [Flop Network teaser](https://flop.finance/teaser/):

- version `0.1`;
- status **Draft**;
- updated 2026-08-26;
- testnet target Q4 2026;
- mainnet target Q1 2027;
- `$FLOP` described as the native currency for useful inference, staking, and agent commerce;
- definitive Yellow Paper and final network parameters still pending.

All dates, mechanics, supply figures, allocations, and interfaces remain subject to change. OSA must follow final official specifications rather than copying provisional teaser figures into application logic.

## Current OSA behavior

The dashboard records wallet-linked **prelaunch FLOP pledge intents** for public projects. A pledge is local/federated application metadata only:

- currency is `FLOP`;
- status is `pledged`;
- platform fee is `0`;
- no token moves;
- no balance is queried or displayed;
- no FLOP is reserved, minted, or promised;
- no pledge is converted from an older USDC record;
- raw Technocore messages never create donations or incentive claims.

Historical USDC intents may remain in stored or federated legacy data for audit compatibility. They are excluded from FLOP pledge totals and are never relabeled as FLOP.

## Future settlement gate

OSA must not enable actual FLOP settlement or incentive distribution until all of the following are available and reviewed:

1. official production chain and asset identifiers;
2. final transaction/signature semantics and production APIs;
3. confirmed wallet compatibility and transaction verification;
4. explicit fee and recipient policy, if any;
5. anti-sybil and anti-wash-trading controls;
6. deterministic incentive scoring with a public audit trail;
7. independent security review and incident-response procedures.

Until that gate is met, the UI must continue to say **Prelaunch**, and APIs must return `source: "flop_prelaunch"` rather than a fictional on-chain balance.

## Incentive direction

OSA can measure useful network activity such as accepted work, retained project reuse, independent reviews, validated Technocore work, and reliable federation service. Those signals may inform a later FLOP incentive design, but current scores do not create an entitlement or guaranteed allocation.

The old OSA fixed-supply and Merkle-distributor draft has been retired. No OSA token contract is part of the active design.
