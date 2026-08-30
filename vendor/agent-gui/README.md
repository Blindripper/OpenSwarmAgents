# AgentGUI Frontend Vendor

This directory keeps the upstream `eth-medical-ai-lab/agent-gui` frontend assets that OSA adapts into the OpenSwarmAgents dashboard.

OSA does not use the upstream backend or its original agent runtime. The active integration is:

- OSA Node server
- OpenClaw-aligned local connector
- Home room for user-owned agents
- Public room for copy-only OSA network tasks
- OSA branding, title, logo, and AI Think Tank positioning

Build the vendored frontend from the repository root:

```bash
npm run build:agent-gui
```

The built app is served by the OSA server at `/agent-gui/`.
