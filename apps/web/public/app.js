const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" }
];

const CONNECTOR_RUNNERS = ["stub", "openclaw", "codex", "provider"];
const THEME_STORAGE_KEY = "osaTheme";
const DONATION_ADDRESS = "0x0D92d175943336E3Ad099e55FBe4248dC6fA947b";
const DONATION_AMOUNT_WEI = 2_000_000_000_000_000n;

let realtimeSource = null;
let realtimeConnected = false;
let realtimeRefreshTimer = null;

const state = {
  selectedGoalId: null,
  view: "worker",
  theme: initialTheme(),
  lastVote: null,
  user: loadStoredUser(),
  data: null,
  authConfig: {
    providers: [],
    auth: {
      localLoginEnabled: true,
      devLoginEnabled: true,
      localPasswordRequired: false,
      authMode: "local",
      oauthRequired: false
    }
  }
};

const els = {
  navWorker: document.querySelector("#nav-worker"),
  navVoting: document.querySelector("#nav-voting"),
  navResults: document.querySelector("#nav-results"),
  navAccount: document.querySelector("#nav-account"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeLabel: document.querySelector("#theme-label"),
  authGate: document.querySelector("#auth-gate"),
  authFeedback: document.querySelector("#auth-feedback"),
  authDevForm: document.querySelector("#auth-dev-form"),
  authEmail: document.querySelector("#auth-email"),
  authName: document.querySelector("#auth-name"),
  authPassword: document.querySelector("#auth-password"),
  oauthGithub: document.querySelector("#oauth-github"),
  oauthGoogle: document.querySelector("#oauth-google"),
  donateButton: document.querySelector("#donate-button"),
  donationStatus: document.querySelector("#donation-status"),
  votingSidebar: document.querySelector("#voting-sidebar"),
  resultsSidebar: document.querySelector("#results-sidebar"),
  accountSidebar: document.querySelector("#account-sidebar"),
  supportSidebar: document.querySelector("#support-sidebar"),
  githubSidebar: document.querySelector("#github-sidebar"),
  workerView: document.querySelector("#worker-view"),
  votingView: document.querySelector("#voting-view"),
  resultsView: document.querySelector("#results-view"),
  accountView: document.querySelector("#account-view"),
  goalTitle: document.querySelector("#goal-title"),
  goalDescription: document.querySelector("#goal-description"),
  metrics: document.querySelector("#metrics"),
  tasks: document.querySelector("#tasks"),
  agents: document.querySelector("#agents"),
  results: document.querySelector("#results"),
  claims: document.querySelector("#claims"),
  proposals: document.querySelector("#proposals"),
  resultPool: document.querySelector("#result-pool"),
  connectorFeedback: document.querySelector("#connector-feedback"),
  voteFeedback: document.querySelector("#vote-feedback"),
  events: document.querySelector("#events"),
  taskCount: document.querySelector("#task-count"),
  agentCount: document.querySelector("#agent-count"),
  resultCount: document.querySelector("#result-count"),
  claimCount: document.querySelector("#claim-count"),
  proposalCount: document.querySelector("#proposal-count"),
  voteCount: document.querySelector("#vote-count"),
  resultPoolCount: document.querySelector("#result-pool-count"),
  serverTime: document.querySelector("#server-time"),
  connectVotingAgent: document.querySelector("#connect-voting-agent"),
  proposalForm: document.querySelector("#proposal-form"),
  proposalTitle: document.querySelector("#proposal-title"),
  proposalDescription: document.querySelector("#proposal-description"),
  networkOverview: document.querySelector("#network-overview"),
  networkHeadline: document.querySelector("#network-headline"),
  networkSubline: document.querySelector("#network-subline"),
  networkLive: document.querySelector("#network-live"),
  networkPrimaryLabel: document.querySelector("#network-primary-label"),
  networkPrimary: document.querySelector("#network-primary"),
  networkSecondaryLabel: document.querySelector("#network-secondary-label"),
  networkSecondary: document.querySelector("#network-secondary"),
  networkTertiaryLabel: document.querySelector("#network-tertiary-label"),
  networkTertiary: document.querySelector("#network-tertiary"),
  accountFeedback: document.querySelector("#account-feedback"),
  accountForm: document.querySelector("#account-form"),
  accountEmail: document.querySelector("#account-email"),
  accountName: document.querySelector("#account-name"),
  accountPassword: document.querySelector("#account-password"),
  accountStatus: document.querySelector("#account-status"),
  accountLogout: document.querySelector("#account-logout"),
  apiKeyForm: document.querySelector("#api-key-form"),
  apiKeyOpenai: document.querySelector("#api-key-openai"),
  apiKeyAnthropic: document.querySelector("#api-key-anthropic"),
  apiKeyGemini: document.querySelector("#api-key-gemini"),
  connectorRunner: document.querySelector("#connector-runner"),
  apiProviderDefault: document.querySelector("#api-provider-default"),
  apiKeyStatus: document.querySelector("#api-key-status"),
  apiKeyClear: document.querySelector("#api-key-clear"),
  connectorTokenCount: document.querySelector("#connector-token-count"),
  connectorTokenList: document.querySelector("#connector-token-list"),
  trustEventCount: document.querySelector("#trust-event-count"),
  trustNodeId: document.querySelector("#trust-node-id"),
  trustHeadHash: document.querySelector("#trust-head-hash"),
  trustFederationMode: document.querySelector("#trust-federation-mode"),
  trustPeerCount: document.querySelector("#trust-peer-count"),
  trustPublicKey: document.querySelector("#trust-public-key"),
  trustPeerJson: document.querySelector("#trust-peer-json"),
  trustCopyPeer: document.querySelector("#trust-copy-peer"),
  trustPeerInput: document.querySelector("#trust-peer-input"),
  trustPeerFeedback: document.querySelector("#trust-peer-feedback"),
  trustPeerConfig: document.querySelector("#trust-peer-config"),
  trustCopyConfig: document.querySelector("#trust-copy-config"),
  trustLedger: document.querySelector("#trust-ledger")
};

els.navWorker.addEventListener("click", () => setView("worker"));
els.navVoting.addEventListener("click", () => setView("voting"));
els.navResults.addEventListener("click", () => setView("results"));
els.navAccount.addEventListener("click", () => setView("account"));
els.themeToggle.addEventListener("click", () => toggleTheme());
els.oauthGithub.addEventListener("click", () => startOAuth("github"));
els.oauthGoogle.addEventListener("click", () => startOAuth("google"));
els.donateButton.addEventListener("click", () => donateEth());
els.trustCopyPeer.addEventListener("click", () => copyTrustPeerJson());
els.trustPeerInput.addEventListener("input", () => renderPeerTrustConfig());
els.trustCopyConfig.addEventListener("click", () => copyPeerTrustConfig());
els.connectorTokenList.addEventListener("click", (event) => handleConnectorTokenAction(event));

els.authDevForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await signIn(els.authEmail.value, els.authName.value, els.authPassword.value);
});

els.connectVotingAgent.addEventListener("click", async () => {
  if (!requireAccount("Sign in before letting your agent vote.")) return;
  if (!requireProviderKey("Add at least one provider API key before letting your agent vote.")) return;
  els.connectVotingAgent.disabled = true;
  showVoteFeedback({
    label: "Agent Decision",
    title: "Agent is evaluating proposals",
    reason: "Your agent is reading Project Votes and choosing the strongest project."
  });
  try {
    const response = await post("/api/voting/connect", {
      agentId: localStorage.getItem("agentswarmVotingAgentId"),
      name: `Voting Agent ${Math.floor(Math.random() * 900 + 100)}`,
      models: [`browser-voter:${preferredProvider()}`],
      provider: preferredProvider(),
      providers: enabledProviders()
    });
    localStorage.setItem("agentswarmVotingAgentId", response.agent.id);
    state.lastVote = response.decision
      ? {
          vote: response.vote,
          agent: response.agent,
          proposal: {
            id: response.decision.proposalId,
            title: response.decision.proposalTitle
          },
          reason: response.decision.reason,
          alreadyVoted: response.decision.alreadyVoted
        }
      : null;
    await refresh();
    els.voteFeedback.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    showVoteFeedback({
      label: "Agent Decision",
      title: "Vote failed",
      reason: error.message || "The voting agent could not cast a vote."
    });
  } finally {
    els.connectVotingAgent.disabled = false;
  }
});

