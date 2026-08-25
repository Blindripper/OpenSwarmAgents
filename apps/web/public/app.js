const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" }
];

const THEME_STORAGE_KEY = "osaTheme";
const DONATION_ADDRESS = "0x0D92d175943336E3Ad099e55FBe4248dC6fA947b";
const DONATION_AMOUNT_WEI = 2_000_000_000_000_000n;

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
  apiProviderDefault: document.querySelector("#api-provider-default"),
  apiKeyStatus: document.querySelector("#api-key-status"),
  apiKeyClear: document.querySelector("#api-key-clear")
};

els.navWorker.addEventListener("click", () => setView("worker"));
els.navVoting.addEventListener("click", () => setView("voting"));
els.navResults.addEventListener("click", () => setView("results"));
els.navAccount.addEventListener("click", () => setView("account"));
els.themeToggle.addEventListener("click", () => toggleTheme());
els.oauthGithub.addEventListener("click", () => startOAuth("github"));
els.oauthGoogle.addEventListener("click", () => startOAuth("google"));
els.donateButton.addEventListener("click", () => donateEth());

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
    reason: "Your agent is reading the Voting Pool and choosing the strongest project."
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
  if (!state.authConfig.auth.devLoginEnabled) {
    showAuthFeedback("Local login disabled", "This node is configured for external authentication.");
    return;
  }
  const response = await post("/api/auth/login", { email, name, password });
  localStorage.setItem("agentswarmSessionToken", response.sessionToken);
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
  localStorage.removeItem("agentswarmWorkerConnectorToken");
  localStorage.removeItem("agentswarmWorkerGoalId");
  localStorage.removeItem("agentswarmVotingAgentId");
  state.user = null;
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
  if (!Object.keys(next).length) {
    showAccountFeedback("Provider key missing", "Paste at least one provider API key before saving locally.");
    return;
  }
  localStorage.setItem("agentswarmProviderKeys", JSON.stringify(next));
  localStorage.setItem("agentswarmDefaultProvider", els.apiProviderDefault.value);
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
  } else if (localStorage.getItem("agentswarmSessionToken")) {
    state.user = null;
    localStorage.removeItem("agentswarmSessionToken");
    localStorage.removeItem("agentswarmUser");
  }
  const activeGoals = activeWorkerGoals();
  const connectedGoalId = localStorage.getItem("agentswarmWorkerGoalId");
  if (connectedGoalId && !activeGoals.some((goal) => goal.id === connectedGoalId)) {
    localStorage.removeItem("agentswarmWorkerAgentId");
    localStorage.removeItem("agentswarmWorkerConnectorId");
    localStorage.removeItem("agentswarmWorkerConnectorToken");
    localStorage.removeItem("agentswarmWorkerGoalId");
  }
  if (!activeGoals.some((goal) => goal.id === state.selectedGoalId)) {
    state.selectedGoalId = activeGoals[0]?.id || null;
  }
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
  const token = localStorage.getItem("agentswarmSessionToken");
  return token ? { "x-agentswarm-session": token } : {};
}

function render() {
  if (!state.data) return;
  renderShell();
  if (!isAuthenticated()) {
    renderThemeToggle();
    return;
  }
  renderSelectedGoal();
  renderMetrics();

  const goalId = state.selectedGoalId;
  const tasks = state.data.tasks.filter((item) => item.goalId === goalId);
  const agents = state.data.agents.filter((item) => item.goalId === goalId);
  const results = state.data.results.filter((item) => item.goalId === goalId);
  const claims = state.data.claims.filter((item) => item.goalId === goalId);

  els.taskCount.textContent = `${activeWorkerGoals().length} projects`;
  els.agentCount.textContent = `${agents.length}`;
  els.resultCount.textContent = `${results.length}`;
  els.claimCount.textContent = `${claims.length}`;
  els.proposalCount.textContent = `${state.data.proposals.length} proposals`;
  els.voteCount.textContent = `${(state.data.proposalVotes || []).length} votes`;
  els.resultPoolCount.textContent = `${(state.data.resultPool || []).length} results`;
  els.serverTime.textContent = new Date(state.data.serverTime).toLocaleTimeString();

  renderWorkerProjects(activeWorkerGoals());
  renderStoredConnectorFeedback();
  renderAgents(agents);
  renderResults(results);
  renderClaims(claims);
  renderProposals(state.data.proposals);
  renderResultPool(state.data.resultPool || []);
  renderAccount();
  renderVoteFeedback();
  renderEvents(filteredEvents());
}

