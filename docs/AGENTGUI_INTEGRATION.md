# AgentGUI Integration

OSA uses AgentGUI as the upstream dashboard direction.

Upstream:

- Repository: `https://github.com/eth-medical-ai-lab/agent-gui`
- Local pin: `vendor/agent-gui`
- License: MIT, Copyright (c) 2026 ETH Zurich, Medical AI Lab

## Why Not An Iframe

AgentGUI is not a standalone widget. It is a full Vite/React frontend. OSA now replaces the upstream worker/server assumptions with an OpenClaw-aligned adapter, OSA session state, WebSocket activity streams, and Home/Public room semantics.

OSA already has its own Node server, auth/session model, connector tokens, federation/trust ledger, local tasks, public network tasks, reviews, and published artifacts. Embedding the hosted AgentGUI page would only show a demo and would not observe OSA agents.

## Integration Shape

The current architecture is:

1. Keep AgentGUI frontend source as the visual/workbench upstream.
2. Build the AgentGUI Vite frontend into `vendor/agent-gui/frontend/dist`.
3. Serve the built workbench from the OSA Node server at `/agent-gui/`.
4. Redirect the clean dashboard root `/` to `/agent-gui/`.
5. Expose OSA state through AgentGUI-shaped HTTP and WebSocket endpoints.

Mapping:

- OSA Home room -> AgentGUI `Home` team
- OSA Public room -> AgentGUI `Public` team
- OSA `task` -> AgentGUI `desk/session`
- OSA `agent` / connector -> AgentGUI `agent profile` / desk occupant
- OSA `event` -> AgentGUI `activity event`
- OSA `result` / `review` -> AgentGUI activity/audit state

## Adapter Surface

The OSA-backed AgentGUI workbench supports:

- `GET /api/gui-config`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/activity`
- `GET /api/sessions/:id/overview`
- `GET /api/sessions/:id/todos`
- `GET /api/agents`
- `GET /api/agents/prototypes`
- `GET /api/toolsets`
- `POST /api/sessions/:id/resume`
- `POST /api/sessions/:id/interrupt`
- `POST /api/sessions/new`
- WebSocket bridge for `/ws/activity/:id`, `/ws/terminal/:id`, `/ws/console/:id`, and `/ws/tail/:id`

OSA keeps its existing `/api/state` contract for connector and federation compatibility. The clean root opens AgentGUI.

## Current Status

The OSA dashboard now uses the real AgentGUI frontend with exactly two OSA rooms:

- `Home`: create and run your own local agents.
- `Public`: watch active OSA network tasks in the Night City layout and copy interesting agents/tasks into Home.

The upstream start flow is adapted to OSA: `POST /api/sessions/new` creates a Home task, mints a scoped connector token, and starts a managed local OpenClaw connector. `POST /api/sessions/:id/copy` clones a Public task into Home without steering the remote Public agent. The default AgentGUI profile is `Codex / OpenClaw`; `Codex CLI` is available as a second local connector profile.

`GET /api/openclaw/status` drives the first-run setup dialog. It reports whether the vendored frontend is built/linked, which OpenClaw command will be used, and whether Home/Public are ready for local work. `DELETE /api/sessions/:id` is implemented for Home desks and marks the backing OSA task as deleted so polling cannot resurrect removed subagents. Public desks remain copy-only.

Branding is patched in the frontend build so the browser title, favicon, app header, and right-side badge use OSA and the OSA logo instead of Agent GUI.

`npm run build:agent-gui` rebuilds the upstream frontend for the `/agent-gui/` base path.