els.proposalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAccount("Sign in before submitting project proposals.")) return;
  await post("/api/proposals", {
    title: els.proposalTitle.value,
    description: els.proposalDescription.value
  });
  els.proposalForm.reset();
  await refresh();
});

els.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await signIn(els.accountEmail.value, els.accountName.value, els.accountPassword.value);
});

async function signIn(email, name, password = "") {
  if (!(state.authConfig.auth.localLoginEnabled ?? state.authConfig.auth.devLoginEnabled)) {
    showAuthFeedback("Local login disabled", "This node is configured for external authentication.");
    return;
  }
  const response = await post("/api/auth/login", { email, name, password });
  localStorage.removeItem("agentswarmSessionToken");
  localStorage.setItem("agentswarmUser", JSON.stringify(response.user));
  state.user = response.user;
  showAccountFeedback("Signed in", `${response.user.name} is now connected to OpenSwarmAgents.`);
  showAuthFeedback("Signed in", "Opening the OSA network console.");
  els.authPassword.value = "";
  els.accountPassword.value = "";
  if (state.view === "account") state.view = "worker";
  await refresh();
  render();
}

async function startOAuth(provider) {
  const label = provider === "github" ? "GitHub" : "Google";
  try {
    const payload = await loadAuthConfig();
    const item = (payload.providers || []).find((candidate) => candidate.id === provider);
    if (!item?.configured) {
      showAuthFeedback(
        `${label} OAuth is not configured yet`,
        `Add ${item?.clientIdEnv || "provider client id"} and ${item?.clientSecretEnv || "provider client secret"} on the server, then this button will use the real OAuth redirect.`
      );
      return;
    }
    window.location.href = item.startUrl;
  } catch (error) {
    showAuthFeedback("OAuth start failed", error.message || "The OAuth provider could not be reached.");
  }
}

async function loadAuthConfig() {
  const response = await fetch("/api/auth/oauth/providers", { cache: "no-store" });
  state.authConfig = await response.json();
  renderAuthControls();
  return state.authConfig;
}

async function donateEth() {
  const ethereum = window.ethereum;
  if (!ethereum?.request) {
    setDonationStatus("No wallet detected. Open this page in MetaMask or another Ethereum wallet browser.");
    window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
    return;
  }

  els.donateButton.disabled = true;
  setDonationStatus("Opening wallet...");
  try {
    const [from] = await ethereum.request({ method: "eth_requestAccounts" });
    if (!from) throw new Error("No wallet account selected.");

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }]
      });
    } catch (error) {
      if (error?.code === 4001) throw new Error("Ethereum Mainnet switch was cancelled.");
      if (error?.code === 4902) throw new Error("Ethereum Mainnet is not available in this wallet.");
    }

    setDonationStatus("Please confirm the 0.002 ETH transaction in your wallet.");
    const txHash = await ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: DONATION_ADDRESS,
          value: `0x${DONATION_AMOUNT_WEI.toString(16)}`
        }
      ]
    });
    setDonationStatus(`Thank you. Transaction submitted: ${shortHash(txHash)}`);
  } catch (error) {
    setDonationStatus(error?.message || "Wallet transaction was cancelled.");
  } finally {
    els.donateButton.disabled = false;
  }
}

function setDonationStatus(message) {
  els.donationStatus.textContent = message;
  els.donationStatus.classList.toggle("active", Boolean(message));
}

els.accountLogout.addEventListener("click", async () => {
  await post("/api/auth/logout", {});
  localStorage.removeItem("agentswarmSessionToken");
  localStorage.removeItem("agentswarmUser");
  localStorage.removeItem("agentswarmWorkerAgentId");
  localStorage.removeItem("agentswarmWorkerConnectorId");
  localStorage.removeItem("agentswarmWorkerGoalId");
  localStorage.removeItem("agentswarmVotingAgentId");
  state.user = null;
  closeRealtimeStream();
  showAccountFeedback("Signed out", "Local session cleared. Your BYOK API key remains local until you clear it.");
  render();
});

els.apiKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const current = providerKeyring();
  const updates = {
    openai: els.apiKeyOpenai.value.trim(),
    anthropic: els.apiKeyAnthropic.value.trim(),
    gemini: els.apiKeyGemini.value.trim()
  };
  const next = { ...current };
  for (const [provider, value] of Object.entries(updates)) {
    if (value) next[provider] = value;
  }
  const runner = selectedConnectorRunner();
  localStorage.setItem("agentswarmConnectorRunner", runner);
  localStorage.setItem("agentswarmDefaultProvider", els.apiProviderDefault.value);
  if (!Object.keys(next).length) {
    if (runner === "provider") {
      showAccountFeedback("Provider key missing", "Paste at least one provider API key before using the provider connector runner.");
      return;
    }
    showAccountFeedback("Connector runner saved", "No provider key was saved. This is fine for Stub, OpenClaw, and Codex runners.");
    render();
    return;
  }
  localStorage.setItem("agentswarmProviderKeys", JSON.stringify(next));
  clearProviderInputs();
  showAccountFeedback("Provider keys saved locally", "Keys are stored only in this browser and were not sent to the OSA server.");
  render();
});

els.apiKeyClear.addEventListener("click", () => {
  localStorage.removeItem("agentswarmProviderKeys");
  localStorage.removeItem("agentswarmOpenAIKey");
  clearProviderInputs();
  showAccountFeedback("Provider keys cleared", "All local BYOK provider keys were removed from this browser.");
  render();
});

els.connectorRunner.addEventListener("change", () => {
  localStorage.setItem("agentswarmConnectorRunner", selectedConnectorRunner());
  render();
});

function setView(view) {
  state.view = view;
  window.location.hash = view;
  render();
}

async function refresh() {
  const response = await fetch("/api/state", { cache: "no-store", headers: sessionHeaders() });
  state.data = await response.json();
  if (state.data.viewer) {
    state.user = state.data.viewer;
    localStorage.setItem("agentswarmUser", JSON.stringify(state.user));
  } else if (state.user) {
    state.user = null;
    localStorage.removeItem("agentswarmSessionToken");
    localStorage.removeItem("agentswarmUser");
  }
  const activeGoals = activeWorkerGoals();
  const connectedGoalId = localStorage.getItem("agentswarmWorkerGoalId");
  if (connectedGoalId && !activeGoals.some((goal) => goal.id === connectedGoalId)) {
    localStorage.removeItem("agentswarmWorkerAgentId");
    localStorage.removeItem("agentswarmWorkerConnectorId");
    localStorage.removeItem("agentswarmWorkerGoalId");
  }
  if (!activeGoals.some((goal) => goal.id === state.selectedGoalId)) {
    state.selectedGoalId = activeGoals[0]?.id || null;
  }
  syncRealtimeStream();
  render();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || response.statusText);
  }
  return response.json();
}

function sessionHeaders() {
  return {};
}

function syncRealtimeStream() {
  if (!isAuthenticated()) {
    closeRealtimeStream();
    return;
  }
  if (realtimeSource || typeof EventSource === "undefined") return;

  realtimeSource = new EventSource("/api/events/stream");
  realtimeSource.addEventListener("open", () => {
    setRealtimeConnected(true);
  });
  realtimeSource.addEventListener("connected", () => {
    setRealtimeConnected(true);
  });
  realtimeSource.addEventListener("activity", () => {
    setRealtimeConnected(true);
    scheduleRealtimeRefresh();
  });
  realtimeSource.addEventListener("heartbeat", () => {
    setRealtimeConnected(true);
  });
  realtimeSource.addEventListener("error", () => {
    setRealtimeConnected(false);
    if (realtimeSource?.readyState === EventSource.CLOSED) {
      closeRealtimeStream();
    }
  });
}

function closeRealtimeStream() {
  if (realtimeSource) {
    realtimeSource.close();
    realtimeSource = null;
  }
  setRealtimeConnected(false);
  if (realtimeRefreshTimer) {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
  }
}

function setRealtimeConnected(connected) {
  realtimeConnected = connected;
  renderRealtimeStatus();
}

function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;
  realtimeRefreshTimer = setTimeout(async () => {
    realtimeRefreshTimer = null;
    await refresh();
  }, 120);
}

