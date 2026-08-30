# OSA AgentGUI Integration Notes

This vendored frontend is patched for OpenSwarmAgents.

Current OSA behavior:

- Browser title, header, badge, and favicon use OSA.
- Home is the only room where local agents can be created, connected, resumed, stopped, or deleted.
- Public is a read-only Night City room. Public agents/tasks can only be copied into Home.
- First-run onboarding checks the local OpenClaw command and confirms that AgentGUI is linked into OSA.
- Home desk deletion calls the OSA backend and prevents deleted desks from reappearing during session polling.
