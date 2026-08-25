import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = join(import.meta.dirname, "..");
const port = Number(process.env.OSA_CONSENSUS_SIM_PORT || 20080 + Math.floor(Math.random() * 800));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "osa-consensus-sim-"));
let server = null;

try {
  server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OSA_DATA_DIR: dataDir,
      OSA_IDENTITY_PATH: join(dataDir, "node-identity.json"),
      OSA_LOCAL_PASSWORD_REQUIRED: "0",
      OSA_DEMO_ENDPOINTS: "0",
      OSA_RATE_LIMIT_MULTIPLIER: "0",
      AGENTSWARM_PROPOSAL_VOTING_MS: "500"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = collectLogs(server);
  await waitForHealth(logs);

  const users = await Promise.all(["A", "B", "C"].map((label) => loginNodeUser(label)));
  const proposal = await createConsensusProposal(users[0].headers);
  for (const user of users) {
    const vote = await postJson(
      "/api/voting/connect",
      {
        name: `Node ${user.label} Voting Agent`,
        provider: "openai",
        providers: ["openai", "anthropic", "gemini"]
      },
      user.headers
    );
    assert(
      vote.vote?.proposalId === proposal.id,
      `Node ${user.label} should vote for the consensus proposal, got ${JSON.stringify(vote.decision || vote.vote)}`
    );
  }

  await delay(650);
  const promotedState = await getJson("/api/state", users[0].headers);
  const promoted = promotedState.proposals.find((item) => item.id === proposal.id);
  assert(promoted?.status === "promoted", "proposal should be auto-promoted after the voting window");
  const goal = promotedState.goals.find((item) => item.sourceProposalId === proposal.id);
  assert(goal?.status === "active", "promoted proposal should create an active worker project");
  assert(promotedState.tasks.filter((task) => task.goalId === goal.id && !task.reviewForResultId).length === 2, "promoted project should create two worker tasks");

  const nodes = [];
  for (const user of users) {
    const connector = await postJson(
      "/api/connectors/token",
      {
        mode: "worker",
        goalId: goal.id,
        name: `Node ${user.label} Worker Agent`,
        capabilities: ["research", "review", "synthesis"],
        models: [`node-${user.label.toLowerCase()}-sim`],
        provider: "openai",
        providers: ["openai", "anthropic", "gemini"]
      },
      user.headers
    );
    const connectorHeaders = { "x-osa-connector-token": connector.token };
    const registered = await postJson(
      "/api/agents/register",
      {
        name: `Node ${user.label} Worker Agent`,
        capabilities: ["research", "review", "synthesis"],
        models: [`node-${user.label.toLowerCase()}-sim`],
        maxConcurrentTasks: 1,
        provider: "openai",
        providers: ["openai", "anthropic", "gemini"]
      },
      connectorHeaders
    );
    nodes.push({ ...user, connectorHeaders, agent: registered.agent });
  }

  const firstClaim = await claim(nodes[0], goal.id);
  assert(firstClaim.task?.type === "research", "first node should claim the research task first");
  const firstTaskId = firstClaim.task.id;
  const firstResult = await submitResult(nodes[0], firstClaim.task, {
    summary: "Initial consensus approach",
    content: "The first attempt is intentionally under-sourced so the network should request another iteration.",
    sources: ["sim://initial-claim"],
    confidence: 0.52
  });
  assert(firstResult.result.status === "in_consensus", "submitted result should enter consensus");
  assert(firstResult.result.consensus.requiredAgentIds.length === 2, "both other project agents should be required reviewers");

  const firstReviewClaim = await claim(nodes[1], goal.id);
  assert(firstReviewClaim.task?.reviewForResultId === firstResult.result.id, "second node should receive a review task for the first result");
  await submitReview(nodes[1], firstResult.result.id, {
    decision: "needs_revision",
    score: 0.55,
    reason: "The result lacks independent evidence and should be iterated with stronger source-backed claims."
  });

  let state = await getJson("/api/state", users[0].headers);
  const revisedFirstResult = state.results.find((item) => item.id === firstResult.result.id);
  const reopenedTask = state.tasks.find((item) => item.id === firstTaskId);
  assert(revisedFirstResult.status === "needs_revision", "revision review should mark the first result as needing revision");
  assert(reopenedTask.status === "open", "revision should return the original task to the worker pool");
  assert(reopenedTask.iteration === 2, "revision should advance the original task iteration");
  assert(!state.resultPool.some((entry) => entry.resultId === firstResult.result.id), "unaccepted first result must not publish");

  const secondClaim = await claim(nodes[2], goal.id);
  assert(secondClaim.task?.id === firstTaskId, "third node should reclaim the revised original task");
  assert(secondClaim.context.iteration === 2, "reclaimed task should include iteration 2");
  assert(secondClaim.context.priorResults.some((item) => item.id === firstResult.result.id && item.status === "needs_revision"), "iteration context should include the prior revision result");
  assert(secondClaim.context.priorResults.some((item) => item.reviews?.some((review) => review.reason.includes("stronger source-backed"))), "iteration context should include reviewer feedback");

  const improvedResult = await submitResult(nodes[2], secondClaim.task, {
    summary: "Accepted consensus approach",
    content:
      "The improved iteration combines the first attempt with reviewer feedback, separates claims from assumptions, and lists validation steps before publication.",
    sources: ["sim://initial-claim", "sim://review-feedback", "sim://validation-plan"],
    confidence: 0.84
  });
  assert(improvedResult.result.status === "in_consensus", "improved result should require consensus reviews");

  const reviewA = await claim(nodes[0], goal.id);
  assert(reviewA.task?.reviewForResultId === improvedResult.result.id, "author-excluded node A should review the improved result");
  await submitReview(nodes[0], improvedResult.result.id, {
    decision: "accepted",
    score: 0.91,
    reason: "The improved result incorporates the revision feedback and defines a verifiable plan."
  });
  state = await getJson("/api/state", users[0].headers);
  assert(state.results.find((item) => item.id === improvedResult.result.id).status === "in_consensus", "one acceptance should not be enough for publication");

  const reviewB = await claim(nodes[1], goal.id);
  assert(reviewB.task?.reviewForResultId === improvedResult.result.id, "node B should complete unanimous consensus for the improved result");
  await submitReview(nodes[1], improvedResult.result.id, {
    decision: "accepted",
    score: 0.93,
    reason: "The result is now bounded, source-aware, and strong enough to publish."
  });
  state = await getJson("/api/state", users[0].headers);
  assert(state.results.find((item) => item.id === improvedResult.result.id).status === "accepted", "unanimous acceptance should accept the improved result");
  assert(state.resultPool.some((entry) => entry.resultId === improvedResult.result.id), "accepted improved result should publish to the Result Pool");
  assert(state.goals.find((item) => item.id === goal.id).status === "active", "project should remain active while another worker task is open");

  const synthesisClaim = await claim(nodes[0], goal.id);
  assert(synthesisClaim.task?.type === "synthesis", "remaining worker task should be synthesis");
  const synthesisResult = await submitResult(nodes[0], synthesisClaim.task, {
    summary: "Final execution plan",
    content:
      "The final plan consolidates the accepted research iteration into milestones, evidence requirements, review checkpoints, and publication criteria.",
    sources: ["sim://accepted-consensus-approach", "sim://execution-plan"],
    confidence: 0.88
  });

  const synthesisReviewB = await claim(nodes[1], goal.id);
  assert(synthesisReviewB.task?.reviewForResultId === synthesisResult.result.id, "node B should review the synthesis result");
  await submitReview(nodes[1], synthesisResult.result.id, {
    decision: "accepted",
    score: 0.92,
    reason: "The plan is concrete and aligns with the accepted research result."
  });
  const synthesisReviewC = await claim(nodes[2], goal.id);
  assert(synthesisReviewC.task?.reviewForResultId === synthesisResult.result.id, "node C should complete synthesis consensus");
  await submitReview(nodes[2], synthesisResult.result.id, {
    decision: "accepted",
    score: 0.9,
    reason: "The final plan is ready to publish as the project outcome."
  });

  state = await getJson("/api/state", users[0].headers);
  const completedGoal = state.goals.find((item) => item.id === goal.id);
  assert(completedGoal.status === "completed", "project should complete after all worker tasks have unanimous accepted results");
  assert(state.resultPool.some((entry) => entry.resultId === synthesisResult.result.id), "final synthesis result should publish to the Result Pool");
  assert(state.agents.filter((agent) => agent.goalId === goal.id && agent.status === "online").length === 0, "completed project should disconnect all project agents");
  assert(state.events.some((event) => event.type === "consensus_revision"), "activity feed should include the revision event");
  assert(state.events.some((event) => event.type === "goal_completed" && event.data?.goalId === goal.id), "activity feed should include project completion");

  console.log(
    JSON.stringify(
      {
        ok: true,
        proposalId: proposal.id,
        goalId: goal.id,
        agents: nodes.map((node) => node.agent.id),
        acceptedResults: state.results.filter((result) => result.goalId === goal.id && result.status === "accepted").length,
        publishedResults: state.resultPool.filter((entry) => entry.goalId === goal.id).length,
        finalGoalStatus: completedGoal.status
      },
      null,
      2
    )
  );
} finally {
  if (server) server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}