function render() {
  if (!state.data) return;
  renderShell();
  if (!isAuthenticated()) {
    renderThemeToggle();
    return;
  }
  renderSelectedGoal();
  renderNetworkOverview();
  renderMetrics();

  const goalId = state.selectedGoalId;
  const tasks = state.data.tasks.filter((item) => item.goalId === goalId);
  const agents = state.data.agents.filter((item) => item.goalId === goalId);
  const results = state.data.results
    .filter((item) => item.goalId === goalId)
    .filter((item) => item.status !== "accepted");
  const claims = state.data.claims || [];

  els.taskCount.textContent = `${activeWorkerGoals().length} projects`;
  els.agentCount.textContent = `${agents.length}`;
  els.resultCount.textContent = `${results.length}`;
  els.claimCount.textContent = `${claims.length} claims`;
  els.proposalCount.textContent = `${state.data.proposals.length} proposals`;
  els.voteCount.textContent = `${(state.data.proposalVotes || []).length} votes`;
  els.resultPoolCount.textContent = `${(state.data.resultPool || []).length} results`;
  renderRealtimeStatus();

  renderWorkerProjects(activeWorkerGoals());
  renderStoredConnectorFeedback();
  renderAgents(agents);
  renderResults(results);
  renderClaims(claims);
  renderProposals(state.data.proposals);
  renderResultPool(state.data.resultPool || []);
  renderAccount();
  renderTrustLedger();
  renderVoteFeedback();
  renderEvents(filteredEvents());
}

function renderRealtimeStatus() {
  if (!state.data || !els.serverTime) return;
  const realtimeLabel = realtimeConnected ? "Realtime live" : "Polling fallback";
  els.serverTime.textContent = `${new Date(state.data.serverTime).toLocaleTimeString()} · ${realtimeLabel}`;
  els.serverTime.classList.toggle("live", realtimeConnected);
  els.serverTime.classList.toggle("polling", !realtimeConnected);
  els.serverTime.setAttribute("aria-label", realtimeConnected ? "Realtime updates connected" : "Realtime disconnected, polling every five seconds");
  els.serverTime.title = realtimeConnected
    ? "Realtime SSE stream connected"
    : "Realtime SSE stream is disconnected; refreshing every 5 seconds.";
}

function renderShell() {
  const authenticated = isAuthenticated();
  const isWorker = state.view === "worker";
  const isVoting = state.view === "voting";
  const isResults = state.view === "results";
  const isAccount = state.view === "account";
  document.querySelector(".shell")?.classList.toggle("locked", !authenticated);
  els.authGate.classList.toggle("hidden", authenticated);
  els.metrics.classList.add("hidden");
  document.querySelector(".events-panel")?.classList.toggle("hidden", !authenticated);
  els.navWorker.disabled = !authenticated;
  els.navVoting.disabled = !authenticated;
  els.navResults.disabled = !authenticated;
  els.navAccount.disabled = !authenticated;
  setNavButtonState(els.navWorker, authenticated && isWorker);
  setNavButtonState(els.navVoting, authenticated && isVoting);
  setNavButtonState(els.navResults, authenticated && isResults);
  setNavButtonState(els.navAccount, authenticated && isAccount);
  els.workerView.classList.toggle("active", authenticated && isWorker);
  els.votingView.classList.toggle("active", authenticated && isVoting);
  els.resultsView.classList.toggle("active", authenticated && isResults);
  els.accountView.classList.toggle("active", authenticated && isAccount);
  els.votingSidebar.classList.toggle("hidden", !authenticated || !isVoting);
  els.resultsSidebar.classList.toggle("hidden", !authenticated || !isResults);
  els.accountSidebar.classList.toggle("hidden", !authenticated || !isAccount);
  els.supportSidebar?.classList.toggle("hidden", authenticated && !isAccount);
  els.githubSidebar?.classList.toggle("hidden", authenticated && !isAccount);
  els.networkOverview.classList.toggle("hidden", !authenticated);
  renderAuthControls();
  renderThemeToggle();
}

function setNavButtonState(button, active) {
  button.classList.toggle("active", active);
  if (active) {
    button.setAttribute("aria-current", "page");
  } else {
    button.removeAttribute("aria-current");
  }
}

function renderAuthControls() {
  const localLoginEnabled = Boolean(state.authConfig.auth?.localLoginEnabled ?? state.authConfig.auth?.devLoginEnabled);
  const passwordRequired = Boolean(state.authConfig.auth?.localPasswordRequired);
  els.authDevForm.classList.toggle("hidden", !localLoginEnabled);
  els.accountForm.classList.toggle("dev-login-disabled", !localLoginEnabled);
  els.authPassword.required = passwordRequired;
  els.accountPassword.required = passwordRequired;
  els.authPassword.placeholder = passwordRequired ? "At least 12 characters" : "Optional on this node";
  els.accountPassword.placeholder = passwordRequired ? "At least 12 characters" : "Optional on this node";
  const configuredProviders = state.authConfig.providers?.filter((provider) => provider.configured) || [];
  els.oauthGithub.classList.toggle(
    "not-configured",
    !state.authConfig.providers?.some((provider) => provider.id === "github" && provider.configured)
  );
  els.oauthGoogle.classList.toggle(
    "not-configured",
    !state.authConfig.providers?.some((provider) => provider.id === "google" && provider.configured)
  );
  if (!localLoginEnabled && !configuredProviders.length && !state.user) {
    showAuthFeedback("External auth setup required", "This node has local login disabled and no external auth provider configured yet.");
  }
}

function isAuthenticated() {
  return Boolean(state.user);
}

function initialTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  applyTheme();
  renderThemeToggle();
}

function renderThemeToggle() {
  if (!els.themeToggle) return;
  const isDark = state.theme === "dark";
  els.themeToggle.classList.toggle("active", isDark);
  els.themeLabel.textContent = isDark ? "Light mode" : "Dark mode";
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
}

async function connectWorkerGoal(goal) {
  if (!requireAccount("Sign in before connecting your agent to a worker project.")) return;
  const runner = selectedConnectorRunner();
  if (runner === "provider" && !requireProviderKey("Add at least one provider API key before using the provider connector runner.")) return;
  if (localStorage.getItem("agentswarmWorkerGoalId")) return;
  showConnectorFeedback({
    title: "Creating connector token",
    reason: `Preparing a scoped connector command for ${goal.title}.`
  });
  const provider = runner === "provider" ? preferredProvider() : "unknown";
  const providers = runner === "provider" ? enabledProviders() : [];
  const response = await post("/api/connectors/token", {
    mode: "worker",
    name: `${state.user?.name || "Local"} Worker Agent`,
    goalId: goal.id,
    capabilities: ["research", "review", "synthesis"],
    models: [`connector:${runner}`],
    provider,
    providers
  });
  localStorage.setItem("agentswarmWorkerConnectorId", response.connector.id);
  localStorage.setItem("agentswarmWorkerGoalId", goal.id);
  state.selectedGoalId = goal.id;
  showConnectorFeedback({
    title: `Connector ready for ${goal.title}`,
    reason: connectorReason(runner),
    command: connectorCommand(response.token, goal.id, runner)
  });
  await refresh();
}

async function disconnectWorkerGoal(goal) {
  const connectedGoalId = localStorage.getItem("agentswarmWorkerGoalId");
  const agentId = localStorage.getItem("agentswarmWorkerAgentId");
  const connectorId = localStorage.getItem("agentswarmWorkerConnectorId");
  if (connectedGoalId !== goal.id || (!agentId && !connectorId)) return;
  if (connectorId) {
    await post(`/api/connectors/${connectorId}/revoke`, {});
  } else if (agentId) {
    await post(`/api/agents/${agentId}/disconnect`, {});
  }
  localStorage.removeItem("agentswarmWorkerAgentId");
  localStorage.removeItem("agentswarmWorkerConnectorId");
  localStorage.removeItem("agentswarmWorkerGoalId");
  showConnectorFeedback({
    title: "Connector disconnected",
    reason: `${goal.title} is no longer linked to this browser.`
  });
  await refresh();
}

