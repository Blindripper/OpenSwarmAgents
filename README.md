# OpenSwarmAgents

<p align="center">
  <img src="apps/web/public/osa-logo.svg" alt="OpenSwarmAgents logo" width="128" height="128" />
</p>

<p align="center">
  <strong>Your local AI agent office with a public idea market.</strong>
</p>

<p align="center">
  Create agents in Home, decide what gets shared to Public, and watch the Top100 chart show which agents people actually copy.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22%2B-339933" />
  <img alt="Local First" src="https://img.shields.io/badge/local--first-yes-0f766e" />
  <img alt="User Owned" src="https://img.shields.io/badge/user--owned-agents-22d3ee" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

<p align="center">
  <img src="docs/assets/osa-dashboard-preview.png" alt="OpenSwarmAgents dashboard preview" width="920" />
</p>

## The Idea

OpenSwarmAgents, short **OSA**, is a self-hosted dashboard for running and sharing AI agents.

Most agent platforms want to become the place where your prompts, keys, results, and workflows live. OSA takes the opposite angle:

- **Home** is your private agent workspace.
- **Public** shows only agents that someone deliberately shared.
- **Top100 AI Agents** ranks public agents by how often they were copied.
- **Copy** brings a public agent idea into your Home so you can run your own version.
- Your local node remains the control surface.

So the vibe is simple: build useful agents, share the ones worth showing, let the copy count expose what people actually want.

## Current Dashboard

| Home | Public |
| --- | --- |
| ![OSA Home room](docs/assets/osa-home.png) | ![OSA Public room](docs/assets/osa-public.png) |

| Top100 AI Agents | First run |
| --- | --- |
| ![OSA Top100 AI Agents](docs/assets/osa-top100.png) | ![OSA first-run guidance](docs/assets/osa-onboarding.png) |

| Mobile |
| --- |
| ![OSA mobile view](docs/assets/osa-mobile.png) |

## Install

You need:

- Git
- Node.js 22 or newer
- npm
- Python 3 for local agent connectors

Install OSA:

```bash
curl -fsSL https://raw.githubusercontent.com/Blindripper/OpenSwarmAgents/main/scripts/install-node.sh | bash
```

Start it:

```bash
cd ~/.local/share/openswarmagents
npm run dev
```

Open:

```text
http://127.0.0.1:8789
```

The installer clones OSA, installs dependencies, builds the AgentGUI dashboard, and creates a local `.env` if needed.

## Fast Start

Install and run in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Blindripper/OpenSwarmAgents/main/scripts/install-node.sh | bash -s -- --run
```

Stop the server with `Ctrl+C`.

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

## How To Use OSA

1. Open the dashboard.
2. Use **Home / Public** as the main workbench.
3. Create an agent desk in **Home**.
4. Run work locally from that desk.
5. Keep the agent private, or switch it to **Public** on the desk card.
6. Public visitors can copy it into their own Home.
7. The **Top100 AI Agents** tab ranks public agents by copy count.

Home and Public start empty. No demo tasks, no fake chart fillers, no preloaded "look how busy we are" theater.

## Home

Home is where your agents live.

- Start new desks.
- Pick or customize the agent profile.
- Run local work.
- Delete desks you no longer need.
- Decide per agent whether it is private or shared to Public.

Each Home agent card has a Public toggle. Off means private. On means it appears in Public as a copy-only listing.

## Public

Public is the shared idea floor.

- It starts empty.
- It only shows agents that were explicitly shared.
- Public agents cannot be edited or controlled by visitors.
- The main action is **Copy**.

Copying a public agent creates a new Home desk on your node. From there, it is yours to run, modify, improve, or keep private.

## Top100 AI Agents

The **Top100 AI Agents** tab is the chart board.

- Rank 1 to 100.
- Sorted by public copy count.
- Shows agent title, model/source label, and copy total.
- Copying from the chart also creates a Home desk.

This is intentionally blunt. If an agent is useful, people copy it. If nobody copies it, it does not climb.

## Local Data

OSA keeps runtime state local by default:

- app state under `data/`
- uploaded artifacts under `data/uploads`
- local node identity under `data/node-identity.json`
- browser workbench preferences in localStorage

Ignored runtime files stay out of Git:

- `.env`
- `node_modules/`
- `data/*.json` except `data/seed.json`
- `data/uploads`
- logs
- Python caches

## Docker

For a local Compose setup:

```bash
docker compose up
```

Open:

```text
http://127.0.0.1:8789
```

For production-style local Compose:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production` and replace:

```text
POSTGRES_PASSWORD=change-this-long-random-password
```

Start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Check:

```bash
curl http://127.0.0.1:8789/api/health
```

Keep production nodes behind a reverse proxy, tunnel, VPN, or private network you control.

## Troubleshooting

If the dashboard says the AgentGUI frontend is missing:

```bash
npm run build:agent-gui
npm run dev
```

If port `8789` is busy:

```bash
PORT=8790 npm run dev
```

Then open:

```text
http://127.0.0.1:8790
```

If local agents do not start, confirm Python 3 is installed and that the local agent tool you want to use works from the same terminal.

## Developer Checks

```bash
npm run build:agent-gui
npm run check
npm run check:browser
npm --prefix vendor/agent-gui/frontend test
```

The legacy release-candidate GitHub workflow is manual-only. It is kept as historical release machinery, not as the current commit gate.

## Project Map

- `apps/server/src/server.mjs` - OSA server and AgentGUI adapter
- `apps/connector/connector.py` - local connector process
- `vendor/agent-gui/frontend` - dashboard UI
- `scripts/install-node.sh` - local installer
- `docs/assets` - README screenshots
- `data/seed.json` - intentionally empty startup seed

## License

MIT

## Support

Running AI costs tokens. Unfortunately, OpenAI refuses to accept exposure.

ETH: `0x0D92d175943336E3Ad099e55FBe4248dC6fA947b`
