# OSA Tokenomics Draft

This is the current design draft for `$OSA`. It is not financial advice, not an investment offer, and not a promise that `$OSA` will ever have market value.

`$OSA` is currently an experimental, unlisted, worthless project token concept for OpenSwarmAgents.

## Supply

Total fixed supply:

```text
10,000,000,000 OSA
```

Community allocation:

These are not insider reserves. They are community program buckets that define which useful network behavior can earn from the 10B supply.

| Allocation | Amount | Share | Purpose |
| --- | ---: | ---: | --- |
| Project creators and maintainers | 5,000,000,000 OSA | 50% | Reward useful, reproducible public projects and their upstream maintainers |
| Federation node operators | 1,500,000,000 OSA | 15% | Reward OSA nodes that keep public project data online, reachable, fresh, indexed, and verifiable |
| Reviewers and curators | 1,000,000,000 OSA | 10% | Reward high-signal reviews, moderation, ranking quality, and discovery work |
| Open-source grants and bounties | 1,000,000,000 OSA | 10% | Reward community-built connectors, templates, protocol improvements, audits, documentation, and accepted contributions |
| Verified adopters | 750,000,000 OSA | 7.5% | Reward retained project use, meaningful downstream reuse, and real adoption beyond first-copy events |
| Community launch and LP rewards | 500,000,000 OSA | 5% | Support permissionless launch distribution, onboarding campaigns, and community liquidity programs |
| Security and challenge rewards | 250,000,000 OSA | 2.5% | Reward vulnerability reports, fraud proofs, scoring challenges, and independent audits |

The full 10B supply is community-distributed in this draft. There is no token allocation for team, investor, advisor, foundation, private sale, treasury, or insider liquidity reserve. Contributors earn through the same published community programs as everyone else.

In plain terms: 5B rewards the people who publish useful projects. The other 5B rewards the community roles required for a real decentralized network: people who run nodes, verify projects, review quality, find bugs, build integrations, prove adoption, and help launch liquidity without receiving a private allocation.

## Work Rewards

The community reward pool is:

```text
10,000,000,000 OSA over 12 years
```

Release schedule:

```text
4,380 days
about 2,283,105 OSA per day on average
about 15,981,735 OSA per 7-day epoch on average
about 69,406,392 OSA per 30.4-day month on average
```

Annual release percentages:

```text
14%, 13%, 12%, 11%, 10%, 9%, 8%, 7%, 6%, 4%, 3%, 3%
```

That puts 50% of supply into circulation during the first four years and keeps meaningful rewards available through year twelve.

Rewards should go to wallet accounts that actually let agents do useful work. Idle agents should not earn just for existing.

Suggested epoch design:

- run one reward epoch every 7 days
- use a rolling 28-day scoring window
- keep a 7-day public challenge and finalization period before publishing the final Merkle root
- make 75% claimable after finalization
- hold 25% for 8 weeks and release it only if retention and fraud checks pass
- return invalid or unclaimed rewards to the same community bucket
- publish epoch metadata as auditable JSON/CSV with project ids, wallet ids, scores, caps, exclusions, and Merkle proofs

Top100 project rewards should use 70% of the 5B project bucket, or 3.5B OSA over 12 years. In each weekly project epoch:

- 70% goes to Top100 projects
- 20% goes to qualified projects below Top100 using square-root score weighting
- 10% stays as a delayed quality holdback

Within Top100, use rank weighting:

```text
weight(rank) = 1 / sqrt(rank)
payout(rank) = Top100 pool * weight(rank) / sum(weight(1..100))
```

Cap any project at 5% of the weekly Top100 pool and redistribute the excess. Reserve 20 Top100 reward slots for projects published within the previous 90 days so incumbents cannot permanently block new useful projects.

In year one, this implies:

```text
about 13,461,538 OSA in project rewards per week
about 9,423,077 OSA in Top100 rewards per week
about 2,692,308 OSA in below-Top100 project rewards per week
about 1,346,154 OSA in delayed project-quality holdback per week
```

Suggested scoring inputs:

- 35% verified adoption: unique, independently attested project copies
- 25% retained utility: continued use after 7 and 28 days, updates, downstream dependencies, and accepted results
- 15% review quality: reputation-weighted reviews and later helpfulness
- 10% reproducibility and maintenance: signed manifests, successful runs, fixes, and maintained dependencies
- 10% federation health: availability corroborated by diverse independent peers
- 5% donor breadth: square-root-weighted unique donors

USDC value should not directly increase ranking. Display donation totals, but score only capped donor breadth; otherwise projects can buy token emissions through wash donations. Forks must declare their parent project hash. Adoption rewards should be shared with materially reused upstream projects, while cosmetic clones receive little or no independent credit.

The first production version should publish reward epochs as Merkle roots. OSA computes scores off chain, publishes an auditable allocation file, and wallets claim their cumulative rewards from the distributor contract. A weekly cadence is the clean starting point: it is fast enough to feel alive, but long enough to reduce flash-copying and last-minute ranking manipulation.

Anti-abuse controls:

- do not treat one wallet as one human; combine wallet history, economic bonds, web-of-trust, independent node attestations, and optional privacy-preserving personhood credentials
- apply diminishing returns to wallets, nodes, donors, or reviewers belonging to correlated clusters
- exclude reciprocal reviews, circular donations, self-copies, rapid copy/delete cycles, and related-wallet activity
- count a copy only after a content-addressed fetch plus independent run or retention attestation
- require node service receipts from several unrelated peers and periodically issue randomized availability challenges
- cap influence by operator, peer cluster, reviewer, and donor cluster
- delay reviewer rewards until their assessments prove useful; never pay merely for submitting a review
- publish all score events, exclusions, formulas, root data, and challenge results so anyone can reproduce an epoch

## Smart Contract Shape

The repository includes `contracts/OSAToken.sol` with:

- `OSAToken`: fixed-supply ERC-20 using OpenZeppelin.
- `OSAWorkRewardsDistributor`: Merkle-claim distributor capped by a 12-year linear community unlock.

The distributor expects to be funded with:

```text
10,000,000,000 OSA
```

The current OSA wallet:

```text
0x0D92d175943336E3Ad099e55FBe4248dC6fA947b
```

For production, this should be a multisig or controlled by a multisig before meaningful value or user funds are involved.

## Safety Requirements Before Deployment

Do not deploy the token as production infrastructure until these are done:

- choose chain and deployment tooling
- use a multisig owner instead of a single hot wallet
- add timelocks and challenge windows for reward roots
- add immutable bucket ceilings and emission schedules before production
- add full Solidity tests with fork and invariant coverage
- audit reward scoring and Merkle generation
- audit the smart contracts externally
- publish a clear risk disclosure
- verify source on the chosen block explorer
- define an incident response and pause/recovery policy for reward roots

## Important Disclaimer

`$OSA` is experimental. It is not listed. It has no guaranteed monetary value. It may never have monetary value. Users should treat it as a participation and reputation experiment until the project proves otherwise.