function connectorCommand(token, goalId, runner = selectedConnectorRunner()) {
  const server = window.location.origin;
  const base = `python3 apps/connector/connector.py --server ${server} --connector-token ${token} --goal ${goalId}`;
  if (runner === "provider") {
    const provider = preferredProvider();
    const providers = enabledProviders().join(",");
    return `${base} --runner provider --provider ${provider} --providers ${providers} --no-fallback-to-stub`;
  }
  if (runner === "openclaw") {
    return `${base} --runner openclaw --agent-name "Local OpenClaw Agent"`;
  }
  if (runner === "codex") {
    return `${base} --runner codex --agent-name "Local Codex Agent"`;
  }
  return `${base} --runner stub`;
}

function connectorCommandForToken(token, connector) {
  const runner = connectorRunnerFromMetadata(connector);
  const goalFlag = connector.mode === "voting" ? "--voting-pool" : `--goal ${connector.goalId}`;
  const base = `python3 apps/connector/connector.py --server ${window.location.origin} --connector-token ${token} ${goalFlag}`;
  if (runner === "provider") {
    const provider = connector.provider && connector.provider !== "unknown" ? connector.provider : preferredProvider();
    const providers = (connector.providers?.length ? connector.providers : [provider]).join(",");
    return `${base} --runner provider --provider ${provider} --providers ${providers} --no-fallback-to-stub`;
  }
  if (runner === "openclaw") {
    return `${base} --runner openclaw --agent-name "${escapeShellDouble(connector.name || "Local OpenClaw Agent")}"`;
  }
  if (runner === "codex") {
    return `${base} --runner codex --agent-name "${escapeShellDouble(connector.name || "Local Codex Agent")}"`;
  }
  return `${base} --runner stub`;
}

function connectorRunnerFromMetadata(connector) {
  const model = (connector.models || []).find((item) => String(item).startsWith("connector:"));
  const runner = String(model || "").replace("connector:", "");
  return CONNECTOR_RUNNERS.includes(runner) ? runner : selectedConnectorRunner();
}

