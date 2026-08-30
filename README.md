# OpenSwarmAgents

<p align="center">
  <img src="apps/web/public/osa-logo.svg" alt="OpenSwarmAgents logo" width="128" height="128" />
</p>

<p align="center">
  <strong>OSA is an experimental blockchain-powered network for wallet-owned AI agent projects.</strong>
</p>

<p align="center">
  Build privately, connect a wallet, let agents work, share complete projects, copy what is useful, review what works, donate USDC, and prepare for future $OSA participation rewards.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22%2B-339933" />
  <img alt="Wallet Required" src="https://img.shields.io/badge/wallet-required-22d3ee" />
  <img alt="$OSA Experimental" src="https://img.shields.io/badge/%24OSA-experimental-facc15" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

<p align="center">
  <img src="docs/assets/osa-dashboard-preview.png" alt="OpenSwarmAgents dashboard preview" width="920" />
</p>

## Important Warning

OSA is experimental software. `$OSA` is currently an unlisted, worthless project token concept. There is no guarantee that `$OSA` will ever have monetary value, liquidity, exchange support, or production utility.

Nothing in this repository is financial advice, an investment offer, or a promise of profit. Treat OSA as an experimental agent-network and tokenomics prototype until the smart contracts, reward scoring, audits, and production settlement are complete.

## What OSA Is

OpenSwarmAgents, short **OSA**, is a local dashboard for building and publishing complete AI agent projects.

- **Home** is your private workspace.
- **+ Room** creates extra private rooms inside the same project.
- **Share Project** publishes the complete project: Home, custom rooms, and all agents inside them. OSA asks separately before including the File Repo.
- **Latest Projects** shows the newest shared projects entering the public network.
- **Top100 Projects** ranks public projects by copy count.
- **Copy** imports a public project into your own private workspace.
- **Donate** records a USDC donation intent for a public project.
- **Review** lets wallet-connected users rate public projects with stars and feedback.
- **Wallet login is mandatory** because wallet public keys anchor project ownership, reviews, donations, and future `$OSA` work rewards.

OSA no longer splits the public marketplace into separate Agents, Rooms, and Projects. A project is the product unit. That keeps the network understandable: users copy a complete working setup, not a loose card with missing context.

The dashboard starts with only two rooms:

- **Home** for private work
- **Latest Projects** for copy-only public projects

An example project is included in Latest Projects and Top100 Projects so you can test Copy, Donate, and Review without creating fake Home work.

## Demo

<p align="center">
  <video src="docs/assets/osa-demo.webm" controls width="920"></video>
</p>

## Screenshots

| Wallet Login | Home And Latest Projects |
| --- | --- |
| ![OSA wallet login](docs/assets/osa-wallet-login.png) | ![OSA dashboard](docs/assets/osa-dashboard-preview.png) |

| Latest Projects | Top100 Projects |
| --- | --- |
| ![OSA latest projects](docs/assets/osa-latest-projects.png) | ![OSA Top100 Projects](docs/assets/osa-top100-projects.png) |

| Project Donation And Review |
| --- |
| ![OSA project donation and review](docs/assets/osa-project-review.png) |

## Install Step By Step

You need:

- Git
- Node.js 22 or newer
- npm
- Python 3
- an EVM wallet browser extension such as MetaMask

Install OSA:

```bash
curl -fsSL https://raw.githubusercontent.com/Blindripper/OpenSwarmAgents/main/scripts/install-node.sh | bash
```

Start OSA:

```bash
cd ~/.local/share/openswarmagents
npm run dev
```

Open the dashboard:

```text
http://127.0.0.1:8789
```

Connect your wallet. OSA will not open the dashboard without a wallet identity.

## Run From Source

```bash
git clone https://github.com/Blindripper/OpenSwarmAgents.git
cd OpenSwarmAgents
npm ci
npm run build:agent-gui
npm run dev
```

Open:

```text
http://127.0.0.1:8789
```

If port `8789` is busy:

```bash
PORT=8790 npm run dev
```

## How To Use OSA

1. Open OSA and connect an EVM wallet.
2. In **Home**, type what your agent should work on.
3. Pick an Agent Profile or keep the default OpenClaw agent.
4. Start the agent.
5. Add private rooms with **+ Room** when the project needs structure.
6. Click **Share Project** when the whole setup is worth publishing.
7. Decide whether the project's File Repo should be shared too.
8. Watch new entries appear in **Latest Projects**.
9. Open **Top100 Projects** to see which public projects are being copied.
10. Copy, donate, and review public projects from your wallet identity.

The topbar shows the live network state, public project count, active working agents, copy count, **Earned Donations**, and the connected wallet's `$OSA` balance. Until the token is deployed and balance reads are configured, that balance is shown honestly as `0 OSA`.

Use **Save/Load Project** to save the current local project layout in this browser and restore it later. Use **Reset** when you want a clean slate: it cancels/removes private agent work, clears private rooms and pending prompts, and keeps Latest Projects as the public network feed.

## Project Sharing

OSA shares only complete projects.

A project includes:

- Home
- every custom private room
- all agents inside those rooms
- project metadata
- optional File Repo metadata/files when you confirm that sharing is safe
- copy and donation counters
- review stats
- wallet owner identity when available

When you click **Share Project**, OSA publishes one copy-only public listing. The public listing does not let other users control your local machine. It works like a network template.

## Latest Projects

**Latest Projects** is the live public feed. It shows the newest shared projects first.

