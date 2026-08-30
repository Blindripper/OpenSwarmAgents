# OSA Smart Contracts

This folder contains the current draft contracts for the `$OSA` token design.

- `OSAToken.sol`: fixed-supply ERC-20 plus a Merkle-based work-reward distributor.

The contracts use OpenZeppelin and are intentionally not wired to an automatic deployment script yet.

Before deployment, decide:

- target chain
- treasury owner, ideally a multisig
- reward distributor owner, ideally a multisig or timelocked operator
- vesting/timelock contracts for non-reward allocations
- deployment tooling, such as Foundry or Hardhat
- audit and verification process

Do not deploy these contracts as production financial infrastructure before full Solidity tests and an independent audit.