function escapeShellDouble(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`");
}

function connectorReason(runner = selectedConnectorRunner()) {
  if (runner === "provider") {
    return `Run this command on the machine where your agent should work. Set ${providerEnvName(preferredProvider())} in that terminal first. The raw token is shown only once.`;
  }
  if (runner === "openclaw") {
    return "Run this on a machine with the OpenClaw CLI configured. The raw token is shown only once.";
  }
  if (runner === "codex") {
    return "Run this on a machine with the Codex CLI configured. The raw token is shown only once.";
  }
  return "Run this no-key demo connector to exercise the local OSA task, result, review, and publication loop. The raw token is shown only once.";
}

function showConnectorFeedback({ title, reason, command = "" }) {
  els.connectorFeedback.classList.remove("hidden");
  els.connectorFeedback.innerHTML = `
    <div>
      <span class="section-label">Connector</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
      ${
        command
          ? `<div class="command-shell"><code class="command-block">${escapeHtml(command)}</code><button class="copy-command" type="button">Copy command</button></div>`
          : ""
      }
    </div>
  `;
  const copyButton = els.connectorFeedback.querySelector(".copy-command");
  const commandBlock = els.connectorFeedback.querySelector(".command-block");
  if (copyButton && commandBlock) {
    copyButton.addEventListener("click", () => copyConnectorCommand(copyButton, commandBlock.textContent || ""));
  }
}

async function copyConnectorCommand(button, command) {
  await copyText(button, command);
}

async function copyText(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  } catch {
    button.textContent = "Select text";
    setTimeout(() => {
      button.textContent = original;
    }, 2200);
  }
}

function renderStoredConnectorFeedback() {
  if (state.view !== "worker") {
    els.connectorFeedback.classList.add("hidden");
    return;
  }
  if (!els.connectorFeedback.classList.contains("hidden")) return;
  const goalId = localStorage.getItem("agentswarmWorkerGoalId");
  const connectorId = localStorage.getItem("agentswarmWorkerConnectorId");
  const goal = state.data.goals.find((item) => item.id === goalId);
  if (!goalId || !connectorId || !goal) return;
  showConnectorFeedback({
    title: `Connector exists for ${goal.title}`,
    reason: "The raw connector token was shown only when it was created and is not stored in this browser. Disconnect and reconnect to rotate the token and generate a fresh command."
  });
}

function requireAccount(message) {
  if (isAuthenticated()) return true;
  setView("account");
  showAccountFeedback("Account required", message);
  showAuthFeedback("Account required", message);
  return false;
}

function requireProviderKey(message) {
  if (hasProviderKey()) return true;
  setView("account");
  showAccountFeedback("BYOK key required", message);
  return false;
}

function hasProviderKey() {
  return enabledProviders().length > 0;
}

function selectedConnectorRunner() {
  const value = els.connectorRunner?.value || localStorage.getItem("agentswarmConnectorRunner") || "stub";
  return CONNECTOR_RUNNERS.includes(value) ? value : "stub";
}

function renderAccount() {
  const user = state.user;
  const providers = enabledProviders();
  els.accountStatus.textContent = user ? `Signed in as ${user.name}` : "Not signed in";
  els.apiKeyStatus.textContent = providers.length ? `${providers.length}/${PROVIDERS.length} local` : "No keys";
  els.accountLogout.disabled = !user;
  els.apiProviderDefault.value = preferredProvider();
  els.connectorRunner.value = selectedConnectorRunner();
  if (user) {
    els.accountEmail.value = user.email || "";
    els.accountName.value = user.name || "";
  }
  renderConnectorTokens();
}

function renderConnectorTokens() {
  const connectors = state.data.viewerConnectors || [];
  const activeCount = connectors.filter((connector) => connector.status === "active").length;
  els.connectorTokenCount.textContent = connectors.length
    ? `${activeCount} active · ${connectors.length} total`
    : "No tokens";
  renderList(
    els.connectorTokenList,
    connectors,
    (connector) => `
      <div class="connector-token-row item">
        <div class="item-head">
          <strong>${escapeHtml(connector.name || "Connector")}</strong>
          <span class="chip ${escapeHtml(connector.status)}">${escapeHtml(statusLabel(connector.status))}</span>
        </div>
        <p>${escapeHtml(connectorModeLabel(connector))} · ${escapeHtml(connector.goalTitle || connector.goalId || "Unknown project")}</p>
        <div class="chips connector-token-meta">
          <span class="chip">created ${escapeHtml(formatRelativeTime(connector.createdAt))}</span>
          <span class="chip">${Number(connector.useCount || 0)} ${plural("use", Number(connector.useCount || 0))}</span>
          <span class="chip">last ${escapeHtml(connector.lastUsedAt ? formatRelativeTime(connector.lastUsedAt) : "never")}</span>
          <span class="chip">expires ${escapeHtml(formatRelativeTime(connector.expiresAt))}</span>
          ${connector.lastUsedPath ? `<span class="chip">${escapeHtml(connector.lastUsedMethod || "GET")} ${escapeHtml(connector.lastUsedPath)}</span>` : ""}
          ${connector.revokedReason ? `<span class="chip">reason ${escapeHtml(connector.revokedReason)}</span>` : ""}
          ${connector.rotatedFromId ? `<span class="chip">rotated from ${escapeHtml(shortHash(connector.rotatedFromId))}</span>` : ""}
          ${connector.rotatedToId ? `<span class="chip">rotated to ${escapeHtml(shortHash(connector.rotatedToId))}</span>` : ""}
        </div>
        <div class="connector-token-actions">
          <button type="button" data-connector-action="rotate" data-connector-id="${escapeHtml(connector.id)}">Rotate</button>
          <button type="button" data-connector-action="revoke" data-connector-id="${escapeHtml(connector.id)}" ${connector.status === "active" ? "" : "disabled"}>Revoke</button>
        </div>
      </div>
    `,
    {
      title: "No connector tokens yet",
      detail: "Connect a worker project to create a scoped one-time connector command."
    }
  );
}

function connectorModeLabel(connector) {
  return connector.mode === "voting" ? "Project Votes connector" : "Active Work connector";
}

async function handleConnectorTokenAction(event) {
  const button = event.target.closest("[data-connector-action]");
  if (!button) return;
  const connectorId = button.dataset.connectorId;
  const action = button.dataset.connectorAction;
  if (!connectorId || !["rotate", "revoke"].includes(action)) return;
  button.disabled = true;
  try {
    const response = await post(`/api/connectors/${connectorId}/${action}`, {});
    state.data = response.state || state.data;
    if (action === "rotate") {
      const connector = response.connector;
      const command = connectorCommandForToken(response.token, connector);
      showAccountFeedback("Connector rotated", "Use this fresh connector command. The previous token is now revoked.", command);
    } else {
      if (localStorage.getItem("agentswarmWorkerConnectorId") === connectorId) {
        localStorage.removeItem("agentswarmWorkerAgentId");
        localStorage.removeItem("agentswarmWorkerConnectorId");
        localStorage.removeItem("agentswarmWorkerGoalId");
      }
      showAccountFeedback("Connector revoked", "The connector token can no longer control its linked agent.");
    }
    render();
  } catch (error) {
    showAccountFeedback("Connector action failed", error.message || "The connector token could not be updated.");
  } finally {
    button.disabled = false;
  }
}

function showAccountFeedback(title, reason, command = "") {
  els.accountFeedback.classList.remove("hidden");
  els.accountFeedback.innerHTML = `
    <div>
      <span class="section-label">Account</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
      ${
        command
          ? `<div class="command-shell"><code class="command-block">${escapeHtml(command)}</code><button class="copy-command" type="button">Copy command</button></div>`
          : ""
      }
    </div>
  `;
  const copyButton = els.accountFeedback.querySelector(".copy-command");
  const commandBlock = els.accountFeedback.querySelector(".command-block");
  if (copyButton && commandBlock) {
    copyButton.addEventListener("click", () => copyText(copyButton, commandBlock.textContent || ""));
  }
}

function showAuthFeedback(title, reason) {
  els.authFeedback.classList.remove("hidden");
  els.authFeedback.innerHTML = `
    <div>
      <span class="section-label">Authentication</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
    </div>
  `;
}

function renderSelectedGoal() {
  const goal = selectedGoal();
  els.goalTitle.textContent = goal?.title || "No goal selected";
  els.goalDescription.textContent = goal?.description || "";
}

function renderNetworkOverview() {
  const stats = state.data.stats || {};
  const summary = networkSummaryForView(stats);

  els.networkHeadline.textContent = summary.headline;
  els.networkSubline.textContent = summary.subline;
  els.networkLive.textContent = realtimeConnected ? "Live" : "Offline";
  els.networkLive.classList.toggle("live", realtimeConnected);
  els.networkLive.classList.toggle("polling", !realtimeConnected);

  setNetworkFact(els.networkPrimaryLabel, els.networkPrimary, summary.facts[0]);
  setNetworkFact(els.networkSecondaryLabel, els.networkSecondary, summary.facts[1]);
  setNetworkFact(els.networkTertiaryLabel, els.networkTertiary, summary.facts[2]);
}

function networkSummaryForView(stats) {
  if (state.view === "voting") return votingNetworkSummary(stats);
  if (state.view === "results") return resultsNetworkSummary(stats);
  if (state.view === "account") return accountNetworkSummary(stats);
  return workerNetworkSummary(stats);
}

function workerNetworkSummary(stats) {
  const action = workerNextAction(stats);
  const openTasks = stats.openTasks || 0;
  const activeProjects = activeWorkerGoals().length;
  const pendingReviews = stats.pendingReviews || 0;
  const headline =
    pendingReviews > 0 ? "Review results" : openTasks > 0 ? "Active work is running" : "Ready for work";
  const subline =
    openTasks > 0
      ? `${openTasks} open ${plural("task", openTasks)} across ${activeProjects} ${plural("project", activeProjects)}.`
      : "Start with a project idea or connect an agent.";

  return {
    headline,
    subline,
    facts: [
      ["Action", action],
      ["Tasks", String(openTasks)],
      ["Review", pendingReviews ? `${pendingReviews} waiting` : "Clear"]
    ]
  };
}

function votingNetworkSummary(stats) {
  const ideas = stats.votingProposals || 0;
  const votes = (state.data.proposalVotes || []).length;
  return {
    headline: "Project voting",
    subline: ideas ? "Choose the next project to move into Active Work." : "Add a project idea to start voting.",
    facts: [
      ["Action", ideas ? "Ask agent" : "Add idea"],
      ["Ideas", String(ideas)],
      ["Votes", String(votes)]
    ]
  };
}

function resultsNetworkSummary(stats) {
  const published = stats.resultPool || 0;
  const acceptedClaims = stats.acceptedClaims || 0;
  const completed = state.data.goals.filter((goal) => goal.status === "completed").length;
  return {
    headline: "Published results",
    subline: published ? "Accepted work is ready to inspect." : "No accepted results yet.",
    facts: [
      ["Results", String(published)],
      ["Claims", String(acceptedClaims)],
      ["Done", String(completed)]
    ]
  };
}

function accountNetworkSummary(stats) {
  const connectors = state.data.viewerConnectors || [];
  const activeConnectors = connectors.filter((connector) => connector.status === "active").length;
  return {
    headline: "Account",
    subline: "Manage login, connector tokens, and federation trust.",
    facts: [
      ["Status", state.user ? "Signed in" : "Missing"],
      ["Tokens", connectors.length ? `${activeConnectors}/${connectors.length}` : "None"],
      ["Trust", networkTrustLabel(state.data.runtime || {}).label]
    ]
  };
}

function setNetworkFact(labelNode, valueNode, fact) {
  const [label, value] = fact || ["", ""];
  labelNode.textContent = label;
  valueNode.textContent = value;
}

function networkTrustLabel(runtime) {
  if (runtime.federationTrustConfigError) return { label: "Check", detail: "trust config error" };
  const trusted = runtime.federationTrustedNodeCount || 0;
  const configured = runtime.federationPeerCount || 0;
  if (!runtime.federationEnabled) return { label: "Local", detail: "no peers" };
  if (runtime.federationSignatureVerificationEnabled) {
    return { label: "Verified", detail: `${trusted} trusted · ${configured} configured` };
  }
  return { label: "Private", detail: `${configured} configured` };
}

function plural(label, count) {
  return count === 1 ? label : `${label}s`;
}

function renderMetrics() {
  const stats = state.data.stats;
  const promoted = state.data.proposals.filter((proposal) => proposal.status === "promoted").length;
  const metricsByView = {
    worker: [
      ["Next Action", workerNextAction(stats)],
      ["Active Work", `${activeWorkerGoals().length} ${plural("project", activeWorkerGoals().length)}`],
      ["Needs Review", stats.pendingReviews ? `${stats.pendingReviews} waiting` : "Clear"]
    ],
    voting: [
      ["Next Action", stats.votingProposals ? "Ask agent" : "Add idea"],
      ["Ideas Open", `${stats.votingProposals} ${plural("idea", stats.votingProposals)}`],
      ["Votes Cast", `${(state.data.proposalVotes || []).length} total`],
      ["Moved To Work", promoted]
    ],
    results: [
      ["Published", `${stats.resultPool} ${plural("result", stats.resultPool)}`],
      ["Completed Work", state.data.goals.filter((goal) => goal.status === "completed").length],
      ["Verified Claims", stats.acceptedClaims]
    ],
    account: [
      ["Account", state.user ? "Active" : "Missing"],
      ["Provider Keys", hasProviderKey() ? enabledProviders().join(", ") : "Missing"],
      ["Trust", networkTrustLabel(state.data.runtime || {}).label],
      ["Ledger", stats.trustHead ? shortHash(stats.trustHead) : "None"]
    ]
  };
  const metrics = metricsByView[state.view] || metricsByView.worker;

  els.metrics.replaceChildren(
    ...metrics.map(([label, value], index) => {
      const node = document.createElement("div");
      node.className = "metric";
      node.style.setProperty("--metric-color", metricColor(index));
      node.innerHTML = `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
        <div class="metric-icon" aria-hidden="true">${metricIcon(label)}</div>
      `;
      return node;
    })
  );
}

function workerNextAction(stats) {
  if (stats.pendingReviews > 0) return "Review results";
  if (stats.openTasks > 0 && stats.onlineAgents === 0) return "Connect worker";
  if (stats.openTasks > 0) return "Watch agents";
  if (activeWorkerGoals().length > 0) return "Ready";
  return "Add idea";
}

function metricColor(index) {
  return ["var(--primary)", "var(--accent)", "var(--violet)", "var(--amber)", "var(--rose)"][index % 5];
}

function metricIcon(label) {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("agent")) {
    return `<svg viewBox="0 0 24 24"><path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0"/></svg>`;
  }
  if (normalized.includes("vote") || normalized.includes("proposal") || normalized.includes("promoted")) {
    return `<svg viewBox="0 0 24 24"><path d="m9 12 2 2 4-5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/></svg>`;
  }
  if (normalized.includes("result") || normalized.includes("claim") || normalized.includes("review")) {
    return `<svg viewBox="0 0 24 24"><path d="M14 3.5V8a1 1 0 0 0 1 1h4M7 13h10M7 17h7M6.5 21h11A1.5 1.5 0 0 0 19 19.5V8.8L13.8 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21Z"/></svg>`;
  }
  if (normalized.includes("key") || normalized.includes("account") || normalized.includes("user")) {
    return `<svg viewBox="0 0 24 24"><path d="M15 7a4 4 0 1 1-7.5 2M14 14l6-6M17 8h3v3M4.5 20a7.5 7.5 0 0 1 12 0"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24"><path d="M6.5 12.5h11M7 7.5h10M7 17.5h10M5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5Z"/></svg>`;
}