async function loginNodeUser(label) {
  const response = await postJson("/api/auth/login", {
    email: `node-${label.toLowerCase()}@consensus-sim.example`,
    name: `Node ${label}`,
    password: ""
  });
  return {
    label,
    user: response.user,
    headers: { "x-agentswarm-session": response.sessionToken }
  };
}

async function createConsensusProposal(headers) {
  const response = await postJson(
    "/api/proposals",
    {
      title: "Agent connector security trust open verified knowledge network",
      description:
        "Create an agent connector security and trust project that produces open verified knowledge. The project brief intentionally includes agent, connector, security, safe, trust, open, verified, and knowledge signals so voting agents consistently select it."
    },
    headers
  );
  return response.proposal;
}

async function claim(node, goalId) {
  return postJson(
    "/api/tasks/claim",
    {
      agentId: node.agent.id,
      goalId
    },
    node.connectorHeaders
  );
}

async function submitResult(node, task, body) {
  return postJson(
    `/api/tasks/${task.id}/result`,
    {
      agentId: node.agent.id,
      ...body
    },
    node.connectorHeaders
  );
}

async function submitReview(node, resultId, body) {
  return postJson(
    `/api/results/${resultId}/review`,
    {
      agentId: node.agent.id,
      ...body
    },
    node.connectorHeaders
  );
}

function collectLogs(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

async function waitForHealth(logs) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check passed:\n${logs()}`);
    }
    try {
      const health = await getJson("/api/health");
      if (health.ok) return;
    } catch (error) {
      lastError = error;
      // Keep waiting.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy:\n${logs()}\nLast health error: ${lastError?.message || "none"}`);
}

async function getJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`${path} should return HTTP 2xx, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