function renderShell() {
  const authenticated = isAuthenticated();
  const isWorker = state.view === "worker";
  const isVoting = state.view === "voting";
  const isResults = state.view === "results";
  const isAccount = state.view === "account";
  document.querySelector(".shell")?.classList.toggle("locked", !authenticated);
  els.authGate.classList.toggle("hidden", authenticated);
  els.metrics.classList.toggle("hidden", !authenticated);
  document.querySelector(".events-panel")?.classList.toggle("hidden", !authenticated);
  els.navWorker.disabled = !authenticated;
  els.navVoting.disabled = !authenticated;
  els.navResults.disabled = !authenticated;
  els.navAccount.disabled = !authenticated;
  els.navWorker.classList.toggle("active", isWorker);
  els.navVoting.classList.toggle("active", isVoting);
  els.navResults.classList.toggle("active", isResults);
  els.navAccount.classList.toggle("active", isAccount);
  els.workerView.classList.toggle("active", authenticated && isWorker);
  els.votingView.classList.toggle("active", authenticated && isVoting);
  els.resultsView.classList.toggle("active", authenticated && isResults);
  els.accountView.classList.toggle("active", authenticated && isAccount);
  els.votingSidebar.classList.toggle("hidden", !authenticated || !isVoting);
  els.resultsSidebar.classList.toggle("hidden", !authenticated || !isResults);
  els.accountSidebar.classList.toggle("hidden", !authenticated || !isAccount);
  renderAuthControls();
  renderThemeToggle();
}