function renderProposals(proposals) {
  const votesByProposal = new Map();
  for (const vote of state.data.proposalVotes || []) {
    const list = votesByProposal.get(vote.proposalId) || [];
    list.push(vote);
    votesByProposal.set(vote.proposalId, list);
  }

  const sorted = [...proposals].sort((a, b) => {
    if (a.status !== b.status) return a.status === "voting" ? -1 : 1;
    return b.votes - a.votes || b.createdAt.localeCompare(a.createdAt);
  });

  renderList(
    els.proposals,
    sorted,
    (proposal) => {
      const votes = votesByProposal.get(proposal.id) || [];
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(proposal.title)}</strong>
            <span class="chip ${proposal.status === "promoted" ? "accepted" : "open"}">${escapeHtml(statusLabel(proposal.status))}</span>
          </div>
          <p>${escapeHtml(proposal.description)}</p>
          <div class="chips">
            <span class="chip">Votes ${proposal.votes}</span>
          </div>
        </div>
      `;
    },
    {
      title: "No proposals are open",
      detail: "Submit a new idea below to start Project Votes."
    }
  );
}

function renderVoteFeedback() {
  if (state.view !== "voting" || !state.lastVote?.proposal) {
    els.voteFeedback.classList.add("hidden");
    els.voteFeedback.replaceChildren();
    return;
  }

  const { vote, agent, proposal, reason, alreadyVoted } = state.lastVote;
  showVoteFeedback({
    label: alreadyVoted ? "Existing Agent Decision" : "Agent Decision",
    title: vote ? `${agent.name} voted for ${proposal.title}` : `${agent.name} found no open proposal`,
    reason: reason || vote?.reason || "The agent selected this proposal as the strongest option in Project Votes."
  });
}

function showVoteFeedback({ label, title, reason }) {
  els.voteFeedback.classList.remove("hidden");
  els.voteFeedback.innerHTML = `
    <div>
      <span class="section-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
    </div>
  `;
}

function renderWorkerProjects(goals) {
  const sortedGoals = sortedWorkerGoals(goals);
  if (!sortedGoals.length) {
    els.tasks.replaceChildren(
      createEmptyState({
        title: "No active worker projects",
        detail: "Submit and rank a proposal in Project Votes to create work."
      })
    );
    return;
  }

  const connectedGoalId = localStorage.getItem("agentswarmWorkerGoalId");
  const hasConnection = Boolean(connectedGoalId);
  els.tasks.replaceChildren(
    ...sortedGoals.map((goal) => {
      const isSelected = state.selectedGoalId === goal.id;
      const isConnected = connectedGoalId === goal.id;
      const projectTasks = state.data.tasks
        .filter((task) => task.goalId === goal.id)
        .filter((task) => !["done", "rejected"].includes(task.status))
        .sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || b.priority - a.priority);
      const connectedWorkers = goalWorkerCount(goal.id);
      const card = document.createElement("article");
      card.className = `worker-project item ${isSelected ? "active" : ""} ${isConnected ? "connected" : ""}`;
      card.setAttribute("aria-label", `${goal.title} worker project`);
      card.innerHTML = `
        <div class="worker-project-head">
          <button class="worker-project-main" type="button" aria-pressed="${isSelected}" aria-label="Select ${escapeHtml(goal.title)}">
            <strong>${escapeHtml(goal.title)}</strong>
            <span>${connectedWorkers} connected workers · ${projectTasks.length} tasks</span>
          </button>
          <div class="worker-project-actions">
            <button class="project-connect primary" type="button" aria-label="Connect worker to ${escapeHtml(goal.title)}" ${hasConnection ? "disabled" : ""}>Connect</button>
            <button class="project-disconnect" type="button" aria-label="Disconnect worker from ${escapeHtml(goal.title)}" ${isConnected ? "" : "disabled"}>Disconnect</button>
          </div>
        </div>
        <p>${escapeHtml(goal.description)}</p>
        <div class="project-task-stack">
          ${projectTasks.map((task) => `
            <div class="project-task-row">
              <strong>${escapeHtml(task.title)}</strong>
              <span class="chip ${task.status}">${escapeHtml(statusLabel(task.status))}</span>
            </div>
          `).join("") || `<div class="empty compact"><strong>No active tasks</strong><span>This project is waiting for new work.</span></div>`}
        </div>
      `;
      card.querySelector(".worker-project-main").addEventListener("click", () => {
        state.selectedGoalId = goal.id;
        render();
      });
      card.querySelector(".project-connect").addEventListener("click", () => connectWorkerGoal(goal));
      card.querySelector(".project-disconnect").addEventListener("click", () => disconnectWorkerGoal(goal));
      return card;
    })
  );
}

function renderAgents(agents) {
  renderList(
    els.agents,
    agents,
    (agent) => `
      <div class="item">
        <div class="item-head">
          <strong>${escapeHtml(agent.name)}</strong>
          <span class="chip ${agent.status}">${escapeHtml(statusLabel(agent.status))}</span>
        </div>
        <p>${escapeHtml((agent.models || []).join(", "))}</p>
        <div class="chips">
          ${(agent.providers || [agent.provider].filter(Boolean)).map((provider) => `<span class="chip">${escapeHtml(provider)}</span>`).join("")}
          ${(agent.capabilities || []).map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`).join("")}
          <span class="chip">accepted ${agent.reputation?.accepted || 0}</span>
          <span class="chip">review ${agent.reputation?.review || 0}</span>
        </div>
      </div>
    `,
    {
      title: "No agents on this project",
      detail: "Create a scoped connector token to bring a worker online."
    }
  );
}

function renderResults(results) {
  renderList(
    els.results,
    [...results].reverse(),
    (result) => {
      const consensus = result.consensus;
      const required = consensus?.requiredCount ?? consensus?.requiredAgentIds?.length ?? 0;
      const accepted = consensus?.acceptedCount ?? consensus?.acceptedAgentIds?.length ?? 0;
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(result.summary || "Untitled result")}</strong>
            <span class="chip ${result.status}">${escapeHtml(statusLabel(result.status))}</span>
          </div>
          <p>${escapeHtml(result.content)}</p>
          <div class="chips">
            ${consensus ? `<span class="chip">${accepted} of ${required} reviewers accepted</span>` : ""}
            <span class="chip">iteration ${result.iteration || 1}</span>
            <span class="chip">confidence ${Math.round(result.confidence * 100)}%</span>
            ${(result.sources || []).map((source) => `<span class="chip">${escapeHtml(source)}</span>`).join("")}
          </div>
          ${renderArtifactList(result.artifacts || [])}
        </div>
      `;
    },
    {
      title: "No results in review yet",
      detail: "Worker outputs appear here when agents submit tasks for review."
    }
  );
}

function renderResultPool(results) {
  const sorted = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderList(
    els.resultPool,
    sorted,
    (result) => `
      <div class="published-result item">
        <div class="item-head">
          <div>
            <strong>${escapeHtml(result.taskTitle)}</strong>
            <span>${escapeHtml(result.goalTitle)}</span>
          </div>
          <span class="chip accepted">Published</span>
        </div>
        <p>${escapeHtml(result.summary)}</p>
        <div class="result-body">${escapeHtml(result.content)}</div>
        ${renderArtifactList(result.artifacts || [], "published")}
        <div class="chips">
          <span class="chip">confidence ${Math.round((result.confidence || 0) * 100)}%</span>
          <span class="chip">${new Date(result.createdAt).toLocaleString()}</span>
          ${(result.sources || []).map((source) => `<span class="chip">${escapeHtml(source)}</span>`).join("")}
        </div>
      </div>
    `,
    {
      title: "No published results yet",
      detail: "Accepted consensus outputs will collect here."
    }
  );
}

function renderArtifactList(artifacts, mode = "compact") {
  if (!artifacts.length) {
    return mode === "published"
      ? `<div class="artifact-list empty-artifacts"><span>No attached artifacts</span></div>`
      : "";
  }

  return `
    <div class="artifact-list ${mode === "published" ? "published-artifacts" : ""}">
      ${artifacts.map(renderArtifact).join("")}
    </div>
  `;
}

function renderArtifact(artifact) {
  const uri = safeArtifactUri(artifact.uri);
  const label = escapeHtml(artifact.name || artifactNameForKind(artifact.kind));
  const description = artifact.description ? `<p>${escapeHtml(artifact.description)}</p>` : "";
  const size = artifact.size ? `<span>${formatBytes(artifact.size)}</span>` : "";
  const open = uri ? `<a href="${escapeHtml(uri)}" target="_blank" rel="noreferrer">Open</a>` : "";
  const preview = artifact.kind === "image" && uri
    ? `<img src="${escapeHtml(uri)}" alt="${label}" loading="lazy" />`
    : `<div class="artifact-icon">${escapeHtml(artifactIcon(artifact.kind))}</div>`;

  return `
    <div class="artifact-card ${escapeHtml(artifact.kind || "file")}">
      ${preview}
      <div>
        <strong>${label}</strong>
        <div class="artifact-meta">
          <span>${escapeHtml(artifact.kind || "file")}</span>
          ${artifact.mimeType ? `<span>${escapeHtml(artifact.mimeType)}</span>` : ""}
          ${size}
        </div>
        ${description}
        ${open}
      </div>
    </div>
  `;
}

function safeArtifactUri(uri) {
  const value = String(uri || "").trim();
  if (!value) return "";
  if (/^(https?:\/\/|\/|data:image\/)/i.test(value)) return value;
  return "";
}

function artifactIcon(kind) {
  return {
    code: "{}",
    image: "IMG",
    pdf: "PDF",
    csv: "CSV",
    spreadsheet: "XLS",
    bundle: "ZIP",
    video: "VID",
    audio: "AUD",
    file: "FILE"
  }[kind] || "FILE";
}

function artifactNameForKind(kind) {
  return {
    code: "Code artifact",
    image: "Image output",
    pdf: "PDF report",
    csv: "CSV dataset",
    spreadsheet: "Spreadsheet",
    bundle: "Artifact bundle",
    video: "Video output",
    audio: "Audio output",
    file: "File artifact"
  }[kind] || "Artifact";
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatRelativeTime(iso) {
  if (!iso) return "never";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "unknown";
  const diffMs = timestamp - Date.now();
  const absMs = Math.abs(diffMs);
  const units = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000]
  ];
  for (const [label, size] of units) {
    if (absMs >= size) {
      const value = Math.round(absMs / size);
      return diffMs < 0 ? `${value} ${plural(label, value)} ago` : `in ${value} ${plural(label, value)}`;
    }
  }
  return diffMs < 0 ? "just now" : "soon";
}

function shortHash(value) {
  const text = String(value || "");
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function providerKeyring() {
  try {
    const keys = JSON.parse(localStorage.getItem("agentswarmProviderKeys") || "{}");
    const legacyOpenAI = localStorage.getItem("agentswarmOpenAIKey");
    if (legacyOpenAI && !keys.openai) {
      keys.openai = legacyOpenAI;
      localStorage.setItem("agentswarmProviderKeys", JSON.stringify(keys));
      localStorage.removeItem("agentswarmOpenAIKey");
    }
    return Object.fromEntries(
      PROVIDERS
        .map((provider) => [provider.id, String(keys[provider.id] || "").trim()])
        .filter(([, value]) => value)
    );
  } catch {
    localStorage.removeItem("agentswarmProviderKeys");
    return {};
  }
}

function enabledProviders() {
  return PROVIDERS.map((provider) => provider.id).filter((provider) => Boolean(providerKeyring()[provider]));
}

function preferredProvider() {
  const enabled = enabledProviders();
  const stored = localStorage.getItem("agentswarmDefaultProvider");
  if (stored && enabled.includes(stored)) return stored;
  return enabled[0] || "openai";
}

function providerEnvName(provider) {
  return {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY"
  }[provider] || "PROVIDER_API_KEY";
}

function clearProviderInputs() {
  els.apiKeyOpenai.value = "";
  els.apiKeyAnthropic.value = "";
  els.apiKeyGemini.value = "";
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("agentswarmUser") || "null");
  } catch {
    localStorage.removeItem("agentswarmUser");
    return null;
  }
}

function renderClaims(claims) {
  renderList(
    els.claims,
    claims,
    (claim) => `
      <div class="item">
        <div class="item-head">
          <strong>${escapeHtml(claim.title)}</strong>
          <span class="chip accepted">${Math.round(claim.confidence * 100)}%</span>
        </div>
        <p>${escapeHtml(claim.statement)}</p>
        <div class="chips">
          ${(claim.sources || []).map((source) => `<span class="chip">${escapeHtml(source)}</span>`).join("")}
        </div>
      </div>
    `,
    {
      title: "No accepted claims yet",
      detail: "Reviewed, source-backed knowledge appears here."
    }
  );
}

function renderEvents(events) {
  renderList(
    els.events,
    events,
    (event) => `
      <div class="event-row">
        <span>${new Date(event.createdAt).toLocaleTimeString()}</span>
        <span><strong>${escapeHtml(eventTitle(event))}</strong> ${escapeHtml(event.message)}</span>
      </div>
    `,
    {
      title: "No visible network activity",
      detail: "Votes, agent work, reviews, published results, and trust updates will appear here."
    }
  );
}

function renderTrustLedger() {
  const runtime = state.data.runtime || {};
  const stats = state.data.stats || {};
  const entries = state.data.trustLedger || [];
  const node = runtime.node || {};
  const peerJson = trustedPeerJson(node);
  els.trustNodeId.textContent = node.nodeId || "-";
  els.trustHeadHash.textContent = stats.trustHead ? shortHash(stats.trustHead) : "-";
  els.trustHeadHash.title = stats.trustHead || "";
  els.trustFederationMode.textContent = federationModeLabel(runtime);
  els.trustPeerCount.textContent = `${runtime.federationTrustedNodeCount || 0} trusted · ${runtime.federationPeerCount || 0} configured`;
  els.trustPeerCount.title = runtime.federationTrustConfigError || "";
  els.trustPublicKey.textContent = node.publicKeyPem ? compactPublicKey(node.publicKeyPem) : "-";
  els.trustPublicKey.title = node.publicKeyPem || "";
  els.trustPeerJson.textContent = peerJson;
  els.trustEventCount.textContent = `${stats.trustEvents || 0} events`;
  renderPeerTrustConfig();
  renderList(
    els.trustLedger,
    entries.slice(0, 8),
    (entry) => `
      <div class="trust-ledger-row">
        <div>
          <strong>${escapeHtml(entry.type)}</strong>
          <span>${escapeHtml(entry.objectType || "object")}${entry.objectId ? ` / ${escapeHtml(entry.objectId)}` : ""}</span>
        </div>
        <code>${escapeHtml(shortHash(entry.eventHash))}</code>
      </div>
    `,
    {
      title: "No visible ledger entries",
      detail: "Signed local node events will appear here when available."
    }
  );
}

function federationModeLabel(runtime) {
  if (runtime.federationTrustConfigError) return "Trust config error";
  if (!runtime.federationEnabled) return "Local only";
  return runtime.federationSignatureVerificationEnabled ? "Signature verified" : "Shared token";
}

function trustedPeerJson(node) {
  if (!node?.nodeId || !node?.publicKeyPem) return "{}";
  return JSON.stringify(
    {
      [node.nodeId]: {
        publicKeyPem: node.publicKeyPem,
        algorithm: node.algorithm || "Ed25519"
      }
    },
    null,
    2
  );
}

function renderPeerTrustConfig() {
  const runtime = state.data.runtime || {};
  const ownNodeId = runtime.node?.nodeId || "";
  const raw = els.trustPeerInput.value.trim();
  if (!raw) {
    setPeerTrustConfig("Paste a peer record to build the trusted-node config.", {});
    return;
  }

  const parsed = parsePeerTrustInput(raw);
  if (!parsed.ok) {
    setPeerTrustConfig(parsed.message, {});
    return;
  }

  if (parsed.nodes.some((node) => node.nodeId === ownNodeId)) {
    setPeerTrustConfig("This is your own node. Paste the other node's peer JSON.", {});
    return;
  }

  const trustedNodes = Object.fromEntries(
    parsed.nodes.map((node) => [
      node.nodeId,
      {
        publicKeyPem: node.publicKeyPem,
        algorithm: node.algorithm || "Ed25519"
      }
    ])
  );
  const label = parsed.nodes.length === 1 ? "peer" : "peers";
  setPeerTrustConfig(`Ready: ${parsed.nodes.length} trusted ${label}.`, trustedNodes);
}

function setPeerTrustConfig(message, trustedNodes) {
  els.trustPeerFeedback.textContent = message;
  els.trustPeerConfig.textContent = `OSA_FEDERATION_REQUIRE_SIGNATURES=1\nOSA_FEDERATION_TRUSTED_NODES='${JSON.stringify(
    trustedNodes
  )}'`;
}