When a project enters the network, OSA refreshes the feed immediately and shows a small notice. If bell sounds are enabled, the selected OSA bell can play. Tiny celebration, practical signal.

Federated nodes can import public project listings, copy counts, reviews, donation totals, and recent public network events from trusted peers.

## Top100 Projects

**Top100 Projects** ranks public projects by copy count.

Each row shows:

- current rank
- project name
- number of copied agents/rooms inside the project
- public copy count
- total USDC donation intents earned
- average project rating
- review count
- **Copy**
- **Donate**
- **Review**

Rankings update live when projects are shared, copied, donated to, reviewed, or imported from a peer node.

## Copy Mechanics

Copying a project creates your own private copy.

Before import, OSA shows a confirmation popup. After confirmation, the copied project appears in your private workspace with its rooms and agents. The public original stays untouched.

This keeps the network safe and sane: copying means "give me my own version", not "remote-control someone else's agents."

## Manager

Each private room can show a small **Manager** station. The manager is an optional QA helper for local work: it checks idle desks, runs progress/audit checks, and leaves guidance when an agent looks stuck. It is not a public moderator and it does not manage other users' projects.

## Wallet Login

Wallet login is mandatory.

OSA uses the connected EVM public key for:

- project owner identity
- copy provenance
- donation identity
- project reviews
- future `$OSA` work rewards
- decentralized reputation and anti-spam signals
- showing the current `$OSA` balance in the dashboard topbar

The current dashboard login asks the wallet for an account address and chain id. It does not request a private key and does not send a transaction.

Production deployments should add signed nonce login before treating wallet identity as strong authentication.

## Donations

Public projects can receive USDC donation intents.

The dashboard offers:

- `1 USDC`
- `5 USDC`
- custom USDC amount

OSA keeps **5%** of donations for development and operating costs. Think of it as the infrastructure snack budget: tiny compared with the builder's 95%, but still what keeps servers, audits, and late-night fixes from being funded by vibes.

Fee wallet:

```text
0x0D92d175943336E3Ad099e55FBe4248dC6fA947b
```

The current implementation records donation intents. Before production settlement, OSA must wire in real USDC transfers and transaction-hash verification.

## $OSA Tokenomics

Planned fixed supply:

```text
10,000,000,000 OSA
```

Planned participation rewards:

```text
5,000,000,000 OSA over 3 years
```

The reward idea is simple: connected accounts should earn `$OSA` when they let useful agents work in the network.

The reward pool should not pay for idle fake agents. A production scoring system should consider active agent work, accepted results, project usefulness, copy activity, reviews, peer validation, uptime with real work, and anti-spam caps.

See [docs/TOKENOMICS.md](docs/TOKENOMICS.md) for the current allocation and reward-distribution draft.

## Smart Contracts

The repository includes a draft Solidity implementation:

- [contracts/OSAToken.sol](contracts/OSAToken.sol)

It contains:

- `OSAToken`: fixed-supply ERC-20 token.
- `OSAWorkRewardsDistributor`: Merkle-based reward distributor capped by a three-year linear unlock.

This is a draft. Do not deploy it as production financial infrastructure before tests, deployment planning, multisig setup, timelocks/vesting, and an independent audit.

Recommended next steps before deployment:

- choose chain
- choose deployment tooling
- use a multisig for treasury and contract ownership
- define vesting/timelocks for non-reward allocations
- write Solidity tests and invariant tests
- build reward epoch generation and Merkle proof tooling
- run an independent security audit
- verify contracts on the chain explorer

## Project Reviews

Wallet-connected users can review public projects with:

- 1 to 5 stars
- short headline
- feedback text

One wallet can update its own review for a project. This keeps feedback useful and gives OSA a base layer for reputation.

## Agent Profiles

Agent Profiles are reusable worker presets. They define names, behavior, model defaults, and tool defaults for agents you run in Home.

You can create and delete custom profiles from the dashboard. Built-in OpenClaw/Codex profiles stay available as templates, and OSA includes example profiles such as **Market Scout**, **Product Builder**, and **Tokenomics Analyst** with their own Soul/Memory so users can understand what a useful agent personality looks like.

## Local Data

OSA keeps runtime data local by default:

- app state in `data/`
- uploads in `data/uploads`
- node identity in `data/node-identity.json`
- browser layout and UI preferences in localStorage

Private keys are not part of OSA data and should never be committed.

## Docker

```bash
docker compose up --build
```

Open:

```text
http://127.0.0.1:8789
```

## Troubleshooting

If the dashboard does not open:

```bash
npm run dev
```

If dependencies are missing:

```bash
npm ci
npm run build:agent-gui
```

If another app is using the port:

```bash
PORT=8790 npm run dev
```

If local agents cannot start, make sure OpenClaw is available on the host:

```bash
openclaw --version
```

If wallet login does not appear, open OSA in a browser with an EVM wallet extension.

## Security Notes

Security matters because OSA now touches wallets, donations, rewards, and public network data.

Current safety posture:

- dashboard wallet login is required
- donation flow is intent-only until on-chain settlement is added
- `$OSA` contract is draft-only
- reward distribution is designed around capped Merkle claims
- public projects are copy-only templates, not remote execution handles
- local runtime data stays local by default

Before production money moves, add:

- signed nonce wallet login
- USDC transfer execution and verification
- chain and contract allowlists
- reward scoring audit trail
- smart contract tests and independent audit
- multisig ownership
- incident response plan

## License

MIT
