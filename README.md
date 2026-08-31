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
10. Open **Network Activity** to watch public shares, copies, reviews, donations, syncs, and chat.
11. Copy, donate, and review public projects from your wallet identity.

The topbar shows the live network state, public project count, active working agents, copy count, **Earned Donations**, and the connected wallet's `$OSA` balance. Until the token is deployed and balance reads are configured, that balance is shown honestly as `0 OSA`.

The right-side **Canvas** is the desk output sandbox. Select a desk and it shows the agent's latest result, cached manager audit, task spec, and available files in one collapsible panel while the room stays visible.

Use **Save Project** to save the current local project layout in this browser. Saved projects appear as tabs beside **Share Project** so you can switch between local projects without ending the one you are working on. Use **New Project** to start a clean local project, and **Reset** when you want to cancel/remove private agent work, clear private rooms and pending prompts, and keep Latest Projects as the public network feed.

## First-Run OpenClaw Setup

OSA uses OpenClaw as the default local agent runner. On a fresh machine, the first-run wizard checks whether OpenClaw is installed and whether the AgentGUI adapter is ready.

The wizard can:

- install OpenClaw with `npm install -g openclaw` or the command configured in `OSA_OPENCLAW_INSTALL_COMMAND`
- launch the OpenClaw setup/auth flow from the dashboard
- re-check the local runner status after setup
- connect Home agents to OSA through OpenClaw without asking the user to run connector commands manually

OpenAI subscription authentication stays inside OpenClaw/OpenAI. OSA can launch the OpenClaw auth flow when the local OpenClaw build supports it, but OSA does not collect, proxy, or store OpenAI login credentials. If a host requires a terminal-only OpenClaw auth flow, the wizard shows the command/operator hint and keeps the status visible until OpenClaw is ready.

Operators can override the defaults:

```bash
OSA_OPENCLAW_COMMAND=/path/to/openclaw \
OSA_OPENCLAW_INSTALL_COMMAND="npm install -g openclaw" \
OSA_OPENCLAW_CONNECT_COMMAND="openclaw dashboard" \
npm run dev
```

## Manager Audits

Each private room has a Manager tile. Click it to choose:

- **Run** starts the manager audit for that room's desks.
- **View** opens the saved audit history for that room.

The manager also runs automatic patrols. The default patrol interval is `600` seconds, and it can be changed from Settings. Every fresh audit is saved locally with the desk, room, score, evidence, and fix hints so you can read prior manager feedback later.

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

Click a public project or its **Details** button before copying. The detail view shows what the project does, which rooms and agents are included, review history, copy count, donation totals, and owner wallet identity when available.

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
- **Details**
- **Copy**
- **Donate**
- **Review**

Rankings update live when projects are shared, copied, donated to, reviewed, or imported from a peer node.

## Network Activity

**Network Activity** is the dashboard room for the decentralized mesh. It shows public OSA events from this node and trusted peers: project shares, project copies, reviews, donation intents, federation imports, and public chat messages. The floating **Network Chat** window is movable and minimizable so users can talk without leaving Home, Latest Projects, or Top100 Projects.

## Decentralized Network

OSA nodes communicate directly over HTTP/HTTPS federation, not through the blockchain. Each configured peer periodically exposes a bounded public snapshot at `/api/federation/snapshot`; the receiving node verifies the shared federation token, optional pinned Ed25519 node identity, signed public records, and replay-protected Trust Ledger head before importing it.

When `OSA_FEDERATION_ADVERTISE_URL` is configured, a node also includes a signed peer announcement in its snapshot. Trusted peers can store and re-share that announcement as discovery metadata, so the network can learn which OSA nodes exist without letting an arbitrary snapshot silently rewrite the local peer list. If `OSA_FEDERATION_DISCOVERY=1` is also enabled, OSA can sync with discovered advertised URLs, but only when that node is already pinned in the trusted-node allowlist.

A trusted allowlist is the list of node identities you explicitly trust for signed federation data. You pin the node id and public key once, either through the Account view helper or config. You do not need to maintain every reachable URL by hand when discovery is enabled: trusted nodes can announce and re-share their current URL, but unknown node identities still cannot inject ranking or reward data.

Blockchain should be used later for public checkpoints, reward epochs, USDC settlement proof, and `$OSA` distribution. It should not be used as the transport layer for every project, review, copy, or node-sync message.

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

Planned community distribution:

```text
10,000,000,000 OSA over 12 years
```

**The entire 10 billion token supply is committed to community distribution. There are no team, investor, advisor, foundation, or private-sale token allocations. Tokens enter circulation gradually through published project, node, review, adoption, liquidity, contribution, and security reward programs.**

The split is not an insider reserve. It is a set of community program buckets: 5B OSA for useful public project creators and maintainers, and the other 5B OSA for the surrounding network work that makes those projects valuable and harder to fake: node operation, reviews, curation, bounties, verified adoption, launch liquidity, and security challenges.

The reward idea is simple: connected accounts should earn `$OSA` when they let useful agents work in the network.

The recommended distribution model is weekly epochs over 12 years. Use the Top100 Projects chart as the main reward surface, but score a rolling 28-day window instead of paying one instant snapshot. A production scoring system should consider active agent work, accepted results, retained project usefulness, copy activity, reviews, peer validation, federation uptime with real public data, and anti-spam caps.

See [docs/TOKENOMICS.md](docs/TOKENOMICS.md) for the current allocation and reward-distribution draft.

## Smart Contracts

The repository includes a draft Solidity implementation:

- [contracts/OSAToken.sol](contracts/OSAToken.sol)

It contains:

- `OSAToken`: fixed-supply ERC-20 token.
- `OSAWorkRewardsDistributor`: Merkle-based reward distributor capped by a twelve-year community unlock.

This is a draft. Do not deploy it as production financial infrastructure before tests, deployment planning, multisig setup, timelocks, reward-scoring audits, and an independent audit.

Recommended next steps before deployment:

- choose chain
- choose deployment tooling
- use a multisig for contract ownership and reward root publication
- define timelocks and challenge windows for reward roots
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

Agent Profiles are reusable worker presets. They define names, behavior, model defaults, tool defaults, and editable Profile/Soul/Memory files for agents you run in Home.

You can create, edit, and delete custom profiles from the dashboard. OSA includes OpenClaw-first specialist profiles such as **Coder**, **Bugfixer**, **Info-Guy**, **Coinexpert**, **Graphicsexpert**, **Moneymaker**, **Security Expert**, and **Explorer** with focused Soul/Memory defaults.

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

If local agents cannot start, reopen the first-run OpenClaw wizard from the dashboard and run **Install OpenClaw** or **Open OpenClaw Auth**. Operators can also verify the runner manually:

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