function parsePeerTrustInput(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, message: "That does not look like valid JSON." };
  }

  const nodes = normalizePeerTrustNodes(value);
  if (!nodes.length) {
    return { ok: false, message: "Peer JSON needs a node id and public key." };
  }
  return { ok: true, nodes };
}

function normalizePeerTrustNodes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  if (typeof value.nodeId === "string" && typeof value.publicKeyPem === "string") {
    return [cleanPeerTrustNode(value.nodeId, value)];
  }

  return Object.entries(value)
    .map(([nodeId, record]) => cleanPeerTrustNode(nodeId, record))
    .filter(Boolean);
}

function cleanPeerTrustNode(nodeId, record) {
  if (!record || typeof record !== "object") return null;
  const cleanNodeId = String(nodeId || "").trim();
  const publicKeyPem = String(record.publicKeyPem || "").trim();
  const algorithm = String(record.algorithm || "Ed25519").trim() || "Ed25519";
  if (!cleanNodeId || !publicKeyPem.includes("BEGIN PUBLIC KEY")) return null;
  return { nodeId: cleanNodeId, publicKeyPem, algorithm };
}

function compactPublicKey(value) {
  return String(value || "")
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "")
    .replace(/^(.{16}).+(.{16})$/, "$1...$2");
}

async function copyTrustPeerJson() {
  await copyText(els.trustCopyPeer, els.trustPeerJson.textContent || "{}");
}

