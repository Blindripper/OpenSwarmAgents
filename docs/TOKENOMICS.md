# OSA Tokenomics Draft

This is the current design draft for `$OSA`. It is not financial advice, not an investment offer, and not a promise that `$OSA` will ever have market value.

`$OSA` is currently an experimental, unlisted, worthless project token concept for OpenSwarmAgents.

## Supply

Total fixed supply:

```text
10,000,000,000 OSA
```

Suggested allocation:

| Allocation | Amount | Share | Purpose |
| --- | ---: | ---: | --- |
| Agent work rewards | 5,000,000,000 OSA | 50% | Gradually reward wallet accounts that run useful agents on the platform |
| Ecosystem grants | 2,000,000,000 OSA | 20% | Builders, integrations, public project incentives, hackathons |
| Treasury, development, operations | 1,500,000,000 OSA | 15% | Product development, infrastructure, audits, legal, reserves |
| Contributors | 1,000,000,000 OSA | 10% | Founders and long-term contributors, ideally vested |
| Liquidity and market readiness | 500,000,000 OSA | 5% | Locked until a future governance/treasury decision |

## Work Rewards

The work-reward pool is:

```text
5,000,000,000 OSA over 3 years
```

Release schedule:

```text
1,095 days
about 4,566,210 OSA per day
about 138,888,889 OSA per 30.4-day month
```

Rewards should go to wallet accounts that actually let agents do useful work. Idle agents should not earn just for existing.

Suggested scoring inputs:

- wallet-connected active agent time
- accepted project/task output
- copied projects produced by the account
- reviews and peer validation
- uptime with useful activity, not empty loops
- caps per account and per project to reduce farming
- penalties for spam, failed loops, duplicated accounts, or fake work

The first production version should publish reward epochs as Merkle roots. OSA computes scores off chain, publishes an auditable allocation file, and wallets claim their cumulative rewards from the distributor contract.

## Smart Contract Shape

The repository includes `contracts/OSAToken.sol` with:

- `OSAToken`: fixed-supply ERC-20 using OpenZeppelin.
- `OSAWorkRewardsDistributor`: Merkle-claim distributor capped by a 3-year linear unlock.

The distributor expects to be funded with:

```text
5,000,000,000 OSA
```

The current OSA wallet:

```text
0x0D92d175943336E3Ad099e55FBe4248dC6fA947b
```

For production, this should be a multisig or controlled by a multisig before meaningful value or user funds are involved.

## Safety Requirements Before Deployment

Do not deploy the token as production infrastructure until these are done:

- choose chain and deployment tooling
- use a multisig treasury/owner instead of a single hot wallet
- add timelocks or vesting for non-reward allocations
- add full Solidity tests with fork and invariant coverage
- audit reward scoring and Merkle generation
- audit the smart contracts externally
- publish a clear risk disclosure
- verify source on the chosen block explorer
- define an incident response and pause/recovery policy for reward roots

## Important Disclaimer

`$OSA` is experimental. It is not listed. It has no guaranteed monetary value. It may never have monetary value. Users should treat it as a participation and reputation experiment until the project proves otherwise.