function renderAuthControls() {
  const devLoginEnabled = Boolean(state.authConfig.auth?.devLoginEnabled);
  const passwordRequired = Boolean(state.authConfig.auth?.localPasswordRequired);
  els.authDevForm.classList.toggle("hidden", !devLoginEnabled);
  els.accountForm.classList.toggle("dev-login-disabled", !devLoginEnabled);
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
  if (!devLoginEnabled && !configuredProviders.length && !state.user) {
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
  if (!requireProviderKey("Add at least one provider API key before connecting your agent to a worker project.")) return;
  if (localStorage.getItem("agentswarmWorkerGoalId")) return;
  showConnectorFeedback({
    title: "Creating connector token",
    reason: `Preparing a scoped connector command for ${goal.title}.`
  });
  const response = await post("/api/connectors/token", {
    mode: "worker",
    name: `${state.user?.name || "Local"} Worker Agent`,
    goalId: goal.id,
    capabilities: ["research", "review", "synthesis"],
    models: [`connector:${preferredProvider()}`],
    provider: preferredProvider(),
    providers: enabledProviders()
  });
  localStorage.setItem("agentswarmWorkerConnectorId", response.connector.id);
  localStorage.setItem("agentswarmWorkerConnectorToken", response.token);
  localStorage.setItem("agentswarmWorkerGoalId", goal.id);
  state.selectedGoalId = goal.id;
  showConnectorFeedback({
    title: `Connector ready for ${goal.title}`,
    reason: `Run this command on the machine where your agent should work. Set ${providerEnvName(preferredProvider())} in that terminal first. The raw token is shown only once.`,
    command: connectorCommand(response.token, goal.id)
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
  localStorage.removeItem("agentswarmWorkerConnectorToken");
  localStorage.removeItem("agentswarmWorkerGoalId");
  showConnectorFeedback({
    title: "Connector disconnected",
    reason: `${goal.title} is no longer linked to this browser.`
  });
  await refresh();
}

function connectorCommand(token, goalId) {
  const server = window.location.origin;
  const provider = preferredProvider();
  const providers = enabledProviders().join(",");
  return `python3 apps/connector/connector.py --server ${server} --connector-token ${token} --goal ${goalId} --runner provider --provider ${provider} --providers ${providers}`;
}

function showConnectorFeedback({ title, reason, command = "" }) {
  els.connectorFeedback.classList.remove("hidden");
  els.connectorFeedback.innerHTML = `
    <div>
      <span class="section-label">Connector</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
      ${command ? `<code class="command-block">${escapeHtml(command)}</code>` : ""}
    </div>
  `;
}

function renderStoredConnectorFeedback() {
  if (state.view !== "worker") {
    els.connectorFeedback.classList.add("hidden");
    return;
  }
  if (!els.connectorFeedback.classList.contains("hidden")) return;
  const goalId = localStorage.getItem("agentswarmWorkerGoalId");
  const token = localStorage.getItem("agentswarmWorkerConnectorToken");
  const goal = state.data.goals.find((item) => item.id === goalId);
  if (!goalId || !token || !goal) return;
  showConnectorFeedback({
    title: `Connector ready for ${goal.title}`,
    reason: "Run this command where your local agent should work.",
    command: connectorCommand(token, goalId)
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

function renderAccount() {
  const user = state.user;
  const providers = enabledProviders();
  els.accountStatus.textContent = user ? `Signed in as ${user.name}` : "Not signed in";
  els.apiKeyStatus.textContent = providers.length ? `${providers.length}/${PROVIDERS.length} local` : "No keys";
  els.accountLogout.disabled = !user;
  els.apiProviderDefault.value = preferredProvider();
  if (user) {
    els.accountEmail.value = user.email || "";
    els.accountName.value = user.name || "";
  }
}

function showAccountFeedback(title, reason) {
  els.accountFeedback.classList.remove("hidden");
  els.accountFeedback.innerHTML = `
    <div>
      <span class="section-label">Account</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(reason)}</p>
    </div>
  `;
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

function renderMetrics() {
  const stats = state.data.stats;
  const votingAgents = state.data.agents.filter((agent) => agent.goalId === "voting-pool").length;
  const promoted = state.data.proposals.filter((proposal) => proposal.status === "promoted").length;
  const metricsByView = {
    worker: [
      ["Worker Projects", stats.goals],
      ["Online Agents", stats.onlineAgents],
      ["Open Tasks", stats.openTasks],
      ["Pending Reviews", stats.pendingReviews],
      ["Claims", stats.acceptedClaims]
    ],
    voting: [
      ["Voting Proposals", stats.votingProposals],
      ["Voting Agents", votingAgents],
      ["Votes Cast", (state.data.proposalVotes || []).length],
      ["Promoted", promoted],
      ["Worker Projects", stats.goals]
    ],
    results: [
      ["Published Results", stats.resultPool],
      ["Completed Projects", state.data.goals.filter((goal) => goal.status === "completed").length],
      ["Accepted Claims", stats.acceptedClaims],
      ["Reviewed Results", state.data.results.filter((result) => result.status === "accepted").length],
      ["Worker Projects", stats.goals]
    ],
    account: [
      ["Account", state.user ? "Active" : "Missing"],
      ["BYOK Keys", hasProviderKey() ? enabledProviders().join(", ") : "Missing"],
      ["Server Users", stats.users],
      ["Worker Agent", localStorage.getItem("agentswarmWorkerAgentId") ? "Connected" : "None"],
      ["Voting Agent", localStorage.getItem("agentswarmVotingAgentId") ? "Ready" : "None"]
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
            <span class="chip ${proposal.status === "promoted" ? "accepted" : "open"}">${escapeHtml(proposal.status)}</span>
          </div>
          <p>${escapeHtml(proposal.description)}</p>
          <div class="chips">
            <span class="chip">Votes ${proposal.votes}</span>
          </div>
        </div>
      `;
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
    reason: reason || vote?.reason || "The agent selected this proposal as the strongest option in the Voting Pool."
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
    const empty = document.querySelector("#empty-template").content.cloneNode(true);
    els.tasks.replaceChildren(empty);
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
      card.innerHTML = `
        <div class="worker-project-head">
          <button class="worker-project-main" type="button">
            <strong>${escapeHtml(goal.title)}</strong>
            <span>${connectedWorkers} connected workers · ${projectTasks.length} tasks</span>
          </button>
          <div class="worker-project-actions">
            <button class="project-connect primary" type="button" ${hasConnection ? "disabled" : ""}>Connect</button>
            <button class="project-disconnect" type="button" ${isConnected ? "" : "disabled"}>Disconnect</button>
          </div>
        </div>
        <p>${escapeHtml(goal.description)}</p>
        <div class="project-task-stack">
          ${projectTasks.map((task) => `
            <div class="project-task-row">
              <strong>${escapeHtml(task.title)}</strong>
              <span class="chip ${task.status}">${escapeHtml(task.status)}</span>
            </div>
          `).join("") || `<div class="empty compact">No tasks yet</div>`}
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
          <span class="chip ${agent.status}">${escapeHtml(agent.status)}</span>
        </div>
        <p>${escapeHtml((agent.models || []).join(", "))}</p>
        <div class="chips">
          ${(agent.providers || [agent.provider].filter(Boolean)).map((provider) => `<span class="chip">${escapeHtml(provider)}</span>`).join("")}
          ${(agent.capabilities || []).map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`).join("")}
          <span class="chip">accepted ${agent.reputation?.accepted || 0}</span>
          <span class="chip">review ${agent.reputation?.review || 0}</span>
        </div>
      </div>
    `
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
            <span class="chip ${result.status}">${escapeHtml(result.status)}</span>
          </div>
          <p>${escapeHtml(result.content)}</p>
          <div class="chips">
            ${consensus ? `<span class="chip">consensus ${accepted}/${required}</span>` : ""}
            <span class="chip">iteration ${result.iteration || 1}</span>
            <span class="chip">confidence ${Math.round(result.confidence * 100)}%</span>
            ${(result.sources || []).map((source) => `<span class="chip">${escapeHtml(source)}</span>`).join("")}
          </div>
          ${renderArtifactList(result.artifacts || [])}
        </div>
      `;
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
    `
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
    `
  );
}

function renderEvents(events) {
  renderList(
    els.events,
    events,
    (event) => `
      <div class="event-row">
        <span>${new Date(event.createdAt).toLocaleTimeString()}</span>
        <span><strong>${escapeHtml(event.type)}</strong> ${escapeHtml(event.message)}</span>
      </div>
    `
  );
}

function filteredEvents() {
  if (state.view === "voting") {
    return state.data.events
      .filter((event) => event.type.startsWith("proposal") || event.type === "agent_registered")
      .slice(0, 12);
  }
  if (state.view === "results") {
    return state.data.events
      .filter((event) => ["result_published", "goal_completed", "agents_disconnected"].includes(event.type))
      .slice(0, 12);
  }
  return state.data.events
    .filter((event) => !event.data?.goalId || event.data.goalId === state.selectedGoalId)
    .slice(0, 12);
}

function renderList(container, items, renderItem) {
  if (!items.length) {
    const empty = document.querySelector("#empty-template").content.cloneNode(true);
    container.replaceChildren(empty);
    return;
  }
  container.innerHTML = items.map(renderItem).join("");
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
setInterval(refresh, 5000);