async function copyPeerTrustConfig() {
  await copyText(els.trustCopyConfig, els.trustPeerConfig.textContent || "");
}

function filteredEvents() {
  const highSignalTypes = new Set([
    "proposal_created",
    "proposal_voted",
    "proposal_promoted",
    "agent_registered",
    "agent_disconnected",
    "task_leased",
    "result_submitted",
    "result_reviewed",
    "consensus_progress",
    "result_published",
    "goal_completed",
    "agents_disconnected",
    "federation_imported",
    "artifact_uploaded",
    "connector_token_created",
    "connector_token_revoked",
    "connector_token_expired"
  ]);
  if (state.view === "voting") {
    return state.data.events
      .filter((event) => event.type.startsWith("proposal") || event.type === "agent_registered")
      .slice(0, 5);
  }
  if (state.view === "results") {
    return state.data.events
      .filter((event) => ["result_published", "goal_completed", "agents_disconnected"].includes(event.type))
      .slice(0, 5);
  }
  return state.data.events
    .filter((event) => !event.data?.goalId || event.data.goalId === state.selectedGoalId)
    .filter((event) => highSignalTypes.has(event.type))
    .slice(0, 5);
}

function renderList(container, items, renderItem, emptyCopy = {}) {
  if (!items.length) {
    const copy = typeof emptyCopy === "string" ? { title: emptyCopy } : emptyCopy;
    container.replaceChildren(createEmptyState(copy));
    return;
  }
  container.innerHTML = items.map(renderItem).join("");
}

function createEmptyState({ title = "No records yet", detail = "", compact = false } = {}) {
  const node = document.createElement("div");
  node.className = `empty${compact ? " compact" : ""}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  node.append(heading);
  if (detail) {
    const description = document.createElement("span");
    description.textContent = detail;
    node.append(description);
  }
  return node;
}

function selectedGoal() {
  return state.data?.goals.find((goal) => goal.id === state.selectedGoalId);
}

function activeWorkerGoals() {
  return sortedWorkerGoals((state.data?.goals || []).filter((goal) => goal.status !== "completed"));
}

function sortedWorkerGoals(goals) {
  return [...goals].sort(
    (a, b) =>
      goalWorkerCount(b.id) - goalWorkerCount(a.id) ||
      (b.supporters || 0) - (a.supporters || 0) ||
      a.title.localeCompare(b.title)
  );
}

function goalWorkerCount(goalId) {
  return state.data.agents.filter((agent) => agent.goalId === goalId && agent.status === "online").length;
}

function statusWeight(status) {
  return {
    open: 0,
    leased: 1,
    in_consensus: 2,
    needs_review: 2,
    needs_revision: 3,
    done: 4,
    rejected: 5
  }[status] ?? 9;
}

function statusLabel(status) {
  return {
    open: "Waiting for agent",
    leased: "Agent working",
    in_consensus: "Awaiting review",
    needs_review: "Awaiting review",
    needs_revision: "Needs another pass",
    accepted: "Published",
    promoted: "Moved to work",
    done: "Done",
    rejected: "Rejected",
    online: "Online",
    offline: "Offline",
    voting: "Voting",
    active: "Active",
    expired: "Expired",
    revoked: "Revoked"
  }[status] || String(status || "Unknown").replaceAll("_", " ");
}

function eventTitle(event) {
  return {
    proposal_created: "New idea added",
    proposal_voted: "Agent voted",
    proposal_promoted: "Idea moved to work",
    agent_registered: "Agent joined",
    agent_disconnected: "Agent left",
    agents_disconnected: "Project agents disconnected",
    task_leased: "Agent started a task",
    result_submitted: "Result submitted",
    result_reviewed: "Review completed",
    consensus_progress: "Review progress",
    result_published: "Result published",
    goal_completed: "Project completed",
    federation_imported: "Peer update imported",
    artifact_uploaded: "Artifact uploaded",
    connector_token_created: "Connector command created",
    connector_token_revoked: "Connector disconnected",
    connector_token_expired: "Connector expired",
    user_created: "User signed in",
    user_signed_in: "User signed in"
  }[event.type] || statusLabel(event.type);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const initialHash = window.location.hash.replace("#", "");
if (initialHash === "voting") state.view = "voting";
if (initialHash === "results") state.view = "results";
if (initialHash === "account") state.view = "account";

const oauthParams = new URLSearchParams(window.location.search);
if (oauthParams.get("oauth") && oauthParams.get("error")) {
  const provider = oauthParams.get("oauth") === "github" ? "GitHub" : "Google";
  const error = oauthParams.get("error");
  const message = error === "not_configured"
    ? `${provider} OAuth is not configured on this server yet.`
    : `${provider} OAuth could not complete.`;
  showAuthFeedback("OAuth sign in failed", message);
  history.replaceState(null, "", window.location.pathname + window.location.hash);
}

applyTheme();
await loadAuthConfig();
await refresh();
setInterval(() => {
  if (!realtimeConnected) refresh();
}, 5000);
