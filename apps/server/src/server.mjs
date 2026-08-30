import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHash,
  generateKeyPairSync,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  sign as signPayload,
  timingSafeEqual,
  verify as verifyPayload
} from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../../..");
const publicDir = join(rootDir, "apps/web/public");
const agentGuiDistDir = join(rootDir, "vendor/agent-gui/frontend/dist");
const dataDir = process.env.OSA_DATA_DIR || join(rootDir, "data");
const uploadDir = process.env.OSA_UPLOAD_DIR || join(dataDir, "uploads");
const identityPath = process.env.OSA_IDENTITY_PATH || join(dataDir, "node-identity.json");
const seedPath = join(rootDir, "data/seed.json");
const storePath = join(dataDir, "agentswarm.json");
const port = Number(process.env.PORT || 8789);
const host = process.env.HOST || "127.0.0.1";
const leaseMs = Number(process.env.AGENTSWARM_LEASE_MS || 10 * 60 * 1000);
const proposalVotingMs = Number(process.env.AGENTSWARM_PROPOSAL_VOTING_MS || 72 * 60 * 60 * 1000);
const storageMode = process.env.DATABASE_URL ? "postgres-snapshot" : "json";
const isProduction = process.env.NODE_ENV === "production";
const authMode = normalizeAuthMode(process.env.OSA_AUTH_MODE || "local");
const rateLimitMultiplier = Math.max(0, Number(process.env.OSA_RATE_LIMIT_MULTIPLIER || 1));
const maxJsonBytes = Number(process.env.OSA_MAX_JSON_BYTES || 1024 * 1024);
const maxArtifactUploadBytes = Number(process.env.OSA_MAX_ARTIFACT_UPLOAD_BYTES || 10 * 1024 * 1024);
const publicTrustLedgerEnabled = process.env.OSA_PUBLIC_TRUST_LEDGER === "1";
const trustProxyHeaders = process.env.OSA_TRUST_PROXY === "1";
const maxRealtimeClients = Math.max(1, Number(process.env.OSA_MAX_SSE_CLIENTS || 100));
const maxRealtimeClientsPerUser = Math.max(1, Number(process.env.OSA_MAX_SSE_CLIENTS_PER_USER || 5));
const federationEnabled = process.env.OSA_FEDERATION_ENABLED === "1";
const federationToken = process.env.OSA_FEDERATION_TOKEN || "";
const federationTokenHash = federationToken ? hashToken(federationToken) : "";
const federationPeers = normalizeFederationPeers(process.env.OSA_FEDERATION_PEERS || "");
const federationTrustedNodesPath = process.env.OSA_FEDERATION_TRUSTED_NODES_PATH || "";
const federationSyncMs = Math.max(1000, Number(process.env.OSA_FEDERATION_SYNC_MS || 5000));
const federationCollectionLimit = Math.max(100, Math.min(5000, Number(process.env.OSA_FEDERATION_COLLECTION_LIMIT || 2000)));
const federationSnapshotMaxBytes = Math.max(maxJsonBytes, Number(process.env.OSA_FEDERATION_SNAPSHOT_MAX_BYTES || maxJsonBytes * 4));
const federationPeerSyncs = new Set();
const managedConnectorProcesses = new Map();
const managedConnectorLogLimit = 12 * 1024;
const agentGuiHomeTeamId = "home-room";
const agentGuiPublicTeamId = "public-room";
const agentGuiPublicRoomsTeamId = "public-rooms-room";
const agentGuiPublicProjectsTeamId = "public-projects-room";
const osaDonationFeeWallet = "0x0D92d175943336E3Ad099e55FBe4248dC6fA947b";
const osaDonationFeePercent = 5;
const legacySeedGoalIds = new Set(["goal-agent-collab", "goal-water", "goal-energy-storage"]);
const legacySeedTaskIds = new Set([
  "task-architecture-map",
  "task-trust-model",
  "task-claim-schema",
  "task-water-baseline",
  "task-storage-baseline"
]);
const legacySeedProposalIds = new Set(["proposal-agent-security", "proposal-open-water-map"]);
const providerEnvNames = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY"
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

const oauthProviderConfig = {
  github: {
    label: "GitHub",
    clientIdEnv: "OSA_GITHUB_CLIENT_ID",
    clientSecretEnv: "OSA_GITHUB_CLIENT_SECRET",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email"
  },
  google: {
    label: "Google",
    clientIdEnv: "OSA_GOOGLE_CLIENT_ID",
    clientSecretEnv: "OSA_GOOGLE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile"
  }
};

let pgPool = null;
const rateLimitBuckets = new Map();
const realtimeClients = new Set();
validateRuntimeConfig();
const nodeIdentity = await loadNodeIdentity();
let store = await loadStore();

async function loadStore() {
  if (process.env.DATABASE_URL) return loadPostgresStore();

  await mkdir(dataDir, { recursive: true });
  try {
    const loaded = normalizeStore(JSON.parse(await readFile(storePath, "utf8")));
    const pruned = removeLegacySeedExamples(loaded);
    if (!loaded.proposals.length) {
      const seed = JSON.parse(await readFile(seedPath, "utf8"));
      loaded.proposals = seed.proposals || [];
      await saveStore(loaded);
    } else if (pruned) {
      await saveStore(loaded);
    }
    return loaded;
  } catch {
    const seed = JSON.parse(await readFile(seedPath, "utf8"));
    const initial = normalizeStore({
      ...seed,
      agents: [],
      results: [],
      reviews: [],
      claims: [],
      users: [],
      sessions: [],
      agentProfiles: [],
      walletSessions: [],
      agentDonations: [],
      publicProjectReviews: [],
      publicRooms: [],
      publicProjects: [],
      connectorTokens: [],
      uploadedArtifacts: [],
      proposalVotes: [],
      trustLedger: [],
      events: []
    });
    await saveStore(initial);
    return initial;
  }
}

function normalizeStore(input) {
  const goals = input.goals || [];
  const tasks = normalizeTasks(input.tasks || []);
  const results = input.results || [];
  const reviews = input.reviews || [];
  return {
    goals,
    agents: input.agents || [],
    tasks,
    results,
    reviews,
    claims: input.claims || [],
    users: input.users || [],
    sessions: input.sessions || [],
    agentProfiles: normalizeAgentProfiles(input.agentProfiles || []),
    walletSessions: normalizeWalletSessions(input.walletSessions || []),
    agentDonations: normalizeAgentDonations(input.agentDonations || []),
    publicProjectReviews: normalizePublicProjectReviews(input.publicProjectReviews || []),
    publicRooms: normalizePublicCollections(input.publicRooms || [], "room"),
    publicProjects: normalizePublicCollections(input.publicProjects || [], "project"),
    connectorTokens: normalizeConnectorTokens(input.connectorTokens || []),
    uploadedArtifacts: input.uploadedArtifacts || [],
    trustLedger: normalizeTrustLedger(input.trustLedger || []),
    resultPool: input.resultPool || buildResultPoolFromAccepted(goals, tasks, results, reviews),
    proposals: (input.proposals || []).map(normalizeProposal),
    proposalVotes: input.proposalVotes || [],
    oauthStates: input.oauthStates || [],
    events: input.events || []
  };
}

function normalizeTasks(tasks) {
  return tasks.map((task) => ({
    ...task,
    sharedPublic: Boolean(task.sharedPublic),
    sharedPublicAt: task.sharedPublicAt || null,
    copyCount: Math.max(0, Number(task.copyCount || 0)),
    lastCopiedAt: task.lastCopiedAt || null
  }));
}

function normalizeAgentProfiles(profiles) {
  return profiles
    .filter((profile) => profile?.id)
    .map((profile) => ({
      id: String(profile.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80),
      name: String(profile.name || profile.id || "OpenClaw Agent").slice(0, 80),
      tagline: String(profile.tagline || "Private OpenClaw worker profile").slice(0, 160),
      color: String(profile.color || "#22d3ee").slice(0, 32),
      available: profile.available !== false,
      model: String(profile.model || "OpenClaw local agent").slice(0, 120),
      base_url: String(profile.base_url || "").slice(0, 500),
      profile_path: String(profile.profile_path || `osa://profiles/${profile.id}`).slice(0, 500),
      is_prototype: false,
      clone_from: profile.clone_from || "openclaw-codex",
      runner: ["openclaw", "codex"].includes(profile.runner) ? profile.runner : (profile.clone_from === "codex-cli" ? "codex" : "openclaw"),
      soul: String(profile.soul || "You are a user-owned OpenClaw agent profile. Work clearly, locally, and keep results useful.").slice(0, 20_000),
      memory: String(profile.memory || "").slice(0, 20_000)
    }))
    .filter((profile) => profile.id);
}

function normalizeWalletAddress(address) {
  const value = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    const error = new Error("A valid EVM wallet address is required.");
    error.statusCode = 400;
    throw error;
  }
  return value.toLowerCase();
}

function normalizeWalletSessions(sessions) {
  return sessions
    .filter((session) => session?.address)
    .map((session) => {
      try {
        return {
          id: String(session.id || `wallet-${randomUUID()}`).slice(0, 100),
          address: normalizeWalletAddress(session.address),
          chainId: session.chainId ? String(session.chainId).slice(0, 40) : null,
          signature: session.signature ? String(session.signature).slice(0, 500) : null,
          createdAt: session.createdAt || now(),
          lastSeenAt: session.lastSeenAt || session.createdAt || now()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeDonationAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    const error = new Error("Donation amount must be greater than zero.");
    error.statusCode = 400;
    throw error;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeAgentDonations(donations) {
  return donations
    .filter((donation) => (donation?.taskId || donation?.targetId) && donation?.walletAddress)
    .map((donation) => {
      try {
        const targetType = ["agent", "room", "project"].includes(donation.targetType) ? donation.targetType : "agent";
        const targetId = String(donation.targetId || donation.taskId).slice(0, 140);
        const amount = normalizeDonationAmount(donation.amount);
        const feeAmount = Math.round(amount * osaDonationFeePercent * 10_000) / 1_000_000;
        return {
          id: String(donation.id || `donation-${randomUUID()}`).slice(0, 100),
          taskId: targetType === "agent" ? targetId : (donation.taskId ? String(donation.taskId).slice(0, 120) : null),
          targetType,
          targetId,
          sessionId: donation.sessionId ? String(donation.sessionId).slice(0, 140) : `public-${targetId}`,
          walletAddress: normalizeWalletAddress(donation.walletAddress),
          chainId: donation.chainId ? String(donation.chainId).slice(0, 40) : null,
          amount,
          currency: "USDC",
          feePercent: osaDonationFeePercent,
          feeWallet: donation.feeWallet ? normalizeWalletAddress(donation.feeWallet) : osaDonationFeeWallet.toLowerCase(),
          feeAmount: donation.feeAmount ? normalizeDonationAmount(donation.feeAmount) : feeAmount,
          creatorAmount: donation.creatorAmount ? normalizeDonationAmount(donation.creatorAmount) : Math.max(0, Math.round((amount - feeAmount) * 1_000_000) / 1_000_000),
          status: donation.status === "confirmed" ? "confirmed" : "pledged",
          txHash: donation.txHash ? String(donation.txHash).slice(0, 100) : null,
          createdAt: donation.createdAt || now()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizePublicProjectReviews(reviews) {
  return reviews
    .filter((review) => review?.projectId && review?.walletAddress)
    .map((review) => {
      try {
        const rating = Number(review.rating);
        if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
        return {
          id: String(review.id || `project-review-${randomUUID()}`).slice(0, 100),
          projectId: String(review.projectId).slice(0, 140),
          walletAddress: normalizeWalletAddress(review.walletAddress),
          rating: Math.round(rating),
          title: String(review.title || "").trim().slice(0, 120),
          comment: String(review.comment || "").trim().slice(0, 2000),
          createdAt: review.createdAt || now(),
          updatedAt: review.updatedAt || review.createdAt || now()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizePublicCollections(items, type) {
  return items
    .filter((item) => item?.id)
    .map((item) => ({
      id: String(item.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100),
      type,
      sourceTeamId: item.sourceTeamId ? String(item.sourceTeamId).slice(0, 100) : null,
      name: String(item.name || (type === "room" ? "Public Room" : "Public Project")).slice(0, 120),
      summary: String(item.summary || "").slice(0, 1000),
      taskIds: normalizeList(item.taskIds || item.task_ids, []).map((id) => String(id).slice(0, 120)),
      rooms: Array.isArray(item.rooms) ? item.rooms.map((room) => ({
        id: String(room.id || agentGuiHomeTeamId).slice(0, 100),
        name: String(room.name || "Home").slice(0, 80),
        taskIds: normalizeList(room.taskIds || room.task_ids, []).map((id) => String(id).slice(0, 120))
      })) : [],
      sharedAt: item.sharedAt || item.shared_at || now(),
      updatedAt: item.updatedAt || item.updated_at || item.sharedAt || item.shared_at || now(),
      copyCount: Math.max(0, Number(item.copyCount || item.copy_count || 0)),
      lastCopiedAt: item.lastCopiedAt || item.last_copied_at || null,
      ownerWalletAddress: item.ownerWalletAddress ? normalizeWalletAddress(item.ownerWalletAddress) : null
    }))
    .filter((item) => item.id && item.taskIds.length > 0);
}

function removeLegacySeedExamples(target) {
  const before = {
    goals: target.goals.length,
    tasks: target.tasks.length,
    proposals: target.proposals.length
  };
  target.tasks = target.tasks.filter((task) => !legacySeedTaskIds.has(task.id));
  target.goals = target.goals.filter((goal) => !legacySeedGoalIds.has(goal.id));
  target.proposals = target.proposals.filter((proposal) => !legacySeedProposalIds.has(proposal.id));
  return before.goals !== target.goals.length
    || before.tasks !== target.tasks.length
    || before.proposals !== target.proposals.length;
}

function normalizeTrustLedger(entries) {
  return entries
    .filter((entry) => entry?.eventHash && entry?.signature)
    .map((entry) => ({
      id: String(entry.id || `ledger-${randomUUID()}`).slice(0, 100),
      nodeId: String(entry.nodeId || nodeIdentity.nodeId).slice(0, 100),
      type: String(entry.type || entry.signature?.type || "unknown").slice(0, 80),
      objectType: String(entry.objectType || entry.type || "unknown").slice(0, 80),
      objectId: entry.objectId ? String(entry.objectId).slice(0, 160) : null,
      objectHash: String(entry.objectHash || "").slice(0, 128),
      payloadHash: String(entry.payloadHash || entry.signature?.payloadHash || "").slice(0, 128),
      previousHash: entry.previousHash ? String(entry.previousHash).slice(0, 128) : null,
      eventHash: String(entry.eventHash).slice(0, 128),
      signature: entry.signature,
      createdAt: entry.createdAt || now()
    }));
}

function normalizeConnectorTokens(tokens) {
  return tokens.map((token) => ({
    ...token,
    status: token.status || "active",
    providers: token.providers || [],
    capabilities: token.capabilities || [],
    models: token.models || [],
    useCount: Number(token.useCount || 0),
    lastUsedAt: token.lastUsedAt || null,
    lastUsedMethod: token.lastUsedMethod || null,
    lastUsedPath: token.lastUsedPath || null,
    expiresAt: token.expiresAt || null,
    expiredAt: token.expiredAt || null,
    revokedAt: token.revokedAt || null,
    revokedReason: token.revokedReason || null,
    rotatedFromId: token.rotatedFromId || null,
    rotatedToId: token.rotatedToId || null
  }));
}

async function saveStore(next = store) {
  if (process.env.DATABASE_URL) return savePostgresStore(next);
  await writeFile(storePath, `${JSON.stringify(next, null, 2)}\n`);
}

async function loadNodeIdentity() {
  await mkdir(dataDir, { recursive: true });
  try {
    const loaded = JSON.parse(await readFile(identityPath, "utf8"));
    if (loaded.nodeId && loaded.publicKeyPem && loaded.privateKeyPem) return loaded;
  } catch {
    // Generate below.
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const identity = {
    nodeId: `node-${createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 32)}`,
    publicKeyPem,
    privateKeyPem,
    algorithm: "Ed25519",
    createdAt: now()
  };
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

function publicNodeIdentity() {
  return {
    nodeId: nodeIdentity.nodeId,
    publicKeyPem: nodeIdentity.publicKeyPem,
    algorithm: nodeIdentity.algorithm,
    createdAt: nodeIdentity.createdAt
  };
}

function signedContribution(type, payload = {}) {
  const signedAt = now();
  const payloadHash = objectHash(payload);
  const canonical = stableStringify({
    type,
    signedAt,
    payloadHash,
    payload
  });
  return {
    type,
    nodeId: nodeIdentity.nodeId,
    algorithm: nodeIdentity.algorithm,
    signedAt,
    payloadHash,
    signature: signPayload(null, Buffer.from(canonical), nodeIdentity.privateKeyPem).toString("base64")
  };
}

function recordSignedContribution(type, payload = {}, refs = {}) {
  const signature = signedContribution(type, payload);
  appendTrustLedger(signature, payload, refs);
  return signature;
}

function appendTrustLedger(signature, payload = {}, refs = {}) {
  if (!store) return null;
  store.trustLedger = normalizeTrustLedger(store.trustLedger || []);
  const previousHash = localTrustHead();
  const objectHash = refs.objectHash || signature.payloadHash || objectHashForRefs(refs, payload);
  const entry = {
    id: `ledger-${randomUUID()}`,
    nodeId: nodeIdentity.nodeId,
    type: signature.type,
    objectType: refs.objectType || signature.type,
    objectId: refs.objectId || null,
    objectHash,
    payloadHash: signature.payloadHash,
    previousHash,
    signature,
    createdAt: signature.signedAt
  };
  entry.eventHash = objectHashForRefs({
    id: entry.id,
    nodeId: entry.nodeId,
    type: entry.type,
    objectType: entry.objectType,
    objectId: entry.objectId,
    objectHash: entry.objectHash,
    payloadHash: entry.payloadHash,
    previousHash: entry.previousHash,
    signature: entry.signature,
    createdAt: entry.createdAt
  });
  store.trustLedger.unshift(entry);
  return entry;
}

function localTrustHead() {
  return (store?.trustLedger || []).find((entry) => entry.nodeId === nodeIdentity.nodeId)?.eventHash || null;
}

function trustHeadsByNode() {
  const heads = {};
  for (const entry of store?.trustLedger || []) {
    if (!entry.nodeId || heads[entry.nodeId]) continue;
    heads[entry.nodeId] = entry.eventHash;
  }
  return heads;
}

function objectHash(value) {
  return objectHashForRefs(value);
}

function objectHashForRefs(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (typeof value === "undefined") return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => typeof value[key] !== "undefined")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

async function loadPostgresStore() {
  await ensurePostgresSnapshotTable();
  const result = await postgresQuery("select payload from osa_app_state where id = $1", ["default"]);
  if (result.rows[0]?.payload) {
    const loaded = normalizeStore(result.rows[0].payload);
    const pruned = removeLegacySeedExamples(loaded);
    if (!loaded.proposals.length) {
      const seed = JSON.parse(await readFile(seedPath, "utf8"));
      loaded.proposals = seed.proposals || [];
      await savePostgresStore(loaded);
    } else if (pruned) {
      await savePostgresStore(loaded);
    }
    return loaded;
  }

  const seed = JSON.parse(await readFile(seedPath, "utf8"));
  const initial = normalizeStore({
    ...seed,
    agents: [],
    results: [],
    reviews: [],
    claims: [],
    users: [],
    sessions: [],
    agentProfiles: [],
    walletSessions: [],
    agentDonations: [],
    publicProjectReviews: [],
    publicRooms: [],
    publicProjects: [],
    connectorTokens: [],
    proposalVotes: [],
    uploadedArtifacts: [],
    trustLedger: [],
    events: []
  });
  await savePostgresStore(initial);
  return initial;
}

async function savePostgresStore(next = store) {
  await ensurePostgresSnapshotTable();
  await postgresQuery(
    `
      insert into osa_app_state (id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set payload = excluded.payload, updated_at = now()
    `,
    ["default", JSON.stringify(next)]
  );
}

async function ensurePostgresSnapshotTable() {
  await postgresQuery(`
    create table if not exists osa_app_state (
      id text primary key,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

async function postgresQuery(sql, params = []) {
  const pool = await postgresPool();
  return pool.query(sql, params);
}

async function postgresPool() {
  if (pgPool) return pgPool;
  const { Pool } = await import("pg");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
  });
  return pgPool;
}

function now() {
  return new Date().toISOString();
}

function afterMs(baseIso, durationMs) {
  return new Date(Date.parse(baseIso) + durationMs).toISOString();
}

function event(type, message, data = {}) {
  const entry = {
    id: `event-${randomUUID()}`,
    type,
    message,
    data,
    createdAt: now()
  };
  store.events.unshift(entry);
  store.events = store.events.slice(0, 100);
  broadcastRealtime("activity", entry);
}

function sendSse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastRealtime(eventName, data) {
  for (const client of realtimeClients) {
    try {
      sendSse(client.res, eventName, data);
    } catch {
      realtimeClients.delete(client);
    }
  }
}

function serveRealtimeStream(req, res) {
  const auth = authFromReq(req);
  if (!auth) return unauthorized(res, "Sign in before joining the realtime network stream");
  if (!enforceRateLimit(req, res, "events-stream", rateIdentity(req, auth), { limit: 20, windowMs: 60 * 1000 })) {
    return;
  }
  const userRealtimeClients = [...realtimeClients].filter((client) => client.userId === auth.user.id).length;
  if (realtimeClients.size >= maxRealtimeClients || userRealtimeClients >= maxRealtimeClientsPerUser) {
    return tooManyRequests(res, {
      limit: userRealtimeClients >= maxRealtimeClientsPerUser ? maxRealtimeClientsPerUser : maxRealtimeClients,
      remaining: 0,
      resetAt: Math.ceil((Date.now() + 60 * 1000) / 1000),
      retryAfterSeconds: 60
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    ...securityHeaders()
  });
  res.flushHeaders?.();

  const client = { res, userId: auth.user.id, connectedAt: now() };
  realtimeClients.add(client);
  sendSse(res, "connected", {
    userId: auth.user.id,
    serverTime: now(),
    lastEventId: store.events[0]?.id || null
  });

  const heartbeat = setInterval(() => {
    try {
      sendSse(res, "heartbeat", { serverTime: now() });
    } catch {
      clearInterval(heartbeat);
      realtimeClients.delete(client);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(client);
  });
}

function serveAgentGuiNetworkStream(req, res) {
  if (!enforceRateLimit(req, res, "agentgui-network-stream", `ip:${clientIdentity(req)}`, { limit: 20, windowMs: 60 * 1000 })) {
    return;
  }
  const userId = `agentgui:${clientIdentity(req)}`;
  const userRealtimeClients = [...realtimeClients].filter((client) => client.userId === userId).length;
  if (realtimeClients.size >= maxRealtimeClients || userRealtimeClients >= maxRealtimeClientsPerUser) {
    return tooManyRequests(res, {
      limit: userRealtimeClients >= maxRealtimeClientsPerUser ? maxRealtimeClientsPerUser : maxRealtimeClients,
      remaining: 0,
      resetAt: Math.ceil((Date.now() + 60 * 1000) / 1000),
      retryAfterSeconds: 60
    });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    ...securityHeaders()
  });
  res.flushHeaders?.();

  const client = { res, userId, connectedAt: now() };
  realtimeClients.add(client);
  sendSse(res, "connected", {
    serverTime: now(),
    lastEventId: store.events[0]?.id || null
  });

  const heartbeat = setInterval(() => {
    try {
      sendSse(res, "heartbeat", { serverTime: now() });
    } catch {
      clearInterval(heartbeat);
      realtimeClients.delete(client);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(client);
  });
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders(),
    ...headers
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...securityHeaders(), ...headers });
  res.end();
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: "bad_request", message });
}

function unauthorized(res, message = "Authentication required") {
  sendJson(res, 401, { error: "unauthorized", message });
}

function forbidden(res, message = "Forbidden") {
  sendJson(res, 403, { error: "forbidden", message });
}

function payloadTooLarge(res, message = "Payload too large") {
  sendJson(res, 413, { error: "payload_too_large", message });
}

function tooManyRequests(res, result) {
  sendJson(
    res,
    429,
    {
      error: "rate_limited",
      message: "Too many requests. Slow down and retry after the rate limit window resets.",
      retryAfterSeconds: result.retryAfterSeconds
    },
    {
      "retry-after": String(result.retryAfterSeconds),
      "x-ratelimit-limit": String(result.limit),
      "x-ratelimit-remaining": String(result.remaining),
      "x-ratelimit-reset": String(result.resetAt)
    }
  );
}

function securityHeaders(options = {}) {
  const styleSrc = options.allowInlineStyles ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
  const connectSrc = options.allowWebSockets ? "connect-src 'self' ws: wss:" : "connect-src 'self'";
  return {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      styleSrc,
      "img-src 'self' data: blob:",
      connectSrc,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

async function readJson(req, maxBytes = maxJsonBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`JSON body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    error.statusCode = 400;
    error.message = "Invalid JSON body";
    throw error;
  }
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function cookieValue(req, name) {
  const header = String(req.headers.cookie || "");
  const cookies = header.split(";").map((item) => item.trim()).filter(Boolean);
  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    if (index === -1) continue;
    if (cookie.slice(0, index) === name) return decodeURIComponent(cookie.slice(index + 1));
  }
  return "";
}

function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.OSA_COOKIE_SECURE === "1" ? "; Secure" : "";
  return `osa_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function oauthStateCookie(stateId = "", maxAge = 10 * 60) {
  const secure = process.env.OSA_COOKIE_SECURE === "1" ? "; Secure" : "";
  return `osa_oauth_state=${encodeURIComponent(stateId)}; Path=/api/auth/oauth; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 180);
}

function localPasswordRequired() {
  if (process.env.OSA_LOCAL_PASSWORD_REQUIRED === "1") return true;
  if (process.env.OSA_LOCAL_PASSWORD_REQUIRED === "0") return false;
  return isProduction && ["local", "hybrid"].includes(authMode) && process.env.OSA_ALLOW_PASSWORDLESS_LOCAL_AUTH !== "1";
}

function createPasswordRecord(password) {
  const salt = randomBytes(16).toString("base64");
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64");
  return {
    passwordHash: hash,
    passwordSalt: salt,
    passwordAlgorithm: "pbkdf2-sha256",
    passwordIterations: 210000,
    passwordUpdatedAt: now()
  };
}

function verifyPassword(user, password) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const iterations = Number(user.passwordIterations || 210000);
  const expected = Buffer.from(user.passwordHash, "base64");
  const actual = pbkdf2Sync(password, user.passwordSalt, iterations, expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setUserPassword(user, password) {
  Object.assign(user, createPasswordRecord(password));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    lastSeen: user.lastSeen
  };
}

function upsertUser(email, name) {
  let user = store.users.find((item) => item.email === email);
  if (!user) {
    user = {
      id: `user-${randomUUID()}`,
      email,
      name,
      createdAt: now(),
      lastSeen: now()
    };
    store.users.push(user);
    event("user_created", `${user.name} created an account`, { userId: user.id });
  } else {
    user.name = name || user.name;
    user.lastSeen = now();
  }
  return user;
}

function createSession(user) {
  const token = `osa_${randomUUID()}_${randomUUID()}`;
  const session = {
    id: `session-${randomUUID()}`,
    userId: user.id,
    tokenHash: hashToken(token),
    createdAt: now(),
    lastSeen: now()
  };
  store.sessions.push(session);
  return { session, token };
}

function authFromReq(req) {
  const rawHeader = req.headers["x-agentswarm-session"] || req.headers.authorization || "";
  const headerToken = String(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).replace(/^Bearer\s+/i, "").trim();
  const token = headerToken || cookieValue(req, "osa_session");
  if (!token) return null;
  const session = store.sessions.find((item) => item.tokenHash === hashToken(token));
  if (!session) return null;
  const user = store.users.find((item) => item.id === session.userId);
  if (!user) return null;
  session.lastSeen = now();
  user.lastSeen = now();
  return { user, session };
}

function clientIdentity(req) {
  const forwarded = trustProxyHeaders ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateIdentity(req, auth = null, extra = "") {
  if (auth?.user?.id) return `user:${auth.user.id}${extra}`;
  return `ip:${clientIdentity(req)}${extra}`;
}

function checkRateLimit(name, identity, options = {}) {
  if (rateLimitMultiplier === 0) {
    return { ok: true, limit: Infinity, remaining: Infinity, resetAt: Math.ceil(Date.now() / 1000), retryAfterSeconds: 0 };
  }

  const windowMs = Number(options.windowMs || 60 * 1000);
  const rawLimit = Number(options.limit || 60);
  const limit = Math.max(1, Math.floor(rawLimit * rateLimitMultiplier));
  const key = `${name}:${identity}`;
  const timestamp = Date.now();
  const cutoff = timestamp - windowMs;
  const hits = (rateLimitBuckets.get(key) || []).filter((hit) => hit > cutoff);
  const resetAtMs = hits[0] ? hits[0] + windowMs : timestamp + windowMs;

  if (hits.length >= limit) {
    rateLimitBuckets.set(key, hits);
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: Math.ceil(resetAtMs / 1000),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - timestamp) / 1000))
    };
  }

  hits.push(timestamp);
  rateLimitBuckets.set(key, hits);
  pruneRateLimitBuckets(timestamp);
  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - hits.length),
    resetAt: Math.ceil(resetAtMs / 1000),
    retryAfterSeconds: 0
  };
}

function enforceRateLimit(req, res, name, identity, options = {}) {
  const result = checkRateLimit(name, identity, options);
  if (!result.ok) {
    tooManyRequests(res, result);
    return false;
  }
  return true;
}

function pruneRateLimitBuckets(timestamp = Date.now()) {
  if (rateLimitBuckets.size < 1000) return;
  const cutoff = timestamp - 60 * 60 * 1000;
  for (const [key, hits] of rateLimitBuckets.entries()) {
    const kept = hits.filter((hit) => hit > cutoff);
    if (kept.length) rateLimitBuckets.set(key, kept);
    else rateLimitBuckets.delete(key);
  }
}

function connectorTokenFromReq(req) {
  const rawHeader = req.headers["x-osa-connector-token"] || req.headers.authorization || "";
  const token = String(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).replace(/^Bearer\s+/i, "").trim();
  if (!token || !token.startsWith("osa_conn_")) return null;
  const connector = store.connectorTokens.find((item) => item.tokenHash === hashToken(token));
  if (!connector || connector.status !== "active") return null;
  if (connector.expiresAt && Date.parse(connector.expiresAt) < Date.now()) {
    expireConnectorToken(connector);
    return null;
  }
  const user = store.users.find((item) => item.id === connector.userId);
  if (!user) return null;
  touchConnectorToken(connector, req);
  user.lastSeen = now();
  return { token: connector, user };
}

function touchConnectorToken(connector, req) {
  connector.lastUsedAt = now();
  connector.lastUsedMethod = String(req.method || "GET").slice(0, 12);
  connector.lastUsedPath = String(req.url || "").split("?")[0].slice(0, 160);
  connector.useCount = Number(connector.useCount || 0) + 1;
}

function authorizeConnectorAgent(req, agent) {
  const connector = connectorTokenFromReq(req);
  if (!connector) return { ok: true, connector: null };
  if (agent.connectorTokenId !== connector.token.id) {
    return { ok: false, connector, message: "Connector token is not scoped to this agent" };
  }
  return { ok: true, connector };
}

function authorizeAgentAccess(req, agent) {
  const connectorAccess = authorizeConnectorAgent(req, agent);
  if (!connectorAccess.ok) return { ...connectorAccess, statusCode: 403 };
  if (connectorAccess.connector) return { ...connectorAccess, auth: null, user: connectorAccess.connector.user };

  const auth = authFromReq(req);
  if (!auth) {
    return {
      ok: false,
      statusCode: 401,
      message: "Authenticate with the owning session or scoped connector token before controlling this agent"
    };
  }
  if (!agent.userId || agent.userId !== auth.user.id) {
    return {
      ok: false,
      statusCode: 403,
      auth,
      message: "Authenticated user does not own this agent"
    };
  }
  return { ok: true, connector: null, auth, user: auth.user };
}

function rejectAgentAccess(res, access) {
  if (access.statusCode === 401) return unauthorized(res, access.message);
  return forbidden(res, access.message);
}

function publicState(auth = null) {
  if (!auth) return publicLockedState();

  const activeGoals = store.goals.filter((goal) => goal.status !== "completed");
  const activeGoalIds = new Set(
    store.agents
      .filter((agent) => agent.status === "online")
      .filter((agent) => activeGoals.some((goal) => goal.id === agent.goalId))
      .map((agent) => agent.goalId)
  );

  return {
    goals: store.goals,
    agents: store.agents,
    tasks: store.tasks,
    results: store.results,
    reviews: store.reviews,
    publicProjectReviews: store.publicProjectReviews,
    claims: store.claims,
    resultPool: store.resultPool,
    proposals: store.proposals,
    proposalVotes: store.proposalVotes,
    trustLedger: publicTrustLedger(),
    events: store.events,
    stats: {
      users: store.users.length,
      goals: activeGoals.length,
      onlineAgents: store.agents.filter((agent) => agent.status === "online").length,
      activeGoals: activeGoalIds.size,
      resultPool: store.resultPool.length,
      votingProposals: store.proposals.filter((proposal) => proposal.status === "voting").length,
      openTasks: store.tasks.filter((task) => task.status === "open" && activeGoals.some((goal) => goal.id === task.goalId)).length,
      leasedTasks: store.tasks.filter((task) => task.status === "leased").length,
      pendingReviews: store.results.filter((result) => ["needs_review", "in_consensus"].includes(result.status)).length,
      acceptedClaims: store.claims.filter((claim) => claim.status === "accepted").length,
      trustEvents: (store.trustLedger || []).length,
      trustHead: localTrustHead()
    },
    viewer: publicUser(auth?.user),
    viewerConnectors: auth ? publicConnectorTokensForUser(auth.user.id) : [],
    connectorCommandCwd: rootDir,
    runtime: publicRuntime(),
    serverTime: now()
  };
}

function publicLockedState() {
  return {
    goals: [],
    agents: [],
    tasks: [],
    results: [],
    reviews: [],
    publicProjectReviews: [],
    claims: [],
    resultPool: [],
    proposals: [],
    proposalVotes: [],
    trustLedger: [],
    events: [],
    stats: {
      users: 0,
      goals: 0,
      onlineAgents: 0,
      activeGoals: 0,
      resultPool: 0,
      votingProposals: 0,
      openTasks: 0,
      leasedTasks: 0,
      pendingReviews: 0,
      acceptedClaims: 0,
      trustEvents: 0,
      trustHead: null
    },
    viewer: null,
    viewerConnectors: [],
    connectorCommandCwd: null,
    runtime: publicRuntime(),
    serverTime: now()
  };
}

function publicTrustLedger(limit = 50) {
  return (store.trustLedger || [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(publicTrustLedgerEntry);
}

function publicTrustLedgerEntry(entry) {
  return {
    id: entry.id,
    nodeId: entry.nodeId,
    type: entry.type,
    objectType: entry.objectType,
    objectId: entry.objectId,
    objectHash: entry.objectHash,
    payloadHash: entry.payloadHash,
    previousHash: entry.previousHash,
    eventHash: entry.eventHash,
    signature: entry.signature,
    createdAt: entry.createdAt
  };
}

function publicArtifact(artifact) {
  if (!artifact) return null;
  return {
    id: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    uri: artifact.uri,
    size: artifact.size,
    description: artifact.description || "",
    uploadedBy: artifact.uploadedBy || null,
    agentId: artifact.agentId || null,
    goalId: artifact.goalId || null,
    taskId: artifact.taskId || null,
    resultId: artifact.resultId || null,
    sha256: artifact.sha256 || null,
    signature: artifact.signature || null,
    createdAt: artifact.createdAt
  };
}

function federationAccessFromReq(req) {
  if (!federationEnabled) {
    return { ok: false, status: 404, message: "Federation is disabled on this node" };
  }
  if (!federationTokenHash) {
    return process.env.OSA_ALLOW_INSECURE_FEDERATION === "1"
      ? { ok: true }
      : { ok: false, status: 403, message: "Federation token is not configured" };
  }
  const rawHeader = req.headers["x-osa-federation-token"] || req.headers.authorization || "";
  const token = String(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, message: "Federation token required" };
  const expected = Buffer.from(federationTokenHash);
  const actual = Buffer.from(hashToken(token));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, status: 403, message: "Invalid federation token" };
  }
  return { ok: true };
}

function publicFederationSnapshot() {
  return {
    protocol: "osa-federation-snapshot",
    version: 1,
    generatedAt: now(),
    node: publicNodeIdentity(),
    head: localTrustHead(),
    headsByNode: trustHeadsByNode(),
    collections: {
      goals: federationSlice(store.goals).map(publicFederatedGoal),
      agents: federationSlice(store.agents).map(publicFederatedAgent),
      tasks: federationSlice(store.tasks).map(publicFederatedTask),
      results: federationSlice(store.results).map(publicFederatedResult),
      reviews: federationSlice(store.reviews).map(publicFederatedReview),
      claims: federationSlice(store.claims).map(publicFederatedClaim),
      resultPool: federationSlice(store.resultPool).map(publicFederatedResultPoolEntry),
      proposals: federationSlice(store.proposals).map(publicFederatedProposal),
      proposalVotes: federationSlice(store.proposalVotes).map(publicFederatedProposalVote),
      uploadedArtifacts: federationSlice(store.uploadedArtifacts).map(publicFederatedArtifact),
      publicRooms: federationSlice(store.publicRooms).map(publicFederatedPublicCollection),
      publicProjects: federationSlice(store.publicProjects).map(publicFederatedPublicCollection),
      publicProjectReviews: federationSlice(store.publicProjectReviews).map(publicFederatedProjectReview),
      trustLedger: publicTrustLedger(500),
      events: store.events
        .filter((entry) => !["federation_imported", "user_signed_in"].includes(entry.type))
        .slice(0, 100)
        .map(publicFederatedEvent)
    }
  };
}

function federationSlice(collection) {
  return Array.isArray(collection) ? collection.slice(0, federationCollectionLimit) : [];
}

function publicFederatedGoal(goal) {
  return pick(goal, [
    "id",
    "title",
    "description",
    "status",
    "supporters",
    "sourceProposalId",
    "createdAt",
    "completedAt",
    "finalResultId"
  ]);
}

function publicFederatedAgent(agent) {
  return {
    ...pick(agent, [
      "id",
      "name",
      "goalId",
      "capabilities",
      "models",
      "provider",
      "providers",
      "maxConcurrentTasks",
      "reputation",
      "status",
      "lastSeen",
      "createdAt"
    ]),
    userId: null,
    connectorTokenId: null
  };
}

function publicFederatedTask(task) {
  return pick(task, [
    "id",
    "goalId",
    "type",
    "title",
    "description",
    "requiredCapabilities",
    "priority",
    "status",
    "assignedAgentId",
    "leaseId",
    "leaseUntil",
    "iteration",
    "lastRevisionReason",
    "reviewForResultId",
    "assignedReviewerId",
    "assignedReviewerName",
    "sharedPublic",
    "sharedPublicAt",
    "copyCount",
    "lastCopiedAt",
    "ownerWalletAddress",
    "agentGuiRoom",
    "agentGuiAgent",
    "agentGuiModel",
    "createdAt",
    "updatedAt"
  ]);
}

function publicFederatedResult(result) {
  return {
    ...pick(result, [
      "id",
      "taskId",
      "goalId",
      "agentId",
      "summary",
      "content",
      "sources",
      "confidence",
      "status",
      "iteration",
      "consensus",
      "signature",
      "createdAt"
    ]),
    artifacts: normalizeArtifacts(result?.artifacts)
  };
}

function publicFederatedReview(review) {
  return pick(review, [
    "id",
    "resultId",
    "goalId",
    "taskId",
    "agentId",
    "decision",
    "score",
    "reason",
    "signature",
    "createdAt"
  ]);
}

function publicFederatedClaim(claim) {
  return pick(claim, [
    "id",
    "goalId",
    "resultId",
    "title",
    "statement",
    "sources",
    "confidence",
    "proposedBy",
    "verifiedBy",
    "status",
    "createdAt"
  ]);
}

function publicFederatedResultPoolEntry(entry) {
  return {
    ...pick(entry, [
      "id",
      "goalId",
      "goalTitle",
      "taskId",
      "taskTitle",
      "resultId",
      "agentId",
      "reviewerAgentId",
      "consensus",
      "summary",
      "content",
      "sources",
      "confidence",
      "status",
      "createdAt"
    ]),
    artifacts: normalizeArtifacts(entry?.artifacts)
  };
}

function publicFederatedProposal(proposal) {
  return {
    ...pick(proposal, [
    "id",
    "title",
    "description",
    "createdByHash",
    "createdByName",
    "status",
    "score",
    "votes",
    "createdAt",
    "votingEndsAt",
    "promotedAt",
    "promotionMode",
    "signature"
    ]),
    createdBy: null
  };
}

function publicFederatedProposalVote(vote) {
  return pick(vote, ["id", "proposalId", "agentId", "score", "reason", "signature", "createdAt"]);
}

function publicFederatedArtifact(artifact) {
  return {
    ...publicArtifact(artifact),
    uploadedBy: null
  };
}

function publicFederatedPublicCollection(item) {
  return pick(item, [
    "id",
    "type",
    "sourceTeamId",
    "name",
    "summary",
    "taskIds",
    "rooms",
    "sharedAt",
    "updatedAt",
    "copyCount",
    "lastCopiedAt",
    "ownerWalletAddress"
  ]);
}

function publicFederatedProjectReview(review) {
  return pick(review, [
    "id",
    "projectId",
    "walletAddress",
    "rating",
    "title",
    "comment",
    "createdAt",
    "updatedAt"
  ]);
}

function publicFederatedEvent(eventEntry) {
  return {
    ...pick(eventEntry, ["id", "type", "message", "createdAt"]),
    data: sanitizeFederatedEventData(eventEntry.data)
  };
}

function sanitizeFederatedEventData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const output = {};
  for (const [key, value] of Object.entries(data)) {
    if (["userId", "sessionId", "connectorTokenId", "token", "rawToken"].includes(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) output[key] = value;
  }
  return output;
}

function federationSignatureVerificationEnabled() {
  return (
    process.env.OSA_FEDERATION_REQUIRE_SIGNATURES === "1" ||
    Boolean((process.env.OSA_FEDERATION_TRUSTED_NODES || "").trim()) ||
    Boolean(federationTrustedNodesPath)
  );
}

function loadFederationTrustedNodes() {
  const trusted = new Map([[nodeIdentity.nodeId, publicNodeIdentity()]]);
  addTrustedNodeEntries(trusted, process.env.OSA_FEDERATION_TRUSTED_NODES || "");
  if (federationTrustedNodesPath) {
    try {
      addTrustedNodeEntries(trusted, readFileSync(federationTrustedNodesPath, "utf8"));
    } catch (error) {
      const wrapped = new Error(`Unable to read OSA_FEDERATION_TRUSTED_NODES_PATH: ${error.message}`);
      wrapped.statusCode = 400;
      throw wrapped;
    }
  }
  return trusted;
}

function addTrustedNodeEntries(trusted, raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`Invalid federation trusted node JSON: ${error.message}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }
  const entries = Array.isArray(parsed)
    ? parsed.map((item) => [item?.nodeId, item])
    : Object.entries(parsed);
  for (const [nodeId, value] of entries) {
    const publicKeyPem = typeof value === "string" ? value : value?.publicKeyPem;
    if (!nodeId || !publicKeyPem) continue;
    trusted.set(String(nodeId), {
      nodeId: String(nodeId),
      publicKeyPem: String(publicKeyPem),
      algorithm: typeof value === "object" && value?.algorithm ? String(value.algorithm) : "Ed25519"
    });
  }
}

function verifiedFederationCollections(snapshot) {
  const collections = snapshot.collections || {};
  if (!federationSignatureVerificationEnabled()) return collections;

  const trusted = loadFederationTrustedNodes();
  verifyFederationSnapshotNode(snapshot.node, trusted);
  return {
    ...collections,
    proposals: verifiedSignedCollection("proposals", collections.proposals, trusted),
    proposalVotes: verifiedSignedCollection("proposalVotes", collections.proposalVotes, trusted),
    results: verifiedSignedCollection("results", collections.results, trusted),
    reviews: verifiedSignedCollection("reviews", collections.reviews, trusted),
    uploadedArtifacts: verifiedSignedCollection("uploadedArtifacts", collections.uploadedArtifacts, trusted),
    trustLedger: verifiedTrustLedgerEntries(collections.trustLedger, trusted)
  };
}

function verifyFederationSnapshotNode(node, trusted) {
  if (!node?.nodeId || !node?.publicKeyPem) {
    const error = new Error("Federation snapshot is missing node identity");
    error.statusCode = 400;
    throw error;
  }
  const trustedNode = trusted.get(node.nodeId);
  if (!trustedNode) {
    const error = new Error(`Federation node ${node.nodeId} is not in the trusted node allowlist`);
    error.statusCode = 403;
    throw error;
  }
  if (normalizePem(trustedNode.publicKeyPem) !== normalizePem(node.publicKeyPem)) {
    const error = new Error(`Federation node ${node.nodeId} public key does not match the trusted allowlist`);
    error.statusCode = 403;
    throw error;
  }
  if (nodeIdForPublicKey(node.publicKeyPem) !== node.nodeId) {
    const error = new Error(`Federation node ${node.nodeId} does not match its public key`);
    error.statusCode = 403;
    throw error;
  }
}

function verifiedSignedCollection(name, incoming, trusted) {
  if (!Array.isArray(incoming)) return [];
  return incoming.slice(0, federationCollectionLimit).filter((item) => verifyFederatedSignedItem(name, item, trusted));
}

function verifyFederatedSignedItem(name, item, trusted) {
  if (!item?.signature?.signature) return false;
  const payload = signedPayloadForFederatedItem(name, item);
  if (!payload) return false;
  const signature = item.signature;
  const trustedNode = trusted.get(signature.nodeId);
  if (!trustedNode) return false;
  if (!verifySignedContribution(signature, payload, trustedNode.publicKeyPem)) {
    const error = new Error(`Invalid ${name} signature for ${item.id || signature.type}`);
    error.statusCode = 400;
    throw error;
  }
  return true;
}

function signedPayloadForFederatedItem(name, item) {
  if (name === "proposals") {
    if (!item.createdByHash) return null;
    return {
      proposalId: item.id,
      title: item.title,
      descriptionHash: hashToken(item.description),
      createdByHash: item.createdByHash
    };
  }
  if (name === "proposalVotes") {
    return {
      voteId: item.id,
      proposalId: item.proposalId,
      agentId: item.agentId,
      score: item.score,
      reasonHash: hashToken(item.reason)
    };
  }
  if (name === "results") {
    return {
      resultId: item.id,
      taskId: item.taskId,
      goalId: item.goalId,
      agentId: item.agentId,
      summaryHash: hashToken(item.summary),
      contentHash: hashToken(item.content),
      artifactIds: normalizeArtifacts(item.artifacts).map((artifact) => artifact.id).filter(Boolean)
    };
  }
  if (name === "reviews") {
    return {
      reviewId: item.id,
      resultId: item.resultId,
      taskId: item.taskId,
      agentId: item.agentId,
      decision: item.decision,
      score: item.score,
      reasonHash: hashToken(item.reason)
    };
  }
  if (name === "uploadedArtifacts") {
    return {
      artifactId: item.id,
      name: item.name,
      kind: item.kind,
      size: item.size,
      sha256: item.sha256
    };
  }
  return null;
}

function verifySignedContribution(signature, payload, publicKeyPem) {
  if (!signature?.signature || signature.algorithm !== "Ed25519") return false;
  if (signature.payloadHash !== objectHash(payload)) return false;
  const canonical = stableStringify({
    type: signature.type,
    signedAt: signature.signedAt,
    payloadHash: signature.payloadHash,
    payload
  });
  try {
    return verifyPayload(null, Buffer.from(canonical), publicKeyPem, Buffer.from(signature.signature, "base64"));
  } catch {
    return false;
  }
}

function verifiedTrustLedgerEntries(incoming, trusted) {
  if (!Array.isArray(incoming)) return [];
  return normalizeTrustLedger(incoming)
    .slice(0, 1000)
    .filter((entry) => verifyFederatedTrustLedgerEntry(entry, trusted));
}

function verifyFederatedTrustLedgerEntry(entry, trusted) {
  if (!entry?.signature?.signature) return false;
  if (entry.nodeId !== entry.signature.nodeId) return false;
  if (!trusted.has(entry.nodeId)) return false;
  if (entry.signature.payloadHash !== entry.payloadHash) return false;
  const expectedEventHash = objectHashForRefs({
    id: entry.id,
    nodeId: entry.nodeId,
    type: entry.type,
    objectType: entry.objectType,
    objectId: entry.objectId,
    objectHash: entry.objectHash,
    payloadHash: entry.payloadHash,
    previousHash: entry.previousHash,
    signature: entry.signature,
    createdAt: entry.createdAt
  });
  if (expectedEventHash !== entry.eventHash) {
    const error = new Error(`Invalid Trust Ledger event hash for ${entry.id || entry.eventHash}`);
    error.statusCode = 400;
    throw error;
  }
  return true;
}

function normalizePem(value) {
  return String(value || "").replace(/\s+/g, "");
}

function nodeIdForPublicKey(publicKeyPem) {
  return `node-${createHash("sha256").update(String(publicKeyPem)).digest("hex").slice(0, 32)}`;
}

function pick(input, keys) {
  const output = {};
  for (const key of keys) {
    if (typeof input?.[key] !== "undefined") output[key] = input[key];
  }
  return output;
}

function importFederationSnapshot(snapshot) {
  if (!snapshot || snapshot.protocol !== "osa-federation-snapshot" || !snapshot.collections) {
    throw new Error("Invalid federation snapshot");
  }
  const collections = verifiedFederationCollections(snapshot);
  const changed = {
    goals: mergeFederatedCollection("goals", collections.goals, publicFederatedGoal),
    agents: mergeFederatedCollection("agents", collections.agents, publicFederatedAgent),
    tasks: mergeFederatedCollection("tasks", collections.tasks, publicFederatedTask),
    results: mergeFederatedCollection("results", collections.results, publicFederatedResult),
    reviews: mergeFederatedCollection("reviews", collections.reviews, publicFederatedReview),
    claims: mergeFederatedCollection("claims", collections.claims, publicFederatedClaim),
    resultPool: mergeFederatedCollection("resultPool", collections.resultPool, publicFederatedResultPoolEntry),
    proposals: mergeFederatedCollection("proposals", collections.proposals, publicFederatedProposal),
    proposalVotes: mergeFederatedCollection("proposalVotes", collections.proposalVotes, publicFederatedProposalVote),
    uploadedArtifacts: mergeFederatedCollection("uploadedArtifacts", collections.uploadedArtifacts, publicFederatedArtifact),
    publicRooms: mergeFederatedPublicCollections("publicRooms", collections.publicRooms, "room"),
    publicProjects: mergeFederatedPublicCollections("publicProjects", collections.publicProjects, "project"),
    publicProjectReviews: mergeFederatedProjectReviews(collections.publicProjectReviews),
    trustLedger: mergeFederatedTrustLedger(collections.trustLedger),
    events: mergeFederatedEvents(collections.events)
  };
  recomputeProposalTallies();
  reconcileImportedCompletedGoals();
  return changed;
}

function mergeFederatedCollection(name, incoming, sanitize) {
  if (!Array.isArray(incoming)) return 0;
  if (!Array.isArray(store[name])) store[name] = [];
  let merged = 0;
  for (const rawItem of incoming.slice(0, federationCollectionLimit)) {
    if (!rawItem?.id) continue;
    const item = sanitize(rawItem);
    if (!item.id) continue;
    const existingIndex = store[name].findIndex((candidate) => candidate.id === item.id);
    if (existingIndex === -1) {
      store[name].push(item);
      merged += 1;
      continue;
    }
    const existing = store[name][existingIndex];
    const chosen = chooseFederatedItem(name, existing, item);
    if (chosen !== existing) {
      store[name][existingIndex] = preserveLocalPrivateFields(name, existing, chosen);
      merged += 1;
    }
  }
  return merged;
}

function mergeFederatedPublicCollections(name, incoming, type) {
  if (!Array.isArray(incoming)) return 0;
  if (!Array.isArray(store[name])) store[name] = [];
  let merged = 0;
  for (const item of normalizePublicCollections(incoming, type).slice(0, federationCollectionLimit)) {
    const existingIndex = store[name].findIndex((candidate) => candidate.id === item.id);
    if (existingIndex === -1) {
      store[name].push(item);
      merged += 1;
      continue;
    }
    const existing = store[name][existingIndex];
    const chosen = chooseFederatedItem(name, existing, item);
    if (chosen !== existing) {
      store[name][existingIndex] = chosen;
      merged += 1;
    }
  }
  store[name].sort((a, b) => String(b.sharedAt).localeCompare(String(a.sharedAt)));
  return merged;
}

function mergeFederatedProjectReviews(incoming) {
  if (!Array.isArray(incoming)) return 0;
  store.publicProjectReviews = normalizePublicProjectReviews(store.publicProjectReviews || []);
  let merged = 0;
  for (const review of normalizePublicProjectReviews(incoming).slice(0, federationCollectionLimit)) {
    const existingIndex = store.publicProjectReviews.findIndex((item) => item.id === review.id);
    if (existingIndex === -1) {
      store.publicProjectReviews.push(review);
      merged += 1;
      continue;
    }
    const existing = store.publicProjectReviews[existingIndex];
    if (Date.parse(review.updatedAt || review.createdAt || 0) > Date.parse(existing.updatedAt || existing.createdAt || 0)) {
      store.publicProjectReviews[existingIndex] = review;
      merged += 1;
    }
  }
  store.publicProjectReviews.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return merged;
}

function chooseFederatedItem(name, existing, incoming) {
  if (name === "tasks") {
    const existingIteration = Number(existing.iteration || 1);
    const incomingIteration = Number(incoming.iteration || 1);
    if (incomingIteration !== existingIteration) return incomingIteration > existingIteration ? incoming : existing;
    const existingRank = taskStatusRank(existing.status);
    const incomingRank = taskStatusRank(incoming.status);
    if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
  }
  if (name === "results") {
    const existingRank = resultStatusRank(existing.status);
    const incomingRank = resultStatusRank(incoming.status);
    if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
  }
  if (name === "proposals") {
    const existingRank = proposalStatusRank(existing.status);
    const incomingRank = proposalStatusRank(incoming.status);
    if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
  }
  const existingTime = Date.parse(existing.updatedAt || existing.completedAt || existing.promotedAt || existing.createdAt || 0);
  const incomingTime = Date.parse(incoming.updatedAt || incoming.completedAt || incoming.promotedAt || incoming.createdAt || 0);
  return incomingTime > existingTime ? incoming : existing;
}

function preserveLocalPrivateFields(name, existing, incoming) {
  if (name === "agents") {
    return {
      ...incoming,
      userId: existing.userId || incoming.userId || null,
      connectorTokenId: existing.connectorTokenId || incoming.connectorTokenId || null
    };
  }
  if (name === "proposals") {
    return {
      ...incoming,
      createdBy: existing.createdBy || incoming.createdBy || null
    };
  }
  if (name === "uploadedArtifacts") {
    return {
      ...incoming,
      uploadedBy: existing.uploadedBy || incoming.uploadedBy || null,
      storage: existing.storage || incoming.storage || null,
      storedName: existing.storedName || incoming.storedName || null
    };
  }
  return incoming;
}

function taskStatusRank(status) {
  return {
    open: 1,
    leased: 2,
    in_consensus: 3,
    needs_review: 3,
    needs_revision: 4,
    done: 5
  }[status] || 0;
}

function resultStatusRank(status) {
  return {
    in_consensus: 1,
    needs_review: 1,
    needs_revision: 2,
    rejected: 2,
    accepted: 3
  }[status] || 0;
}

function proposalStatusRank(status) {
  return {
    voting: 1,
    promoted: 2,
    archived: 2
  }[status] || 0;
}

function mergeFederatedTrustLedger(incoming) {
  if (!Array.isArray(incoming)) return 0;
  store.trustLedger = normalizeTrustLedger(store.trustLedger || []);
  let merged = 0;
  for (const entry of normalizeTrustLedger(incoming).slice(0, 1000)) {
    if (store.trustLedger.some((item) => item.eventHash === entry.eventHash)) continue;
    store.trustLedger.push(entry);
    merged += 1;
  }
  store.trustLedger.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return merged;
}

function mergeFederatedEvents(incoming) {
  if (!Array.isArray(incoming)) return 0;
  let merged = 0;
  for (const eventEntry of incoming.slice(0, 200)) {
    if (!eventEntry?.id || store.events.some((item) => item.id === eventEntry.id)) continue;
    store.events.push(publicFederatedEvent(eventEntry));
    merged += 1;
  }
  store.events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  store.events = store.events.slice(0, 100);
  return merged;
}

function recomputeProposalTallies() {
  for (const proposal of store.proposals) {
    const votes = store.proposalVotes.filter((vote) => vote.proposalId === proposal.id);
    proposal.votes = votes.length;
    proposal.score = Number(votes.reduce((total, vote) => total + Number(vote.score || 0), 0).toFixed(2));
  }
}

function reconcileImportedCompletedGoals() {
  for (const goal of store.goals) {
    if (goal.status !== "completed") continue;
    for (const agent of store.agents.filter((item) => item.goalId === goal.id && item.status === "online")) {
      agent.status = "offline";
      agent.lastSeen = now();
      releaseAgentLeases(agent.id);
    }
  }
}

function startFederationPeerSync() {
  if (!federationEnabled || !federationPeers.length) return;
  if (!federationTokenHash) {
    console.warn("OSA federation peers configured but OSA_FEDERATION_TOKEN is missing; peer sync disabled.");
    return;
  }

  const tick = () => {
    for (const peer of federationPeers) {
      syncFederationPeer(peer).catch((error) => {
        console.warn(`OSA federation sync failed for ${peer}: ${error.message}`);
      });
    }
  };
  setTimeout(tick, 250).unref?.();
  setInterval(tick, federationSyncMs).unref?.();
}

async function syncFederationPeer(peer) {
  if (federationPeerSyncs.has(peer)) return;
  federationPeerSyncs.add(peer);
  try {
    const response = await fetch(`${peer}/api/federation/snapshot`, {
      headers: { "x-osa-federation-token": federationToken },
      signal: AbortSignal.timeout(8000)
    });
    const text = await readResponseTextLimited(response, federationSnapshotMaxBytes);
    if (!response.ok) throw new Error(`snapshot HTTP ${response.status}: ${text.slice(0, 240)}`);
    const snapshot = JSON.parse(text);
    if (snapshot.node?.nodeId === nodeIdentity.nodeId) return;
    const changed = importFederationSnapshot(snapshot);
    const totalChanged = Object.values(changed).reduce((total, count) => total + Number(count || 0), 0);
    if (!totalChanged) return;
    event("federation_imported", `Imported ${totalChanged} federated changes from ${snapshot.node?.nodeId || peer}`, {
      changed,
      peer,
      peerNodeId: snapshot.node?.nodeId || null
    });
    await saveStore();
  } finally {
    federationPeerSyncs.delete(peer);
  }
}

async function readResponseTextLimited(response, maxBytes) {
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`federation snapshot exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function publicConnectorTokensForUser(userId) {
  return store.connectorTokens
    .filter((token) => token.userId === userId)
    .map(publicConnectorToken)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function publicConnectorToken(token) {
  const goal = store.goals.find((item) => item.id === token.goalId);
  const managed = managedConnectorStatus(token.id);
  return {
    id: token.id,
    mode: token.mode,
    goalId: token.goalId,
    goalTitle: goal?.title || (token.mode === "voting" ? "Voting Pool" : "Unknown project"),
    agentId: token.agentId || null,
    name: token.name,
    status: token.status,
    provider: token.provider,
    providers: token.providers || [],
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt || null,
    lastUsedMethod: token.lastUsedMethod || null,
    lastUsedPath: token.lastUsedPath || null,
    useCount: Number(token.useCount || 0),
    expiresAt: token.expiresAt || null,
    expiredAt: token.expiredAt || null,
    revokedAt: token.revokedAt || null,
    revokedReason: token.revokedReason || null,
    rotatedFromId: token.rotatedFromId || null,
    rotatedToId: token.rotatedToId || null,
    managed: managed
      ? {
          status: managed.status,
          pid: managed.pid,
          startedAt: managed.startedAt,
          stoppedAt: managed.stoppedAt || null,
          exitedAt: managed.exitedAt || null,
          exitCode: managed.exitCode,
          signal: managed.signal || null
        }
      : null
  };
}

function managedConnectorStatus(connectorId) {
  const managed = managedConnectorProcesses.get(connectorId);
  if (!managed) return null;
  const connector = store.connectorTokens.find((item) => item.id === connectorId);
  if (managed.exitCode === null && managed.status !== "stopping") {
    managed.status = connector?.agentId ? "running" : "starting";
  }
  return managed;
}

function connectorRunner(connector) {
  const model = (connector.models || []).find((item) => String(item).startsWith("connector:"));
  const runner = String(model || "").replace("connector:", "");
  return ["stub", "provider", "openclaw", "codex"].includes(runner) ? runner : "stub";
}

function requestOrigin(req) {
  const fallbackHost = `${host}:${port}`;
  const requestHost = String(req.headers.host || fallbackHost);
  const forwardedProto = String(Array.isArray(req.headers["x-forwarded-proto"]) ? req.headers["x-forwarded-proto"][0] : req.headers["x-forwarded-proto"] || "");
  const proto = trustProxyHeaders && forwardedProto ? forwardedProto.split(",")[0].trim() : "http";
  return `${proto}://${requestHost}`;
}

function connectorCommandArgs(rawToken, connector, origin) {
  const runner = connectorRunner(connector);
  const args = [
    "apps/connector/connector.py",
    "--server",
    origin,
    "--connector-token",
    rawToken
  ];
  if (connector.mode === "voting") {
    args.push("--voting-pool");
  } else {
    args.push("--goal", connector.goalId);
  }
  args.push("--runner", runner, "--agent-name", connector.name || "Local Agent");
  if (connector.models?.length) {
    args.push("--models", connector.models.join(","));
  }
  if (connector.agentGuiRunOnce) {
    args.push("--once");
  }
  if (runner === "provider") {
    args.push("--provider", connector.provider, "--providers", (connector.providers || []).join(","), "--no-fallback-to-stub");
  }
  if (runner === "openclaw") {
    args.push("--openclaw-session-key", `osa-${connector.id}`, "--no-fallback-to-stub");
  }
  if (runner === "codex") {
    args.push("--no-fallback-to-stub");
  }
  return args;
}

function validateManagedConnectorStart(body = {}) {
  const models = normalizeList(body.models, []);
  const model = models.find((item) => String(item).startsWith("connector:"));
  const runner = String(model || "connector:stub").replace("connector:", "");
  if (!["stub", "provider", "openclaw", "codex"].includes(runner)) {
    throw new Error("Unknown connector runner");
  }
  if (runner !== "provider") return;
  const provider = normalizeProvider(body.provider);
  const envName = providerEnvNames[provider];
  if (!envName) throw new Error("Choose OpenAI, Anthropic, or Gemini before starting a provider connector");
  const browserKey = String(body.providerKey || body.providerKeys?.[provider] || "").trim();
  if (!browserKey && !String(process.env[envName] || "").trim()) {
    throw new Error(`Set ${envName} on the node or keep the selected provider key in this browser before starting the provider connector`);
  }
}

function startManagedConnector(req, rawToken, connector, body = {}) {
  if (managedConnectorProcesses.get(connector.id)?.exitCode === null) {
    throw new Error("Connector is already running from this dashboard");
  }

  const runner = connectorRunner(connector);
  const env = { ...process.env };
  if (runner === "provider") {
    const provider = normalizeProvider(connector.provider);
    const envName = providerEnvNames[provider];
    const browserKey = String(body.providerKey || body.providerKeys?.[provider] || "").trim();
    if (!envName) throw new Error("Choose OpenAI, Anthropic, or Gemini before starting a provider connector");
    if (browserKey) env[envName] = browserKey;
    if (!String(env[envName] || "").trim()) {
      throw new Error(`Set ${envName} on the node or keep the selected provider key in this browser before starting the provider connector`);
    }
  }

  const child = spawn("python3", connectorCommandArgs(rawToken, connector, requestOrigin(req)), {
    cwd: rootDir,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const managed = {
    child,
    pid: child.pid || null,
    status: "starting",
    startedAt: now(),
    stoppedAt: null,
    exitedAt: null,
    exitCode: null,
    signal: null,
    output: ""
  };
  managedConnectorProcesses.set(connector.id, managed);
  collectManagedConnectorOutput(managed, child.stdout);
  collectManagedConnectorOutput(managed, child.stderr);
  child.on("error", (error) => {
    managed.status = "failed";
    managed.exitedAt = now();
    managed.exitCode = -1;
    managed.output = trimManagedConnectorOutput(`${managed.output}\n${error.message}`);
    event("managed_connector_failed", `Dashboard connector failed to start`, {
      connectorId: connector.id,
      goalId: connector.goalId,
      runner
    });
  });
  child.on("exit", (code, signal) => {
    managed.exitedAt = now();
    managed.exitCode = code;
    managed.signal = signal || null;
    managed.status = managed.status === "stopping" || signal === "SIGTERM" ? "stopped" : code === 0 ? "exited" : "failed";
    const task = store.tasks.find((item) => item.agentGuiConnectorId === connector.id);
    if (task && connector.agentGuiRunOnce && managed.status === "failed" && !["done", "rejected", "deleted"].includes(task.status)) {
      task.status = "failed";
      task.agentGuiConnectorError = trimManagedConnectorOutput(managed.output || `Connector exited with ${code ?? signal ?? "unknown"}`);
      task.updatedAt = now();
      task.leaseUntil = null;
      task.leaseId = null;
    }
    event("managed_connector_exited", `Dashboard connector stopped`, {
      connectorId: connector.id,
      goalId: connector.goalId,
      runner,
      exitCode: code,
      signal: signal || null
    });
    saveStore().catch((error) => console.warn(`Unable to save managed connector exit event: ${error.message}`));
  });
  event("managed_connector_started", `${connector.name} started from dashboard`, {
    connectorId: connector.id,
    goalId: connector.goalId,
    runner,
    pid: managed.pid
  });
  return managed;
}

function collectManagedConnectorOutput(managed, stream) {
  stream?.on("data", (chunk) => {
    managed.output = trimManagedConnectorOutput(`${managed.output}${chunk.toString()}`);
  });
}

function trimManagedConnectorOutput(output) {
  return String(output || "").slice(-managedConnectorLogLimit);
}

function stopManagedConnector(connectorId) {
  const managed = managedConnectorProcesses.get(connectorId);
  if (!managed || managed.exitCode !== null) return false;
  managed.status = "stopping";
  managed.stoppedAt = now();
  managed.child.kill("SIGTERM");
  setTimeout(() => {
    if (managed.exitCode === null) managed.child.kill("SIGKILL");
  }, 4000).unref?.();
  return true;
}

function publicRuntime() {
  const federationTrust = federationTrustConfigStatus();
  return {
    storageMode,
    nodeEnv: process.env.NODE_ENV || "development",
    authMode,
    localLoginEnabled: isLocalLoginEnabled(),
    devLoginEnabled: isDevLoginEnabled(),
    localPasswordRequired: localPasswordRequired(),
    demoEndpointsEnabled: areDemoEndpointsEnabled(),
    publicTrustLedgerEnabled,
    rateLimitsEnabled: rateLimitMultiplier > 0,
    maxArtifactUploadBytes,
    federationEnabled,
    federationPeerCount: federationPeers.length,
    federationSignatureVerificationEnabled: federationSignatureVerificationEnabled(),
    federationTrustedNodeCount: federationTrust.trustedPeerCount,
    federationTrustConfigError: federationTrust.error,
    node: publicNodeIdentity(),
    oauthConfigured: Object.fromEntries(
      Object.keys(oauthProviderConfig).map((provider) => [provider, Boolean(providerCredentials(provider))])
    ),
    productionReady: runtimeReadiness().ok
  };
}

function federationTrustConfigStatus() {
  if (!federationSignatureVerificationEnabled()) {
    return { trustedPeerCount: 0, error: null };
  }
  try {
    return { trustedPeerCount: Math.max(0, loadFederationTrustedNodes().size - 1), error: null };
  } catch (error) {
    return { trustedPeerCount: 0, error: error.message };
  }
}

function validateRuntimeConfig() {
  const readiness = runtimeReadiness();
  if (!readiness.ok) {
    throw new Error(`OpenSwarmAgents configuration error:\n- ${readiness.errors.join("\n- ")}`);
  }
}

function runtimeReadiness() {
  const errors = [];
  if (!isProduction || process.env.OSA_SKIP_ENV_VALIDATION === "1") {
    return { ok: true, errors };
  }

  const publicUrl = process.env.OSA_PUBLIC_URL || "";
  const hasOAuthProvider = Object.keys(oauthProviderConfig).some((provider) => Boolean(providerCredentials(provider)));

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required in production.");
  }
  if (["oauth", "hybrid"].includes(authMode) && !publicUrl) {
    errors.push("OSA_PUBLIC_URL is required in production when OAuth is enabled.");
  } else if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      if (["oauth", "hybrid"].includes(authMode) && parsed.protocol !== "https:" && process.env.OSA_ALLOW_INSECURE_PUBLIC_URL !== "1") {
        errors.push("OSA_PUBLIC_URL must use https:// in production when OAuth is enabled.");
      }
    } catch {
      errors.push("OSA_PUBLIC_URL must be a valid absolute URL.");
    }
  }
  if (["oauth", "hybrid"].includes(authMode) && process.env.OSA_COOKIE_SECURE !== "1" && process.env.OSA_ALLOW_INSECURE_COOKIES !== "1") {
    errors.push("OSA_COOKIE_SECURE=1 is required in production when OAuth is enabled.");
  }
  if (authMode === "oauth" && !hasOAuthProvider) {
    errors.push("Configure at least one OAuth provider when OSA_AUTH_MODE=oauth.");
  }
  if (authMode === "hybrid" && !hasOAuthProvider) {
    errors.push("Configure at least one OAuth provider when OSA_AUTH_MODE=hybrid.");
  }
  if (authMode === "local" && localPasswordRequired() && process.env.OSA_ALLOW_PASSWORDLESS_LOCAL_AUTH === "1") {
    errors.push("Passwordless local auth override is not allowed with the current production auth settings.");
  }
  if (process.env.OSA_DEMO_ENDPOINTS === "1" && process.env.OSA_ALLOW_DEMO_ENDPOINTS_IN_PRODUCTION !== "1") {
    errors.push("OSA_DEMO_ENDPOINTS=1 is not allowed in production unless OSA_ALLOW_DEMO_ENDPOINTS_IN_PRODUCTION=1 is also set.");
  }
  if (federationEnabled && !federationTokenHash && process.env.OSA_ALLOW_INSECURE_FEDERATION !== "1") {
    errors.push("OSA_FEDERATION_TOKEN is required when OSA_FEDERATION_ENABLED=1 in production.");
  }

  return { ok: errors.length === 0, errors };
}

function normalizeAuthMode(value) {
  const mode = String(value || "local").toLowerCase();
  return ["local", "oauth", "hybrid"].includes(mode) ? mode : "local";
}

function normalizeFederationPeers(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      try {
        const url = new URL(item);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        url.pathname = url.pathname.replace(/\/$/, "");
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/$/, "");
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 20);
}

function isLocalLoginEnabled() {
  if (authMode === "oauth") return false;
  if (authMode === "local" || authMode === "hybrid") return true;
  return process.env.NODE_ENV !== "production";
}

function isDevLoginEnabled() {
  return isLocalLoginEnabled();
}

function areDemoEndpointsEnabled() {
  if (process.env.OSA_DEMO_ENDPOINTS === "1") return true;
  if (process.env.OSA_DEMO_ENDPOINTS === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function publicOAuthProviders(req) {
  return {
    providers: Object.entries(oauthProviderConfig).map(([id, config]) => ({
      id,
      label: config.label,
      configured: Boolean(process.env[config.clientIdEnv] && process.env[config.clientSecretEnv]),
      clientIdEnv: config.clientIdEnv,
      clientSecretEnv: config.clientSecretEnv,
      startUrl: `/api/auth/oauth/${id}/start?redirect=${encodeURIComponent("/")}`,
      callbackUrl: `${originFromReq(req)}/api/auth/oauth/${id}/callback`
    })),
    auth: {
      localLoginEnabled: isLocalLoginEnabled(),
      devLoginEnabled: isDevLoginEnabled(),
      localPasswordRequired: localPasswordRequired(),
      authMode,
      oauthRequired: authMode === "oauth"
    }
  };
}

function originFromReq(req) {
  return process.env.OSA_PUBLIC_URL || `http://${req.headers.host || `${host}:${port}`}`;
}

function cleanOAuthStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  store.oauthStates = store.oauthStates.filter((item) => Date.parse(item.createdAt) >= cutoff);
}

function providerCredentials(provider) {
  const config = oauthProviderConfig[provider];
  if (!config) return null;
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { config, clientId, clientSecret };
}

async function startOAuth(req, res, provider, url) {
  if (!enforceRateLimit(req, res, `oauth-start:${provider}`, rateIdentity(req), { limit: 20, windowMs: 10 * 60 * 1000 })) {
    return;
  }
  const credentials = providerCredentials(provider);
  if (!credentials) return redirect(res, `/?oauth=${provider}&error=not_configured#account`);
  cleanOAuthStates();
  const stateId = `oauth-${randomUUID()}`;
  const redirectAfter = String(url.searchParams.get("redirect") || "/").startsWith("/")
    ? String(url.searchParams.get("redirect") || "/")
    : "/";
  store.oauthStates.push({
    id: stateId,
    provider,
    redirectAfter,
    createdAt: now()
  });
  await saveStore();

  const callbackUrl = `${originFromReq(req)}/api/auth/oauth/${provider}/callback`;
  const authorizeUrl = new URL(credentials.config.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", credentials.clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", credentials.config.scope);
  authorizeUrl.searchParams.set("state", stateId);
  if (provider === "google") {
    authorizeUrl.searchParams.set("access_type", "online");
    authorizeUrl.searchParams.set("prompt", "select_account");
  }
  return redirect(res, authorizeUrl.toString(), { "set-cookie": oauthStateCookie(stateId) });
}

async function completeOAuth(req, res, provider, url) {
  const code = String(url.searchParams.get("code") || "");
  const stateId = String(url.searchParams.get("state") || "");
  const stateCookie = cookieValue(req, "osa_oauth_state");
  const stateEntry = store.oauthStates.find((item) => item.id === stateId && item.provider === provider);
  store.oauthStates = store.oauthStates.filter((item) => item.id !== stateId);
  const credentials = providerCredentials(provider);
  const clearOAuthCookie = oauthStateCookie("", 0);
  if (!code || !stateEntry || !credentials || stateCookie !== stateId) {
    await saveStore();
    return redirect(res, `/?oauth=${provider}&error=invalid_callback#account`, { "set-cookie": clearOAuthCookie });
  }

  try {
    const callbackUrl = `${originFromReq(req)}/api/auth/oauth/${provider}/callback`;
    const token = await exchangeOAuthCode(provider, credentials, code, callbackUrl);
    const profile = await fetchOAuthProfile(provider, token);
    const user = upsertUser(profile.email, profile.name);
    const session = createSession(user);
    event("user_signed_in", `${user.name} signed in with ${credentials.config.label}`, { userId: user.id, provider });
    await saveStore();
    return redirect(res, stateEntry.redirectAfter || "/", { "set-cookie": [sessionCookie(session.token), clearOAuthCookie] });
  } catch (error) {
    event("oauth_error", `${credentials.config.label} OAuth failed: ${error.message}`, { provider });
    await saveStore();
    return redirect(res, `/?oauth=${provider}&error=provider_failed#account`, { "set-cookie": clearOAuthCookie });
  }
}

async function exchangeOAuthCode(provider, credentials, code, redirectUri) {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: redirectUri
  });
  if (provider === "google") body.set("grant_type", "authorization_code");
  const response = await fetch(credentials.config.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "OAuth token exchange failed");
  }
  return payload.access_token;
}

async function fetchOAuthProfile(provider, accessToken) {
  if (provider === "github") return fetchGitHubProfile(accessToken);
  if (provider === "google") return fetchGoogleProfile(accessToken);
  throw new Error("Unsupported OAuth provider");
}

async function fetchGitHubProfile(accessToken) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "user-agent": "OpenSwarmAgents"
  };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers })
  ]);
  const user = await userResponse.json();
  const emails = emailsResponse.ok ? await emailsResponse.json() : [];
  const primary = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified) : null;
  const email = normalizeEmail(primary?.email || user.email);
  if (!email) throw new Error("GitHub account has no verified email");
  return {
    email,
    name: String(user.name || user.login || email.split("@")[0]).slice(0, 80)
  };
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const profile = await response.json();
  if (!response.ok) throw new Error(profile.error_description || profile.error || "Google profile fetch failed");
  const email = normalizeEmail(profile.email);
  if (!email || profile.email_verified === false) throw new Error("Google account has no verified email");
  return {
    email,
    name: String(profile.name || email.split("@")[0]).slice(0, 80)
  };
}

function recoverExpiredLeases() {
  let changed = false;
  const timestamp = Date.now();
  for (const task of store.tasks) {
    if (task.status === "leased" && task.leaseUntil && Date.parse(task.leaseUntil) < timestamp) {
      const previousAgent = task.assignedAgentId;
      task.status = "open";
      task.assignedAgentId = null;
      task.leaseUntil = null;
      task.leaseId = null;
      task.updatedAt = now();
      event("lease_expired", `Lease expired for ${task.title}`, { taskId: task.id, previousAgent });
      changed = true;
    }
  }
  return changed;
}

function recoverExpiredConnectorTokens() {
  let changed = false;
  const timestamp = Date.now();
  for (const connector of store.connectorTokens) {
    if (connector.status === "active" && connector.expiresAt && Date.parse(connector.expiresAt) < timestamp) {
      expireConnectorToken(connector);
      changed = true;
    }
  }
  return changed;
}

function createConnectorToken(auth, body) {
  const mode = body.mode === "voting" ? "voting" : "worker";
  const goalId = mode === "voting" ? "voting-pool" : String(body.goalId || "");
  if (mode === "worker") {
    const goal = store.goals.find((item) => item.id === goalId);
    if (!goal) throw new Error("Unknown goalId");
    if (goal.status === "completed") throw new Error("Goal is already completed");
    const activeToken = store.connectorTokens.find(
      (token) => token.userId === auth.user.id && token.mode === "worker" && token.status === "active"
    );
    const activeAgent = store.agents.find(
      (agent) => agent.userId === auth.user.id && agent.status === "online" && agent.goalId !== "voting-pool"
    );
    if ((activeToken && activeToken.goalId !== goalId) || (activeAgent && activeAgent.goalId !== goalId)) {
      throw new Error("User is already connected to another worker project");
    }
    if (activeToken && activeToken.goalId === goalId) {
      revokeConnectorToken(activeToken, body.revokeExistingReason || "token_replaced");
    }
  }

  if (mode === "voting") {
    for (const token of store.connectorTokens) {
      if (token.userId === auth.user.id && token.mode === "voting" && token.status === "active") {
        revokeConnectorToken(token, body.revokeExistingReason || "token_replaced");
      }
    }
  }

  const rawToken = `osa_conn_${randomUUID()}_${randomUUID()}`;
  const connector = {
    id: `connector-${randomUUID()}`,
    userId: auth.user.id,
    mode,
    goalId,
    agentId: null,
    name: String(body.name || (mode === "voting" ? "Voting Agent" : "Worker Agent")).slice(0, 80),
    tokenHash: hashToken(rawToken),
    capabilities: mode === "voting" ? ["vote", "review", "research"] : normalizeList(body.capabilities, ["research", "review", "synthesis"]),
    models: normalizeList(body.models, ["connector-local"]),
    provider: normalizeProvider(body.provider),
    providers: normalizeProviders(body.providers),
    status: "active",
    createdAt: now(),
    lastUsedAt: null,
    lastUsedMethod: null,
    lastUsedPath: null,
    useCount: 0,
    expiresAt: body.expiresAt || afterMs(now(), 30 * 24 * 60 * 60 * 1000),
    expiredAt: null,
    revokedAt: null,
    revokedReason: null,
    rotatedFromId: body.rotatedFromId || null,
    rotatedToId: null
  };
  store.connectorTokens.push(connector);
  if (connector.rotatedFromId) {
    const previous = store.connectorTokens.find((token) => token.id === connector.rotatedFromId);
    if (previous) previous.rotatedToId = connector.id;
  }
  event("connector_token_created", `${auth.user.name} created a ${mode} connector token`, {
    connectorId: connector.id,
    mode,
    goalId
  });
  return { rawToken, connector };
}

function rotateConnectorToken(auth, connector) {
  if (connector.status === "active") revokeConnectorToken(connector, "rotated");
  return createConnectorToken(auth, {
    mode: connector.mode,
    goalId: connector.goalId,
    name: connector.name,
    capabilities: connector.capabilities || [],
    models: connector.models || [],
    provider: connector.provider,
    providers: connector.providers || [],
    expiresAt: afterMs(now(), 30 * 24 * 60 * 60 * 1000),
    rotatedFromId: connector.id,
    revokeExistingReason: "rotated"
  });
}

function expireConnectorToken(connector) {
  if (connector.status === "expired") return;
  stopManagedConnector(connector.id);
  connector.status = "expired";
  connector.expiredAt = now();
  connector.revokedReason = null;
  event("connector_token_expired", `Connector token expired`, {
    connectorId: connector.id,
    agentId: connector.agentId || null,
    goalId: connector.goalId
  });
}

function revokeConnectorToken(connector, reason = "user_disconnect") {
  if (connector.status === "revoked") return null;
  stopManagedConnector(connector.id);
  connector.status = "revoked";
  connector.revokedAt = now();
  connector.revokedReason = reason;
  const agent = connector.agentId ? findAgent(connector.agentId) : null;
  if (agent) {
    agent.status = "offline";
    agent.lastSeen = now();
    releaseAgentLeases(agent.id);
    reconcileConsensusAfterAgentDisconnect(agent.id);
  }
  event("connector_token_revoked", `Connector token revoked`, {
    connectorId: connector.id,
    agentId: agent?.id || null,
    reason
  });
  return agent;
}

async function createUploadedArtifact(auth, connector, body) {
  const name = sanitizeArtifactName(body.name || body.filename || "artifact.bin");
  const mimeType = String(body.mimeType || body.mime || "application/octet-stream").trim().slice(0, 120);
  const kind = normalizeArtifactKind(body.kind || body.type || mimeType || name);
  const description = String(body.description || body.summary || "").trim().slice(0, 1000);
  const payload = decodeArtifactPayload(body.dataBase64 || body.base64 || body.data || "");
  if (!payload.length) {
    const error = new Error("Artifact payload is empty");
    error.statusCode = 400;
    throw error;
  }
  if (payload.length > maxArtifactUploadBytes) {
    const error = new Error(`Artifact exceeds ${maxArtifactUploadBytes} bytes`);
    error.statusCode = 413;
    throw error;
  }

  const id = `artifact-${randomUUID()}`;
  const storedName = `${id}${safeArtifactExtension(name, mimeType)}`;
  const refs = validateArtifactRefs(auth, connector, body);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(join(uploadDir, storedName), payload);

  const artifact = {
    id,
    name,
    kind,
    mimeType,
    uri: `/api/artifacts/${id}/download`,
    size: payload.length,
    description,
    storage: "local",
    storedName,
    uploadedBy: refs.uploadedBy,
    agentId: refs.agentId,
    goalId: refs.goalId,
    taskId: refs.taskId,
    resultId: refs.resultId,
    sha256: createHash("sha256").update(payload).digest("hex"),
    createdAt: now()
  };
  artifact.signature = recordSignedContribution("artifact_upload", {
    artifactId: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    size: artifact.size,
    sha256: artifact.sha256
  }, {
    objectType: "artifact",
    objectId: artifact.id,
    objectHash: artifact.sha256
  });
  store.uploadedArtifacts.unshift(artifact);
  event("artifact_uploaded", `Uploaded artifact ${artifact.name}`, {
    artifactId: artifact.id,
    kind: artifact.kind,
    size: artifact.size
  });
  return artifact;
}

function validateArtifactRefs(auth, connector, body) {
  const refs = {
    uploadedBy: auth?.user?.id || connector?.user?.id || null,
    agentId: body.agentId ? String(body.agentId).slice(0, 100) : null,
    goalId: body.goalId ? String(body.goalId).slice(0, 140) : null,
    taskId: body.taskId ? String(body.taskId).slice(0, 140) : null,
    resultId: body.resultId ? String(body.resultId).slice(0, 140) : null
  };

  if (connector) {
    const requestedAgentId = body.agentId ? String(body.agentId).slice(0, 100) : null;
    const requestedGoalId = body.goalId ? String(body.goalId).slice(0, 140) : null;
    if (requestedAgentId && requestedAgentId !== connector.token.agentId) {
      const error = new Error("Artifact agentId is not scoped to this connector token");
      error.statusCode = 403;
      throw error;
    }
    if (requestedGoalId && requestedGoalId !== connector.token.goalId) {
      const error = new Error("Artifact goalId is not scoped to this connector token");
      error.statusCode = 403;
      throw error;
    }
    refs.agentId = connector.token.agentId || null;
    refs.goalId = connector.token.goalId || null;
  }

  if (refs.agentId) {
    const agent = findAgent(refs.agentId);
    if (!agent) {
      const error = new Error("Unknown artifact agentId");
      error.statusCode = 400;
      throw error;
    }
    if (connector && agent.connectorTokenId !== connector.token.id) {
      const error = new Error("Artifact agentId is not scoped to this connector token");
      error.statusCode = 403;
      throw error;
    }
    if (auth && !connector && agent.userId !== auth.user.id) {
      const error = new Error("Artifact agentId is not owned by the authenticated user");
      error.statusCode = 403;
      throw error;
    }
    refs.goalId = refs.goalId || agent.goalId;
  }

  if (refs.taskId) {
    const task = store.tasks.find((item) => item.id === refs.taskId);
    if (!task) {
      const error = new Error("Unknown artifact taskId");
      error.statusCode = 400;
      throw error;
    }
    if (refs.goalId && task.goalId !== refs.goalId) {
      const error = new Error("Artifact taskId is outside the scoped goal");
      error.statusCode = 403;
      throw error;
    }
    if (connector && refs.agentId && task.assignedAgentId !== refs.agentId) {
      const error = new Error("Connector may only upload artifacts for its leased task");
      error.statusCode = 403;
      throw error;
    }
    refs.goalId = task.goalId;
  }

  if (refs.resultId) {
    const result = store.results.find((item) => item.id === refs.resultId);
    if (!result) {
      const error = new Error("Unknown artifact resultId");
      error.statusCode = 400;
      throw error;
    }
    if (refs.goalId && result.goalId !== refs.goalId) {
      const error = new Error("Artifact resultId is outside the scoped goal");
      error.statusCode = 403;
      throw error;
    }
    refs.goalId = result.goalId;
  }

  return refs;
}

function decodeArtifactPayload(value) {
  let encoded = String(value || "").trim();
  const dataUrlMatch = encoded.match(/^data:[^;]+;base64,(.*)$/is);
  if (dataUrlMatch) encoded = dataUrlMatch[1];
  encoded = encoded.replace(/\s/g, "");
  if (!encoded) return Buffer.alloc(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    const error = new Error("Artifact payload must be base64 encoded");
    error.statusCode = 400;
    throw error;
  }
  return Buffer.from(encoded, "base64");
}

function sanitizeArtifactName(value) {
  const name = String(value || "artifact.bin")
    .split(/[\\/]/)
    .pop()
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 180);
  return name || "artifact.bin";
}

function safeArtifactExtension(name, mimeType) {
  const extension = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/.test(extension)) return extension;
  return {
    "text/markdown": ".md",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/svg+xml": ".svg"
  }[mimeType] || ".bin";
}

function artifactContentDisposition(artifact) {
  const mimeType = String(artifact.mimeType || "").toLowerCase();
  const safeInlineTypes = new Set([
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/markdown",
    "text/plain"
  ]);
  return safeInlineTypes.has(mimeType) ? "inline" : "attachment";
}

async function serveArtifactDownload(req, res, artifactId) {
  const auth = authFromReq(req);
  if (!auth) return unauthorized(res, "Sign in before downloading artifacts");
  const artifact = store.uploadedArtifacts.find((item) => item.id === artifactId);
  if (!artifact || artifact.storage !== "local" || !artifact.storedName) return notFound(res);
  const filePath = join(uploadDir, artifact.storedName);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return notFound(res);
    res.writeHead(200, {
      "content-type": artifact.mimeType || "application/octet-stream",
      "content-length": String(fileStat.size),
      "content-disposition": `${artifactContentDisposition(artifact)}; filename="${artifact.name.replaceAll('"', "'")}"`,
      "x-osa-artifact-sha256": artifact.sha256 || "",
      ...securityHeaders()
    });
    createReadStream(filePath).pipe(res);
  } catch {
    return notFound(res);
  }
}

function releaseAgentLeases(agentId) {
  for (const task of store.tasks) {
    if (task.status === "leased" && task.assignedAgentId === agentId) {
      task.status = "open";
      task.assignedAgentId = null;
      task.leaseUntil = null;
      task.leaseId = null;
      task.updatedAt = now();
    }
  }
}

function disconnectGoalAgents(goalId, reason = "project_completed") {
  let disconnected = 0;
  for (const agent of store.agents) {
    if (agent.goalId === goalId && agent.status === "online") {
      agent.status = "offline";
      agent.lastSeen = now();
      releaseAgentLeases(agent.id);
      reconcileConsensusAfterAgentDisconnect(agent.id);
      disconnected += 1;
    }
  }
  if (disconnected) {
    event("agents_disconnected", `${disconnected} agents disconnected from completed project`, {
      goalId,
      reason
    });
  }
  return disconnected;
}

function findAgent(agentId) {
  return store.agents.find((agent) => agent.id === agentId);
}

function agentCanRun(agent, task) {
  const capabilities = new Set(agent.capabilities || []);
  return (task.requiredCapabilities || []).every((capability) => capabilities.has(capability));
}

function taskSort(a, b) {
  return (b.priority || 0) - (a.priority || 0) || a.createdAt.localeCompare(b.createdAt);
}

function taskCollaborationContext(task) {
  const priorResults = store.results
    .filter((result) => result.taskId === task.id)
    .slice(-5)
    .map((result) => ({
      id: result.id,
      agentId: result.agentId,
      summary: result.summary,
      content: result.content,
      artifacts: result.artifacts || [],
      status: result.status,
      consensus: result.consensus || null,
      createdAt: result.createdAt,
      reviews: store.reviews
        .filter((review) => review.resultId === result.id)
        .map((review) => ({
          agentId: review.agentId,
          decision: review.decision,
          score: review.score,
          reason: review.reason,
          createdAt: review.createdAt
        }))
    }));

  return {
    iteration: Number(task.iteration || 1),
    lastRevisionReason: task.lastRevisionReason || null,
    priorResults
  };
}

function agentGuiSessions() {
  const taskSessions = [];
  for (const task of store.tasks) {
    if (["rejected", "deleted"].includes(task.status) || task.agentGuiDeletedAt) continue;
    const isDashboardHomeTask = task.agentGuiRoom === "home"
      || task.source === "agent-gui-home"
      || (task.agentGuiConnectorId && task.source === "agent-gui");
    const isExplicitPublicTask = task.agentGuiRoom === "public" || task.source === "agent-gui-public";
    if (isDashboardHomeTask) {
      taskSessions.push(agentGuiTaskSession(task, "home"));
    }
    if (task.sharedPublic || isExplicitPublicTask) {
      taskSessions.push(agentGuiTaskSession(task, "public"));
    }
  }
  return [...taskSessions, ...agentGuiPublicCollectionSessions()]
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

function agentGuiSessionById(id) {
  return agentGuiSessions().find((session) => session.id === id) || null;
}

function agentGuiDonationStats(targetType, targetId) {
  const matching = store.agentDonations.filter((donation) =>
    donation.targetType === targetType && donation.targetId === targetId
  );
  const donationTotal = matching.reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
  const feeTotal = matching.reduce((sum, donation) => sum + Number(donation.feeAmount || 0), 0);
  return {
    donation_count: matching.length,
    donation_total_usdc: Math.round(donationTotal * 1_000_000) / 1_000_000,
    osa_fee_total_usdc: Math.round(feeTotal * 1_000_000) / 1_000_000
  };
}

function agentGuiDonationStatsForTaskId(taskId) {
  return agentGuiDonationStats("agent", taskId);
}

function agentGuiProjectReviewStats(projectId) {
  const reviews = store.publicProjectReviews.filter((review) => review.projectId === projectId);
  const ratingTotal = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
  const average = reviews.length ? Math.round((ratingTotal / reviews.length) * 10) / 10 : 0;
  const latest = reviews
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  return {
    review_count: reviews.length,
    rating_avg: average,
    latest_review: latest
      ? {
          rating: latest.rating,
          title: latest.title,
          comment: latest.comment,
          wallet_address: latest.walletAddress,
          created_at: latest.createdAt
        }
      : null
  };
}

function agentGuiRankedPublicAgents(limit = 100) {
  return store.tasks
    .filter((task) => task.sharedPublic && !["deleted", "rejected"].includes(task.status) && !task.agentGuiDeletedAt)
    .map((task) => {
      const goal = store.goals.find((item) => item.id === task.goalId);
      const agent = task.assignedAgentId ? findAgent(task.assignedAgentId) : null;
      const donationStats = agentGuiDonationStatsForTaskId(task.id);
      return {
        id: `public-${task.id}`,
        task_id: task.id,
        title: task.title,
        summary: task.description,
        agent: agent?.name || task.agentGuiAgent || "OSA Agent",
        model: agent?.models?.join(", ") || task.agentGuiModel || "OpenClaw local agent",
        goal: goal?.title || "Home",
        copy_count: Math.max(0, Number(task.copyCount || 0)),
        shared_at: task.sharedPublicAt || task.createdAt,
        last_copied_at: task.lastCopiedAt || null,
        owner_wallet_address: task.ownerWalletAddress || null,
        ...donationStats
      };
    })
    .sort((a, b) => b.copy_count - a.copy_count || String(b.shared_at).localeCompare(String(a.shared_at)))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function agentGuiPublicRankForTaskId(taskId) {
  return agentGuiRankedPublicAgents(100).find((entry) => entry.task_id === taskId)?.rank || null;
}

function publicCollectionSummary(item) {
  const taskCount = item.taskIds.length;
  const noun = taskCount === 1 ? "agent" : "agents";
  return item.summary || `${item.name} with ${taskCount} ${noun}.`;
}

function agentGuiRankedPublicCollections(type, limit = 100) {
  const items = type === "room" ? store.publicRooms : store.publicProjects;
  return items
    .map((item) => {
      const donationStats = agentGuiDonationStats(type, item.id);
      const reviewStats = type === "project" ? agentGuiProjectReviewStats(item.id) : {};
      return {
        id: `${type === "room" ? "public-room" : "public-project"}-${item.id}`,
        target_type: type,
        target_id: item.id,
        task_id: item.taskIds[0] || "",
        title: item.name,
        summary: publicCollectionSummary(item),
        agent: type === "room" ? "OSA Room" : "OSA Project",
        model: `${item.taskIds.length} public ${item.taskIds.length === 1 ? "agent" : "agents"}`,
        goal: type === "room" ? "Public Rooms" : "Public Projects",
        copy_count: Math.max(0, Number(item.copyCount || 0)),
        item_count: item.taskIds.length,
        shared_at: item.sharedAt,
        last_copied_at: item.lastCopiedAt || null,
        owner_wallet_address: item.ownerWalletAddress || null,
        ...donationStats,
        ...reviewStats
      };
    })
    .sort((a, b) => b.copy_count - a.copy_count || String(b.shared_at).localeCompare(String(a.shared_at)))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function agentGuiPublicCollectionSession(item, type) {
  const donationStats = agentGuiDonationStats(type, item.id);
  const reviewStats = type === "project" ? agentGuiProjectReviewStats(item.id) : {};
  return {
    id: `${type === "room" ? "public-room" : "public-project"}-${item.id}`,
    started_at: item.sharedAt,
    ended_at: item.updatedAt || item.sharedAt,
    source: type === "room" ? "osa-public-room" : "osa-public-project",
    model: type === "room" ? "OSA Room" : "OSA Project",
    parent_session_id: null,
    title: item.name,
    message_count: item.taskIds.length,
    token_estimate: publicCollectionSummary(item).length,
    is_running: false,
    first_activity_at: item.sharedAt,
    last_activity_at: item.updatedAt || item.sharedAt,
    title_summary: type === "room" ? "Public Room" : "Public Project",
    auto_continue: false,
    task_solved: true,
    workspace_path: null,
    is_sleeping: false,
    agent: type === "room" ? "public-room" : "public-project",
    agent_model: `${item.taskIds.length} ${item.taskIds.length === 1 ? "agent" : "agents"}`,
    agent_base_url: "",
    desk_tools: type === "room" ? ["room", "copy", "donate"] : ["project", "copy", "donate"],
    team_id: type === "room" ? agentGuiPublicRoomsTeamId : agentGuiPublicProjectsTeamId,
    team_name: type === "room" ? "Public Rooms" : "Public Projects",
    shared_public: true,
    shared_public_at: item.sharedAt,
    public_kind: type,
    copy_count: Math.max(0, Number(item.copyCount || 0)),
    last_copied_at: item.lastCopiedAt || null,
    ...donationStats,
    ...reviewStats,
    connector_status: null,
    connector_exit_code: null,
    connector_error: null
  };
}

function agentGuiPublicCollectionSessions() {
  const roomSessions = store.publicRooms.map((item) => agentGuiPublicCollectionSession(item, "room"));
  const projectSessions = store.publicProjects.map((item) => agentGuiPublicCollectionSession(item, "project"));
  return [...roomSessions, ...projectSessions];
}

function agentGuiTaskSession(task, roomOverride = null) {
  const goal = store.goals.find((item) => item.id === task.goalId);
  const agent = task.assignedAgentId ? findAgent(task.assignedAgentId) : null;
  const result = store.results.find((item) => item.taskId === task.id);
  const managed = task.agentGuiConnectorId ? managedConnectorStatus(task.agentGuiConnectorId) : null;
  const fallbackAgent = task.agentGuiAgent || "openclaw-codex";
  const room = roomOverride || agentGuiTaskRoom(task);
  const lastAt = task.updatedAt || result?.createdAt || task.createdAt;
  const displayModel = task.agentGuiModel || agent?.models?.join(", ") || agent?.provider || "OSA connector";
  const taskSolved = task.status === "done" || result?.status === "accepted";
  const connectorExit = task.agentGuiConnectorId ? agentGuiConnectorExitForTask(task) : null;
  const taskFailed = task.status === "failed" || connectorExit?.isError;
  const publicRank = task.sharedPublic ? agentGuiPublicRankForTaskId(task.id) : null;
  const donationStats = agentGuiDonationStatsForTaskId(task.id);
  const visibleStartedAt = room === "public" ? (task.sharedPublicAt || task.createdAt) : task.createdAt;
  return {
    id: `${room}-${task.id}`,
    started_at: visibleStartedAt,
    ended_at: taskFailed ? (connectorExit?.createdAt || lastAt) : ["done", "in_consensus"].includes(task.status) ? lastAt : null,
    source: room === "home" ? "osa-home" : "osa-public",
    model: task.agentGuiModel || agent?.models?.[0] || agent?.provider || "OSA connector",
    parent_session_id: null,
    title: task.title,
    message_count: agent ? 3 : 1,
    token_estimate: task.description.length + (result?.content || "").length,
    is_running: !taskSolved && !taskFailed && (task.status === "leased" || ["starting", "running"].includes(managed?.status)),
    first_activity_at: visibleStartedAt,
    last_activity_at: lastAt,
    title_summary: room === "home" ? "Home" : goal?.title || "Public OSA task",
    auto_continue: false,
    task_solved: taskSolved,
    workspace_path: null,
    is_sleeping: false,
    agent: fallbackAgent,
    agent_model: displayModel,
    agent_base_url: "",
    desk_tools: task.requiredCapabilities || [task.type || "task"],
    team_id: room === "home" ? normalizeAgentGuiPrivateTeamId(task.agentGuiTeamId) : agentGuiPublicTeamId,
    team_name: room === "home" ? task.agentGuiTeamName || null : "Public",
    shared_public: Boolean(task.sharedPublic),
    shared_public_at: task.sharedPublicAt || null,
    public_rank: publicRank,
    copy_count: Math.max(0, Number(task.copyCount || 0)),
    last_copied_at: task.lastCopiedAt || null,
    ...donationStats,
    connector_status: taskFailed ? "failed" : (managed?.status || connectorExit?.status || null),
    connector_exit_code: connectorExit?.exitCode ?? managed?.exitCode ?? null,
    connector_error: task.agentGuiConnectorError || (connectorExit?.isError ? connectorExit.message : null)
  };
}

function agentGuiConnectorExitForTask(task) {
  if (!task?.agentGuiConnectorId) return null;
  const eventItem = store.events.find((item) =>
    item.type === "managed_connector_exited" && item.data?.connectorId === task.agentGuiConnectorId
  );
  if (!eventItem) return null;
  const exitCode = eventItem.data?.exitCode;
  const signal = eventItem.data?.signal || null;
  return {
    status: signal ? "stopped" : exitCode === 0 ? "exited" : "failed",
    exitCode,
    signal,
    isError: exitCode !== 0 && signal !== "SIGTERM",
    message: `Connector exited with ${signal || `code ${exitCode}`}`,
    createdAt: eventItem.createdAt
  };
}

function agentGuiTaskRoom(task) {
  if (task.agentGuiRoom === "public" || task.source === "agent-gui-public") return "public";
  if (task.agentGuiRoom === "home" || task.source === "agent-gui-home") return "home";
  if (task.agentGuiConnectorId && task.source === "agent-gui") return "home";
  return "public";
}

function normalizeAgentGuiPrivateTeamId(teamId) {
  const value = String(teamId || "").trim();
  if (!value || [agentGuiHomeTeamId, agentGuiPublicTeamId, agentGuiPublicRoomsTeamId, agentGuiPublicProjectsTeamId].includes(value)) return agentGuiHomeTeamId;
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  if (!clean || clean === "public-room") return agentGuiHomeTeamId;
  return clean.startsWith("room-") ? clean : `room-${clean}`;
}

function agentGuiSessionRoom(sessionId, task = null) {
  if (sessionId.startsWith("home-")) return "home";
  if (sessionId.startsWith("public-")) return "public";
  return task ? agentGuiTaskRoom(task) : "public";
}

function agentGuiTopAgents(limit = 100) {
  return agentGuiRankedPublicAgents(limit);
}

function agentGuiAgents() {
  return [...agentGuiPrototypes(), ...store.agentProfiles.map(publicAgentGuiProfile)];
}

function agentGuiPrototypes() {
  return [
    { id: "openclaw-codex", name: "OpenClaw Agent", tagline: "Use this local OpenClaw agent for a Home desk", color: "#22d3ee", available: true, model: "OpenClaw local agent", base_url: "", profile_path: "osa://prototype/openclaw-codex", is_prototype: true, clone_from: null },
    { id: "codex-cli", name: "Codex CLI", tagline: "Run a Home desk through the local Codex CLI", color: "#60a5fa", available: true, model: "Codex CLI", base_url: "", profile_path: "osa://prototype/codex-cli", is_prototype: true, clone_from: null }
  ];
}

function publicAgentGuiProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    color: profile.color,
    available: profile.available !== false,
    model: profile.model || "OpenClaw local agent",
    base_url: profile.base_url || "",
    profile_path: profile.profile_path || `osa://profiles/${profile.id}`,
    is_prototype: false,
    clone_from: profile.clone_from || "openclaw-codex"
  };
}

function createAgentGuiProfile(body = {}) {
  const id = String(body.id || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  if (!id) {
    const error = new Error("Profile id is required.");
    error.statusCode = 400;
    throw error;
  }
  if (agentGuiPrototypes().some((profile) => profile.id === id) || store.agentProfiles.some((profile) => profile.id === id)) {
    const error = new Error("An OpenClaw profile with this id already exists.");
    error.statusCode = 409;
    throw error;
  }
  const cloneFrom = String(body.clone_from || "openclaw-codex");
  const source = store.agentProfiles.find((profile) => profile.id === cloneFrom);
  const prototype = agentGuiPrototypes().find((profile) => profile.id === cloneFrom);
  const runner = cloneFrom === "codex-cli" || source?.runner === "codex" ? "codex" : "openclaw";
  const profile = normalizeAgentProfiles([{
    id,
    name: body.name || `${id.replaceAll("-", " ")} Agent`,
    tagline: body.tagline || (prototype?.tagline ?? source?.tagline ?? "Private OpenClaw worker profile"),
    color: prototype?.color || source?.color || "#22d3ee",
    model: body.model_default || source?.model || (runner === "codex" ? "Codex CLI" : "OpenClaw local agent"),
    base_url: body.base_url || source?.base_url || "",
    profile_path: `osa://profiles/${id}`,
    clone_from: cloneFrom,
    runner,
    soul: body.soul || source?.soul || "You are a private OpenClaw worker profile inside OSA. Keep work bounded, visible, and useful.",
    memory: body.memory || source?.memory || ""
  }])[0];
  store.agentProfiles.push(profile);
  event("agentgui_profile_created", `Created OpenClaw agent profile ${profile.name}`, { profileId: profile.id, runner });
  return profile;
}

function agentGuiAgentId(agent) {
  return `osa-${agent.id}`;
}

function agentGoalTagline(agent) {
  const goal = store.goals.find((item) => item.id === agent.goalId);
  if (!goal) return agent.status === "online" ? "Online in the OSA network" : "Offline OSA network agent";
  return `${agent.status === "online" ? "Working" : "Registered"} on ${goal.title}`;
}

function agentGuiActivity(sessionId) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  if (taskId) return agentGuiTaskActivity(taskId);
  return [];
}

function agentGuiTaskIdFromSessionId(sessionId) {
  if (sessionId.startsWith("public-room-") || sessionId.startsWith("public-project-")) return "";
  for (const prefix of ["home-", "public-", "office-"]) {
    if (sessionId.startsWith(prefix)) return sessionId.slice(prefix.length);
  }
  return "";
}

function agentGuiSubagents(sessionId) {
  agentGuiSessionById(sessionId);
  return [];
}

function agentGuiTaskActivity(taskId) {
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return [];
  const relatedResults = store.results.filter((result) => result.taskId === taskId);
  const relatedReviews = store.reviews.filter((review) => review.taskId === taskId);
  const room = agentGuiTaskRoom(task);
  const events = [
    agentGuiActivityEvent(task.createdAt, "user_message", room === "home" ? "HOME" : "PUB", room === "home" ? "Home task created" : "Public task available", task.description, "task", false, [])
  ];
  if (task.assignedAgentId) {
    const agent = findAgent(task.assignedAgentId);
    const exit = agentGuiConnectorExitForTask(task);
    const failed = task.status === "failed" || exit?.isError;
    events.push(agentGuiActivityEvent(failed ? (exit?.createdAt || task.updatedAt || task.createdAt) : (task.updatedAt || task.createdAt), failed ? "error" : "tool_call", failed ? "ERR" : "RUN", `${agent?.name || "Agent"} ${failed ? "failed" : "is working"}`, task.agentGuiConnectorError || exit?.message || statusLabelForAgentGui(task.status), "claim_task", failed, []));
  }
  const exit = agentGuiConnectorExitForTask(task);
  if (exit?.isError && !events.some((item) => item.tool_name === "connector_exit")) {
    events.push(agentGuiActivityEvent(exit.createdAt || task.updatedAt || task.createdAt, "error", "ERR", "Connector failed", task.agentGuiConnectorError || exit.message, "connector_exit", true, []));
  }
  for (const result of relatedResults) {
    const agent = findAgent(result.agentId);
    events.push(agentGuiActivityEvent(result.createdAt, "message", "OUT", `${agent?.name || "Agent"} submitted output`, result.summary || result.content, "submit_result", false, []));
  }
  for (const review of relatedReviews) {
    const agent = findAgent(review.agentId);
    events.push(agentGuiActivityEvent(review.createdAt, "tool_result", "REV", `${agent?.name || "Agent"} reviewed output`, `${review.decision}: ${review.reason}`, "review_result", review.decision === "rejected", []));
  }
  return events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function agentGuiConsoleText(sessionId, kind = "terminal") {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return "";
  const session = agentGuiTaskSession(task, agentGuiSessionRoom(sessionId, task));
  const result = store.results.find((item) => item.taskId === task.id);
  const connector = task.agentGuiConnectorId
    ? store.connectorTokens.find((item) => item.id === task.agentGuiConnectorId)
    : null;
  const managed = task.agentGuiConnectorId ? managedConnectorStatus(task.agentGuiConnectorId) : null;
  const exit = agentGuiConnectorExitForTask(task);
  const visibleStatus = session.connector_status === "failed" ? "failed" : task.status;
  const lines = [
    `OSA desk: ${task.title}`,
    `Status: ${visibleStatus}${session.task_solved ? " (solved)" : ""}`,
    `Runner: ${connectorRunner(connector || { models: [task.agentGuiAgent === "codex-cli" ? "connector:codex" : "connector:openclaw"] })}`,
    `Profile: ${task.agentGuiModel || "OpenClaw local agent"}`,
    `Task: ${task.id}`,
    `Connector: ${task.agentGuiConnectorId || "none"}`,
    `Last activity: ${session.last_activity_at || "none"}`
  ];
  if (task.leaseUntil && task.status === "leased") lines.push(`Lease until: ${task.leaseUntil}`);
  if (managed) {
    lines.push(`Managed connector: ${managed.status}${managed.pid ? ` pid ${managed.pid}` : ""}`);
    if (managed.exitCode !== null) lines.push(`Exit: ${managed.exitCode}${managed.signal ? ` ${managed.signal}` : ""}`);
  } else if (exit) {
    lines.push(`Managed connector: ${exit.status}`);
    lines.push(`Exit: ${exit.exitCode}${exit.signal ? ` ${exit.signal}` : ""}`);
  }
  if (task.agentGuiConnectorError) lines.push(`Error: ${task.agentGuiConnectorError}`);
  if (managed?.output) {
    lines.push("", "Connector output:", managed.output.trim());
  }
  if (result) {
    lines.push("", "Result:", result.summary || "Result submitted", "", String(result.content || "").trim());
  }
  if (kind === "console" && !result && !managed?.output && !task.agentGuiConnectorError) {
    lines.push("", "No command output has been recorded yet. OpenClaw may still be working or the runner exited before producing output.");
  }
  return `${lines.join("\n")}\n`;
}

function agentGuiActivityEvent(timestamp, eventType, icon, title, detail, toolName, isError, filesTouched) {
  return {
    timestamp,
    event_type: eventType,
    icon,
    title,
    detail: String(detail || "").slice(0, 3000),
    tool_name: toolName,
    is_error: Boolean(isError),
    files_touched: filesTouched || [],
    time_exact: true
  };
}

function statusLabelForAgentGui(status) {
  return String(status || "unknown").replaceAll("_", " ");
}

function agentGuiTodos(sessionId) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  if (taskId) {
    const task = store.tasks.find((item) => item.id === taskId);
    const room = agentGuiSessionRoom(sessionId, task);
    return {
      tasks: [
        { id: `${taskId}-claim`, title: "Claim task", status: task?.assignedAgentId ? "completed" : "pending" },
        { id: `${taskId}-work`, title: task?.title || "Execute task", status: task?.status === "leased" ? "in_progress" : task?.status === "open" ? "pending" : "completed" },
        { id: `${taskId}-review`, title: "Review and publish", status: ["in_consensus", "needs_review"].includes(task?.status) ? "in_progress" : task?.status === "done" ? "completed" : "pending" }
      ],
      summary: room === "home" ? "Home agent work" : "Public OSA task"
    };
  }
  return { tasks: [], summary: "No task selected" };
}

function agentGuiTaskFile(sessionId) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  if (taskId) {
    const task = store.tasks.find((item) => item.id === taskId);
    const goal = task ? store.goals.find((item) => item.id === task.goalId) : null;
    const room = agentGuiSessionRoom(sessionId, task);
    return `# ${room === "home" ? "Home" : "Public"}\n\n## ${task?.title || "Task"}\n\nProject: ${goal?.title || "Unknown"}\n\n${task?.description || ""}\n`;
  }
  return "# OSA\n\nNo task selected.\n";
}

function agentGuiCapability(id) {
  return {
    id,
    presets: {
      chat: [],
      lean: ["read", "write", "vote"],
      full: ["read", "write", "vote", "review", "artifact"]
    },
    source: "global",
    default_preset: "lean",
    profile_disabled_toolsets: [],
    skill_bundles: [],
    skill_count: 0
  };
}

async function startAgentGuiSession(req, body = {}) {
  const content = String(body.content || "").trim();
  if (!content) {
    const error = new Error("Describe what OSA should work on before starting a desk.");
    error.statusCode = 400;
    throw error;
  }

  const title = agentGuiSessionTitle(content);
  const goal = agentGuiGoalForStart(body, title, content);
  const agentId = String(body.agent || "openclaw-codex");
  const runner = agentGuiRunnerForAgent(agentId);
  const teamId = normalizeAgentGuiPrivateTeamId(body.team_id);
  const teamName = String(body.team_name || "").trim().slice(0, 80);
  const startedAt = now();
  const task = {
    id: `task-${randomUUID()}`,
    goalId: goal.id,
    type: "synthesis",
    title,
    description: content,
    requiredCapabilities: normalizeList(body.tools, ["research", "review", "synthesis"]),
    priority: 90,
    status: "open",
    createdAt: startedAt,
    updatedAt: startedAt,
    source: "agent-gui-home",
    agentGuiRoom: "home",
    agentGuiTeamId: teamId,
    agentGuiTeamName: teamName || null,
    agentGuiAgent: runner === "codex" ? "codex-cli" : "openclaw-codex",
    agentGuiModel: runner === "codex" ? "Codex CLI" : "OpenClaw local agent"
  };
  store.tasks.unshift(task);

  const connector = startAgentGuiTaskConnector(req, task, agentId);
  event("agentgui_session_started", `OSA desk started from AgentGUI`, {
    taskId: task.id,
    goalId: goal.id,
    connectorId: connector.id,
    runner
  });
  await saveStore();

  const session = agentGuiTaskSession(task);
  return {
    session_id: session.id,
    workspace_path: null,
    response: runner === "codex" ? "Connected to the local Codex CLI connector." : "Connected to this OpenClaw agent.",
    session,
    agent: session.agent
  };
}

function resumeAgentGuiSession(req, sessionId, body = {}) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("Only OSA task desks can connect a local agent.");
    error.statusCode = 404;
    throw error;
  }
  if (["done", "rejected"].includes(task.status)) {
    const error = new Error("This OSA task is already closed.");
    error.statusCode = 409;
    throw error;
  }
  if (agentGuiSessionRoom(sessionId, task) === "public") {
    const error = new Error("Copy Public tasks into Home before connecting a local agent.");
    error.statusCode = 409;
    throw error;
  }
  const connector = startAgentGuiTaskConnector(req, task, String(body.agent || task.agentGuiAgent || "openclaw-codex"));
  event("agentgui_session_resumed", `OSA desk connected from AgentGUI`, {
    taskId: task.id,
    goalId: task.goalId,
    connectorId: connector.id,
    runner: connectorRunner(connector)
  });
  return {
    ok: true,
    enabled: false,
    max: 0,
    content: agentGuiTaskFile(sessionId),
    exists: true,
    session: agentGuiTaskSession(task)
  };
}

function copySourceTaskToPrivateRoom(sourceTask, roomId, roomName, copiedAt) {
  const sourceGoal = store.goals.find((item) => item.id === sourceTask.goalId);
  const goal = {
    id: `goal-agentgui-copy-${slugify(sourceTask.title)}-${randomUUID().slice(0, 8)}`,
    title: sourceTask.title,
    description: sourceTask.description,
    status: "active",
    supporters: 0,
    sourceProposalId: null,
    source: "agent-gui-home",
    copiedFromGoalId: sourceGoal?.id || null,
    copiedFromTaskId: sourceTask.id,
    createdAt: copiedAt
  };
  const task = {
    id: `task-${randomUUID()}`,
    goalId: goal.id,
    type: sourceTask.type || "synthesis",
    title: sourceTask.title,
    description: sourceTask.description,
    requiredCapabilities: sourceTask.requiredCapabilities || ["research", "review", "synthesis"],
    priority: sourceTask.priority || 80,
    status: "open",
    createdAt: copiedAt,
    updatedAt: copiedAt,
    source: "agent-gui-home",
    copiedFromTaskId: sourceTask.id,
    copiedFromGoalId: sourceGoal?.id || null,
    copiedFromAgentId: sourceTask.assignedAgentId || null,
    agentGuiRoom: "home",
    agentGuiTeamId: roomId,
    agentGuiTeamName: roomName || null,
    agentGuiAgent: sourceTask.agentGuiAgent || "openclaw-codex",
    agentGuiModel: sourceTask.agentGuiModel || "OpenClaw local agent"
  };
  store.goals.unshift(goal);
  store.tasks.unshift(task);
  return task;
}

async function copyPublicCollectionToHome(sessionId, type) {
  const prefix = type === "room" ? "public-room-" : "public-project-";
  const collectionId = sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : "";
  const collection = (type === "room" ? store.publicRooms : store.publicProjects).find((item) => item.id === collectionId);
  if (!collection) {
    const error = new Error(`Public ${type} not found.`);
    error.statusCode = 404;
    throw error;
  }
  const sourceTasks = collection.taskIds
    .map((taskId) => store.tasks.find((task) => task.id === taskId))
    .filter(Boolean);
  if (!sourceTasks.length) {
    const error = new Error(`Public ${type} has no available agents to copy.`);
    error.statusCode = 409;
    throw error;
  }

  const copiedAt = now();
  const copiedTasks = [];
  if (type === "room") {
    const roomId = normalizeAgentGuiPrivateTeamId(`room-copy-${slugify(collection.name)}-${randomUUID().slice(0, 6)}`);
    const roomName = `Copy of ${collection.name}`.slice(0, 80);
    for (const sourceTask of sourceTasks) copiedTasks.push(copySourceTaskToPrivateRoom(sourceTask, roomId, roomName, copiedAt));
  } else {
    const roomMap = new Map();
    const sourceRooms = collection.rooms.length ? collection.rooms : [{ id: agentGuiHomeTeamId, name: "Home", taskIds: collection.taskIds }];
    for (const room of sourceRooms) {
      roomMap.set(normalizeAgentGuiPrivateTeamId(room.id), {
        id: normalizeAgentGuiPrivateTeamId(`room-project-${slugify(room.name || "room")}-${randomUUID().slice(0, 6)}`),
        name: `Project: ${room.name || "Room"}`.slice(0, 80)
      });
    }
    for (const sourceTask of sourceTasks) {
      const targetRoom = roomMap.get(normalizeAgentGuiPrivateTeamId(sourceTask.agentGuiTeamId)) || [...roomMap.values()][0];
      copiedTasks.push(copySourceTaskToPrivateRoom(sourceTask, targetRoom.id, targetRoom.name, copiedAt));
    }
  }

  collection.copyCount = Math.max(0, Number(collection.copyCount || 0)) + 1;
  collection.lastCopiedAt = copiedAt;
  collection.updatedAt = copiedAt;
  event(type === "room" ? "agentgui_public_room_copied" : "agentgui_public_project_copied", `Copied Public ${type} into Home`, {
    publicId: collection.id,
    copiedTaskIds: copiedTasks.map((task) => task.id),
    copyCount: collection.copyCount
  });
  await saveStore();
  const sessions = copiedTasks.map((task) => agentGuiTaskSession(task, "home"));
  return {
    ok: true,
    session_id: sessions[0].id,
    session_ids: sessions.map((session) => session.id),
    workspace_path: null,
    response: `Copied Public ${type} into your private workspace.`,
    session: sessions[0],
    agent: sessions[0].agent
  };
}

async function copyAgentGuiSessionToHome(sessionId) {
  if (sessionId.startsWith("public-room-")) return copyPublicCollectionToHome(sessionId, "room");
  if (sessionId.startsWith("public-project-")) return copyPublicCollectionToHome(sessionId, "project");
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const sourceTask = store.tasks.find((item) => item.id === taskId);
  if (!sourceTask) {
    const error = new Error("Public task not found.");
    error.statusCode = 404;
    throw error;
  }
  if (agentGuiSessionRoom(sessionId, sourceTask) !== "public") {
    const error = new Error("Only Public tasks can be copied into Home.");
    error.statusCode = 409;
    throw error;
  }

  sourceTask.copyCount = Math.max(0, Number(sourceTask.copyCount || 0)) + 1;
  sourceTask.lastCopiedAt = now();
  const copiedAt = now();
  const task = copySourceTaskToPrivateRoom(sourceTask, agentGuiHomeTeamId, "Home", copiedAt);
  event("agentgui_public_copied", `Copied Public task into Home`, {
    sourceTaskId: sourceTask.id,
    taskId: task.id,
    goalId: task.goalId,
    sourceCopyCount: sourceTask.copyCount
  });
  await saveStore();
  const session = agentGuiTaskSession(task);
  return {
    ok: true,
    session_id: session.id,
    workspace_path: null,
    response: "Copied into Home.",
    session,
    agent: session.agent
  };
}

async function setAgentGuiSessionPublicShare(sessionId, shared) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("OSA desk not found.");
    error.statusCode = 404;
    throw error;
  }
  if (agentGuiSessionRoom(sessionId, task) !== "home") {
    const error = new Error("Only Home agents can be shared or unshared.");
    error.statusCode = 409;
    throw error;
  }

  const nextShared = Boolean(shared);
  const changed = Boolean(task.sharedPublic) !== nextShared;
  task.sharedPublic = nextShared;
  task.sharedPublicAt = nextShared ? (task.sharedPublicAt || now()) : null;
  task.updatedAt = now();
  if (changed) {
    event(nextShared ? "agentgui_session_shared" : "agentgui_session_unshared", nextShared ? "Home agent shared to Public" : "Home agent removed from Public", {
      taskId: task.id,
      goalId: task.goalId,
      copyCount: Math.max(0, Number(task.copyCount || 0))
    });
  }
  await saveStore();
  return {
    ok: true,
    shared_public: Boolean(task.sharedPublic),
    copy_count: Math.max(0, Number(task.copyCount || 0)),
    session: agentGuiTaskSession(task, "home"),
    public_session: task.sharedPublic ? agentGuiTaskSession(task, "public") : null
  };
}

function agentGuiTasksForPrivateTeam(teamId) {
  const normalizedTeamId = normalizeAgentGuiPrivateTeamId(teamId);
  return store.tasks.filter((task) =>
    !["deleted", "rejected"].includes(task.status)
    && !task.agentGuiDeletedAt
    && agentGuiTaskRoom(task) === "home"
    && normalizeAgentGuiPrivateTeamId(task.agentGuiTeamId) === normalizedTeamId
  );
}

function agentGuiAllPrivateProjectTasks() {
  return store.tasks.filter((task) =>
    !["deleted", "rejected"].includes(task.status)
    && !task.agentGuiDeletedAt
    && agentGuiTaskRoom(task) === "home"
  );
}

async function shareAgentGuiRoom(body = {}) {
  const teamId = normalizeAgentGuiPrivateTeamId(body.team_id || body.teamId || agentGuiHomeTeamId);
  const shared = body.shared !== false;
  const existingIndex = store.publicRooms.findIndex((item) => item.sourceTeamId === teamId);
  if (!shared) {
    if (existingIndex >= 0) store.publicRooms.splice(existingIndex, 1);
    await saveStore();
    return { ok: true, shared_public: false };
  }
  const tasks = agentGuiTasksForPrivateTeam(teamId);
  if (!tasks.length) {
    const error = new Error("Add at least one agent to this room before sharing it.");
    error.statusCode = 409;
    throw error;
  }
  const sharedAt = now();
  const name = String(body.team_name || body.name || (teamId === agentGuiHomeTeamId ? "Home" : "Room")).trim().slice(0, 120) || "Room";
  const summary = `${name} room with ${tasks.length} ${tasks.length === 1 ? "agent" : "agents"}.`;
  const next = {
    id: existingIndex >= 0 ? store.publicRooms[existingIndex].id : `room-${slugify(name)}-${randomUUID().slice(0, 8)}`,
    type: "room",
    sourceTeamId: teamId,
    name,
    summary,
    taskIds: tasks.map((task) => task.id),
    rooms: [{ id: teamId, name, taskIds: tasks.map((task) => task.id) }],
    sharedAt: existingIndex >= 0 ? store.publicRooms[existingIndex].sharedAt : sharedAt,
    updatedAt: sharedAt,
    copyCount: existingIndex >= 0 ? Math.max(0, Number(store.publicRooms[existingIndex].copyCount || 0)) : 0,
    lastCopiedAt: existingIndex >= 0 ? store.publicRooms[existingIndex].lastCopiedAt || null : null,
    ownerWalletAddress: null
  };
  if (existingIndex >= 0) store.publicRooms[existingIndex] = next;
  else store.publicRooms.unshift(next);
  event("agentgui_room_shared", "Room shared to Public Rooms", {
    publicRoomId: next.id,
    sourceTeamId: teamId,
    taskIds: next.taskIds
  });
  await saveStore();
  return { ok: true, shared_public: true, room: agentGuiPublicCollectionSession(next, "room") };
}

async function shareAgentGuiProject(body = {}) {
  const tasks = agentGuiAllPrivateProjectTasks();
  if (!tasks.length) {
    const error = new Error("Add at least one private agent before sharing a project.");
    error.statusCode = 409;
    throw error;
  }
  const name = String(body.name || "OSA Project").trim().slice(0, 120) || "OSA Project";
  const roomNames = new Map();
  for (const room of Array.isArray(body.rooms) ? body.rooms : []) {
    if (room?.id) roomNames.set(normalizeAgentGuiPrivateTeamId(room.id), String(room.name || "Room").slice(0, 80));
  }
  const grouped = new Map();
  for (const task of tasks) {
    const roomId = normalizeAgentGuiPrivateTeamId(task.agentGuiTeamId);
    if (!grouped.has(roomId)) grouped.set(roomId, { id: roomId, name: roomNames.get(roomId) || task.agentGuiTeamName || (roomId === agentGuiHomeTeamId ? "Home" : "Room"), taskIds: [] });
    grouped.get(roomId).taskIds.push(task.id);
  }
  const existingIndex = store.publicProjects.findIndex((item) => item.id === "project-local");
  const sharedAt = now();
  const next = {
    id: "project-local",
    type: "project",
    sourceTeamId: null,
    name,
    summary: `${name} project with ${grouped.size} ${grouped.size === 1 ? "room" : "rooms"} and ${tasks.length} ${tasks.length === 1 ? "agent" : "agents"}.`,
    taskIds: tasks.map((task) => task.id),
    rooms: [...grouped.values()],
    sharedAt: existingIndex >= 0 ? store.publicProjects[existingIndex].sharedAt : sharedAt,
    updatedAt: sharedAt,
    copyCount: existingIndex >= 0 ? Math.max(0, Number(store.publicProjects[existingIndex].copyCount || 0)) : 0,
    lastCopiedAt: existingIndex >= 0 ? store.publicProjects[existingIndex].lastCopiedAt || null : null,
    ownerWalletAddress: null
  };
  if (existingIndex >= 0) store.publicProjects[existingIndex] = next;
  else store.publicProjects.unshift(next);
  event("agentgui_project_shared", "Project shared to Public Projects", {
    publicProjectId: next.id,
    taskIds: next.taskIds,
    rooms: next.rooms.map((room) => room.id)
  });
  await saveStore();
  return { ok: true, shared_public: true, project: agentGuiPublicCollectionSession(next, "project") };
}

async function connectAgentGuiWallet(body = {}) {
  const address = normalizeWalletAddress(body.address);
  const chainId = body.chain_id || body.chainId ? String(body.chain_id || body.chainId).slice(0, 40) : null;
  const signature = body.signature ? String(body.signature).slice(0, 500) : null;
  const seenAt = now();
  let wallet = store.walletSessions.find((item) => item.address === address);
  if (wallet) {
    wallet.chainId = chainId || wallet.chainId || null;
    wallet.signature = signature || wallet.signature || null;
    wallet.lastSeenAt = seenAt;
  } else {
    wallet = {
      id: `wallet-${randomUUID()}`,
      address,
      chainId,
      signature,
      createdAt: seenAt,
      lastSeenAt: seenAt
    };
    store.walletSessions.unshift(wallet);
  }
  event("agentgui_wallet_connected", "Wallet connected to OSA dashboard", {
    walletAddress: address,
    chainId
  });
  await saveStore();
  return {
    ok: true,
    wallet: {
      address: wallet.address,
      chain_id: wallet.chainId,
      connected_at: wallet.createdAt,
      last_seen_at: wallet.lastSeenAt
    }
  };
}

function agentGuiDonationTargetFromBody(body = {}) {
  const explicitType = body.target_type || body.targetType;
  const explicitId = body.target_id || body.targetId;
  if (explicitType && explicitId) {
    const targetType = String(explicitType);
    const targetId = String(explicitId).slice(0, 140);
    if (targetType === "agent") {
      const task = store.tasks.find((item) => item.id === targetId && item.sharedPublic);
      if (task) return { targetType, targetId, sessionId: `public-${task.id}` };
    }
    if (targetType === "room" && store.publicRooms.some((item) => item.id === targetId)) {
      return { targetType, targetId, sessionId: `public-room-${targetId}` };
    }
    if (targetType === "project" && store.publicProjects.some((item) => item.id === targetId)) {
      return { targetType, targetId, sessionId: `public-project-${targetId}` };
    }
  }

  const sessionId = String(body.session_id || body.sessionId || "").slice(0, 140);
  if (sessionId.startsWith("public-room-")) {
    const targetId = sessionId.slice("public-room-".length);
    if (store.publicRooms.some((item) => item.id === targetId)) return { targetType: "room", targetId, sessionId };
  }
  if (sessionId.startsWith("public-project-")) {
    const targetId = sessionId.slice("public-project-".length);
    if (store.publicProjects.some((item) => item.id === targetId)) return { targetType: "project", targetId, sessionId };
  }
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const task = store.tasks.find((item) => item.id === taskId && item.sharedPublic);
  if (task) return { targetType: "agent", targetId: task.id, sessionId: `public-${task.id}` };

  const error = new Error("Public donation target not found.");
  error.statusCode = 404;
  throw error;
}

async function createAgentGuiDonation(body = {}) {
  const target = agentGuiDonationTargetFromBody(body);
  const walletAddress = normalizeWalletAddress(body.wallet_address || body.walletAddress);
  const amount = normalizeDonationAmount(body.amount);
  const feeAmount = Math.round(amount * osaDonationFeePercent * 10_000) / 1_000_000;
  const chainId = body.chain_id || body.chainId ? String(body.chain_id || body.chainId).slice(0, 40) : null;
  const createdAt = now();
  const existingWallet = store.walletSessions.find((item) => item.address === walletAddress);
  if (existingWallet) {
    existingWallet.chainId = chainId || existingWallet.chainId || null;
    existingWallet.lastSeenAt = createdAt;
  } else {
    store.walletSessions.unshift({
      id: `wallet-${randomUUID()}`,
      address: walletAddress,
      chainId,
      signature: null,
      createdAt,
      lastSeenAt: createdAt
    });
  }
  const donation = {
    id: `donation-${randomUUID()}`,
    taskId: target.targetType === "agent" ? target.targetId : null,
    targetType: target.targetType,
    targetId: target.targetId,
    sessionId: target.sessionId,
    walletAddress,
    chainId,
    amount,
    currency: "USDC",
    feePercent: osaDonationFeePercent,
    feeWallet: osaDonationFeeWallet.toLowerCase(),
    feeAmount,
    creatorAmount: Math.max(0, Math.round((amount - feeAmount) * 1_000_000) / 1_000_000),
    status: "pledged",
    txHash: body.tx_hash ? String(body.tx_hash).slice(0, 100) : null,
    createdAt
  };
  store.agentDonations.unshift(donation);
  event("agentgui_donation_pledged", "USDC donation pledged for Public catalog item", {
    targetType: target.targetType,
    targetId: target.targetId,
    sessionId: donation.sessionId,
    walletAddress,
    amount,
    currency: "USDC",
    feeAmount,
    feeWallet: donation.feeWallet
  });
  await saveStore();
  return {
    ok: true,
    donation,
    stats: agentGuiDonationStats(target.targetType, target.targetId),
    fee: { percent: osaDonationFeePercent, wallet: osaDonationFeeWallet, amount: feeAmount },
    agent: target.targetType === "agent" ? agentGuiTopAgents(100).find((item) => item.task_id === target.targetId) || null : null
  };
}

function publicProjectReview(review) {
  return {
    id: review.id,
    project_id: review.projectId,
    wallet_address: review.walletAddress,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    created_at: review.createdAt,
    updated_at: review.updatedAt
  };
}

function publicProjectReviews(projectId) {
  return store.publicProjectReviews
    .filter((review) => review.projectId === projectId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicProjectReview);
}

async function createPublicProjectReview(projectId, body = {}) {
  const project = store.publicProjects.find((item) => item.id === projectId);
  if (!project) {
    const error = new Error("Public Project not found.");
    error.statusCode = 404;
    throw error;
  }
  const walletAddress = normalizeWalletAddress(body.wallet_address || body.walletAddress);
  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    const error = new Error("Rating must be between 1 and 5 stars.");
    error.statusCode = 400;
    throw error;
  }
  const comment = String(body.comment || "").trim().slice(0, 2000);
  const title = String(body.title || "").trim().slice(0, 120);
  const updatedAt = now();
  const existing = store.publicProjectReviews.find((review) =>
    review.projectId === project.id && review.walletAddress === walletAddress
  );
  const review = existing || {
    id: `project-review-${randomUUID()}`,
    projectId: project.id,
    walletAddress,
    createdAt: updatedAt
  };
  review.rating = rating;
  review.title = title;
  review.comment = comment;
  review.updatedAt = updatedAt;
  if (!existing) store.publicProjectReviews.unshift(review);
  project.updatedAt = updatedAt;
  event(existing ? "agentgui_project_review_updated" : "agentgui_project_review_created", "Public Project review saved", {
    publicProjectId: project.id,
    walletAddress,
    rating
  });
  await saveStore();
  return {
    ok: true,
    review: publicProjectReview(review),
    stats: agentGuiProjectReviewStats(project.id),
    project: agentGuiRankedPublicCollections("project", 100).find((item) => item.target_id === project.id) || null
  };
}

async function deleteAgentGuiSession(sessionId) {
  const taskId = agentGuiTaskIdFromSessionId(sessionId);
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("OSA desk not found.");
    error.statusCode = 404;
    throw error;
  }
  if (agentGuiSessionRoom(sessionId, task) === "public") {
    const error = new Error("Public tasks are copy-only. Copy them into Home before changing them.");
    error.statusCode = 409;
    throw error;
  }

  const deletedAt = now();
  const connector = task.agentGuiConnectorId
    ? store.connectorTokens.find((item) => item.id === task.agentGuiConnectorId)
    : null;
  if (connector?.status === "active") {
    revokeConnectorToken(connector, "agentgui_desk_deleted");
  } else if (task.agentGuiConnectorId) {
    stopManagedConnector(task.agentGuiConnectorId);
  }

  task.status = "deleted";
  task.agentGuiDeletedAt = deletedAt;
  task.updatedAt = deletedAt;
  task.assignedAgentId = null;
  task.leaseUntil = null;
  task.leaseId = null;
  event("agentgui_session_deleted", "OSA Home desk deleted", {
    taskId: task.id,
    goalId: task.goalId,
    connectorId: task.agentGuiConnectorId || null
  });
  await saveStore();
  return {
    ok: true,
    deleted: true,
    sandbox: false,
    workspace: false,
    transcripts: true,
    container: Boolean(connector)
  };
}

function startAgentGuiTaskConnector(req, task, agentId) {
  const existing = task.agentGuiConnectorId ? store.connectorTokens.find((item) => item.id === task.agentGuiConnectorId) : null;
  const existingManaged = existing ? managedConnectorStatus(existing.id) : null;
  if (existing && existing.status === "active" && ["starting", "running"].includes(existingManaged?.status)) {
    return existing;
  }

  const runner = agentGuiRunnerForAgent(agentId);
  const profile = agentGuiProfileById(agentId);
  task.agentGuiAgent = profile?.id || (runner === "codex" ? "codex-cli" : "openclaw-codex");
  task.agentGuiModel = profile?.model || (runner === "codex" ? "Codex CLI" : "OpenClaw local agent");
  task.updatedAt = now();

  const auth = agentGuiConnectorAuth(task.id);
  const { rawToken, connector } = createConnectorToken(auth, {
    mode: "worker",
    goalId: task.goalId,
    name: profile?.name || (runner === "codex" ? "Codex CLI Agent" : "Codex OpenClaw Agent"),
    capabilities: task.requiredCapabilities || ["research", "review", "synthesis"],
    models: [`connector:${runner}`],
    provider: "unknown",
    providers: [],
    expiresAt: afterMs(now(), 7 * 24 * 60 * 60 * 1000)
  });
  task.agentGuiConnectorId = connector.id;
  connector.agentGuiRunOnce = true;
  startManagedConnector(req, rawToken, connector, {
    models: connector.models,
    provider: connector.provider,
    providers: connector.providers
  });
  return connector;
}

function agentGuiSessionTitle(content) {
  const line = content.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "OSA task";
  return line.replace(/^#+\s*/, "").slice(0, 120) || "OSA task";
}

function agentGuiGoalForStart(body, title, content) {
  const teamId = String(body.team_id || "");
  const goal = {
    id: `goal-agentgui-${slugify(title)}-${randomUUID().slice(0, 8)}`,
    title,
    description: content,
    status: "active",
    supporters: 0,
    sourceProposalId: null,
    source: teamId === agentGuiPublicTeamId ? "agent-gui-public" : "agent-gui-home",
    createdAt: now()
  };
  store.goals.unshift(goal);
  event("agentgui_goal_created", `AgentGUI created ${goal.title}`, { goalId: goal.id });
  return goal;
}

function agentGuiRunnerForAgent(agentId) {
  if (agentId === "codex-cli") return "codex";
  const profile = store.agentProfiles.find((item) => item.id === agentId);
  if (profile?.runner === "codex") return "codex";
  return "openclaw";
}

function agentGuiProfileById(agentId) {
  return agentGuiAgents().find((profile) => profile.id === agentId) || null;
}

function agentGuiConnectorAuth(taskId) {
  const user = upsertUser(`agent-gui-${taskId}@local.osa`, "OSA AgentGUI");
  return { user, session: null };
}

function agentGuiFrontendLinked() {
  try {
    const html = readFileSync(join(agentGuiDistDir, "index.html"), "utf8");
    return html.includes("/assets/") || html.includes("OSA");
  } catch {
    return false;
  }
}

function openClawSetupStatus() {
  const command = process.env.OSA_OPENCLAW_COMMAND || "openclaw";
  const result = spawnSync(command, ["--version"], {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 2000
  });
  const available = !result.error && result.status === 0;
  const version = available
    ? String(result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || command
    : null;
  const linked = agentGuiFrontendLinked();
  return {
    available,
    command,
    version,
    agent_gui_linked: linked,
    setup_complete: linked && available,
    profile: "Codex / OpenClaw",
    rooms: { home: agentGuiHomeTeamId, public: agentGuiPublicTeamId },
    message: linked && available
      ? "OpenClaw is connected to the OSA AgentGUI adapter."
      : "OpenClaw needs to be installed or available on this host before local agents can run from Home.",
    install_hint: available
      ? undefined
      : "Install OpenClaw on this host or set OSA_OPENCLAW_COMMAND to the OpenClaw executable, then refresh this check."
  };
}

async function maybeHandleAgentGuiApi(req, res, url, method, path) {
  if (method === "GET" && path === "/api/network/stream") {
    return serveAgentGuiNetworkStream(req, res);
  }

  if (method === "GET" && path === "/api/sessions") {
    return sendJson(res, 200, agentGuiSessions());
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === "DELETE" && sessionMatch) {
    try {
      return sendJson(res, 200, await deleteAgentGuiSession(decodeURIComponent(sessionMatch[1])));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to delete OSA desk" });
    }
  }
  if (method === "GET" && sessionMatch) {
    const session = agentGuiSessionById(decodeURIComponent(sessionMatch[1]));
    return session ? sendJson(res, 200, session) : notFound(res);
  }

  const inspectStopMatch = path.match(/^\/api\/sessions\/([^/]+)\/inspect\/stop$/);
  if (method === "POST" && inspectStopMatch) return sendJson(res, 200, { ok: true });

  const sessionChildMatch = path.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
  if (sessionChildMatch) {
    const sessionId = decodeURIComponent(sessionChildMatch[1]);
    const child = sessionChildMatch[2];
    if (method === "GET" && child === "activity") return sendJson(res, 200, agentGuiActivity(sessionId));
    if (method === "GET" && child === "overview") {
      const events = agentGuiActivity(sessionId);
      return sendJson(res, 200, {
        events,
        started_at: events[0]?.timestamp || null,
        last_at: events.at(-1)?.timestamp || null,
        message_count: events.length,
        session_ids: [sessionId],
        truncated: false
      });
    }
    if (method === "GET" && child === "todos") return sendJson(res, 200, agentGuiTodos(sessionId));
    if (method === "GET" && (child === "files" || child === "workspace_tree")) return sendJson(res, 200, []);
    if (method === "GET" && (child === "console" || child === "terminal")) return sendJson(res, 200, { text: agentGuiConsoleText(sessionId, child) });
    if (method === "GET" && child === "history") {
      const session = agentGuiSessionById(sessionId);
      return session ? sendJson(res, 200, { desk_id: sessionId, profile: session.agent || "", sessions: [{ ...session, is_root: true, profile: session.agent || "" }] }) : notFound(res);
    }
    if (method === "GET" && child === "taskfile") {
      return sendJson(res, 200, { content: agentGuiTaskFile(sessionId), path: "TASK.md", workspace: "" });
    }
    if (method === "GET" && child === "audit") {
      return sendJson(res, 200, {
        session_id: sessionId,
        generated_at: now(),
        results: [],
        summary: { passed: 0, failed: 0, unsure: 0, total: 0 },
        cached: true
      });
    }
    if (method === "GET" && child === "progress") return sendJson(res, 200, { content: agentGuiTaskFile(sessionId), exists: true });
    if (method === "POST" && child === "copy") {
      try {
        return sendJson(res, 201, await copyAgentGuiSessionToHome(sessionId));
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to copy Public task into Home" });
      }
    }
    if (method === "POST" && child === "share") {
      try {
        const body = await readJson(req);
        return sendJson(res, 200, await setAgentGuiSessionPublicShare(sessionId, body.shared));
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to update Public sharing" });
      }
    }
    if (method === "POST" && child === "resume") {
      try {
        return sendJson(res, 200, resumeAgentGuiSession(req, sessionId, await readJson(req)));
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to connect OSA desk" });
      }
    }
    if (method === "POST" && child === "inspect") {
      const body = await readJson(req);
      return sendJson(res, 200, {
        ok: true,
        tool: body.tool || "diagnostics",
        result: agentGuiConsoleText(sessionId, "terminal")
      });
    }
    if (method === "POST" && ["redirect", "interrupt", "arrive", "sleep", "wake", "autocontinue", "audit", "progress"].includes(child)) {
      return sendJson(res, 200, { ok: true, enabled: false, max: 0, content: agentGuiTaskFile(sessionId), exists: true });
    }
    if (method === "PATCH" && child === "desk-config") {
      const session = agentGuiSessionById(sessionId);
      return session ? sendJson(res, 200, session) : notFound(res);
    }
  }

  if (method === "GET" && path.endsWith("/audit/status")) {
    return sendJson(res, 200, { current_hash: "", auditable: false, audited: true, summary: { passed: 0, failed: 0, unsure: 0, total: 0 } });
  }

  if (method === "POST" && path === "/api/sessions/new") {
    try {
      const body = await readJson(req);
      return sendJson(res, 201, await startAgentGuiSession(req, body));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to start OSA desk" });
    }
  }

  if (method === "GET" && path === "/api/gui-config") {
    const agents = agentGuiAgents();
    return sendJson(res, 200, {
      agent_profiles_dir: "osa://agents",
      desk_default_model: "OpenClaw local agent",
      agents,
      prototypes: agentGuiPrototypes(),
      global: { base_url: "", model: "OpenClaw local agent" },
      manager: { base_url: "", model: "OSA manager", uses_effective_agent_model: true },
      rooms: [
        { id: agentGuiHomeTeamId, name: "Home" },
        { id: agentGuiPublicTeamId, name: "Public" },
        { id: agentGuiPublicRoomsTeamId, name: "Public Rooms" },
        { id: agentGuiPublicProjectsTeamId, name: "Public Projects" }
      ]
    });
  }

  if (method === "POST" && path === "/api/public/rooms/share") {
    try {
      return sendJson(res, 200, await shareAgentGuiRoom(await readJson(req)));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to share room" });
    }
  }

  if (method === "POST" && path === "/api/public/projects/share") {
    try {
      return sendJson(res, 200, await shareAgentGuiProject(await readJson(req)));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to share project" });
    }
  }

  const projectReviewMatch = path.match(/^\/api\/public\/projects\/([^/]+)\/reviews$/);
  if (projectReviewMatch) {
    const projectId = decodeURIComponent(projectReviewMatch[1]);
    if (method === "GET") {
      const project = store.publicProjects.find((item) => item.id === projectId);
      return project
        ? sendJson(res, 200, { reviews: publicProjectReviews(projectId), stats: agentGuiProjectReviewStats(projectId) })
        : notFound(res);
    }
    if (method === "POST") {
      try {
        return sendJson(res, 201, await createPublicProjectReview(projectId, await readJson(req)));
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to save project review" });
      }
    }
  }

  if (method === "POST" && path === "/api/wallet/login") {
    try {
      return sendJson(res, 200, await connectAgentGuiWallet(await readJson(req)));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to connect wallet" });
    }
  }

  if (method === "POST" && path === "/api/donations") {
    try {
      return sendJson(res, 201, await createAgentGuiDonation(await readJson(req)));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to record donation" });
    }
  }

  if (method === "POST" && path === "/api/warmup") return sendJson(res, 200, { ok: true });
  if (method === "GET" && path === "/api/toolsets") {
    return sendJson(res, 200, {
      toolsets: [
        { name: "read", label: "Read", lean: true },
        { name: "write", label: "Write", lean: true },
        { name: "vote", label: "Vote", lean: true },
        { name: "review", label: "Review", lean: true },
        { name: "artifact", label: "Artifacts", lean: false }
      ],
      presets: { chat: [], lean: ["read", "vote", "review"], full: ["read", "write", "vote", "review", "artifact"] },
      default: "lean"
    });
  }
  if (method === "GET" && path === "/api/docker/config") return sendJson(res, 200, { persist: false });
  if (method === "POST" && path === "/api/docker/config") return sendJson(res, 200, { persist: false });
  if (method === "POST" && path === "/api/docker/cleanup") return sendJson(res, 200, { removed: 0, kept: 0, skipped: true, reason: "OSA connector workers are managed outside AgentGUI Docker cleanup" });
  if (method === "GET" && path === "/api/agents") return sendJson(res, 200, { agents: agentGuiAgents() });
  if (method === "GET" && path === "/api/agents/prototypes") return sendJson(res, 200, { prototypes: agentGuiPrototypes() });
  if (method === "POST" && path === "/api/agents") {
    try {
      const body = await readJson(req);
      const profile = createAgentGuiProfile(body);
      await saveStore();
      return sendJson(res, 201, { ok: true, agent: publicAgentGuiProfile(profile) });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { detail: error.message || "Unable to create OpenClaw profile" });
    }
  }

  const agentProfileMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (method === "DELETE" && agentProfileMatch) {
    const id = decodeURIComponent(agentProfileMatch[1]);
    const index = store.agentProfiles.findIndex((profile) => profile.id === id);
    if (index < 0) return notFound(res);
    store.agentProfiles.splice(index, 1);
    await saveStore();
    return sendJson(res, 200, { ok: true, id });
  }

  const agentChildMatch = path.match(/^\/api\/agents\/([^/]+)\/(capabilities|persona)$/);
  if (method === "GET" && agentChildMatch) {
    const id = decodeURIComponent(agentChildMatch[1]);
    if (agentChildMatch[2] === "capabilities") return sendJson(res, 200, agentGuiCapability(id));
    const profile = store.agentProfiles.find((item) => item.id === id);
    if (profile) {
      return sendJson(res, 200, {
        id: profile.id,
        soul: profile.soul,
        memory: profile.memory,
        profile_path: profile.profile_path,
        name: profile.name,
        tagline: profile.tagline,
        model: profile.model,
        base_url: profile.base_url,
        clone_from: profile.clone_from
      });
    }
    return sendJson(res, 200, {
      id,
      soul: "OpenClaw-local worker profile for OpenSwarmAgents.",
      memory: "State is maintained by this OSA node and your local OpenClaw setup.",
      profile_path: `osa://agents/${id}`,
      name: id,
      tagline: "OpenClaw worker profile",
      model: id === "codex-cli" ? "Codex CLI" : "OpenClaw local agent",
      base_url: ""
    });
  }
  if (method === "PUT" && agentChildMatch && agentChildMatch[2] === "persona") {
    const id = decodeURIComponent(agentChildMatch[1]);
    const profile = store.agentProfiles.find((item) => item.id === id);
    if (!profile) return notFound(res);
    const body = await readJson(req);
    if (body.name !== undefined) profile.name = String(body.name || profile.id).slice(0, 80);
    if (body.tagline !== undefined) profile.tagline = String(body.tagline || "Private OpenClaw worker profile").slice(0, 160);
    profile.soul = String(body.soul || "").slice(0, 20_000);
    profile.memory = String(body.memory || "").slice(0, 20_000);
    if (body.model_default !== undefined) profile.model = String(body.model_default || "OpenClaw local agent").slice(0, 120);
    if (body.base_url !== undefined) profile.base_url = String(body.base_url || "").slice(0, 500);
    await saveStore();
    return sendJson(res, 200, { ok: true, id });
  }

  if (method === "GET" && path === "/api/llm/models") {
    return sendJson(res, 200, {
      models: ["OpenClaw local agent", "Codex CLI", "OSA connector"],
      current: "OpenClaw local agent",
      base_url: ""
    });
  }
  if (method === "GET" && path === "/api/llm/providers") return sendJson(res, 200, { providers: [], active: "" });
  if (method === "GET" && path === "/api/models/reasoning") return sendJson(res, 200, { options: [] });
  if (method === "GET" && path === "/api/manager/profile") return sendJson(res, 200, { profile: "osa-manager", model: "OSA manager", base_url: "" });
  if (method === "POST" && path === "/api/manager/profile") return sendJson(res, 200, { profile: "osa-manager", model: "OSA manager" });
  if (method === "GET" && path === "/api/search") {
    const q = String(url.searchParams.get("q") || "").toLowerCase();
    return sendJson(res, 200, agentGuiSessions().filter((session) => `${session.title} ${session.title_summary}`.toLowerCase().includes(q)));
  }
  if (method === "GET" && path === "/api/top-agents") {
    const limit = Number(url.searchParams.get("limit") || 100);
    return sendJson(res, 200, { agents: agentGuiTopAgents(limit), generated_at: now() });
  }
  if (method === "GET" && path === "/api/top-rooms") {
    const limit = Number(url.searchParams.get("limit") || 100);
    return sendJson(res, 200, { agents: agentGuiRankedPublicCollections("room", limit), generated_at: now() });
  }
  if (method === "GET" && path === "/api/top-projects") {
    const limit = Number(url.searchParams.get("limit") || 100);
    return sendJson(res, 200, { agents: agentGuiRankedPublicCollections("project", limit), generated_at: now() });
  }
  if (method === "GET" && path === "/api/sessions/saved") return sendJson(res, 200, { dir: "", archives: [] });

  const teamsMatch = path.match(/^\/api\/teams\/([^/]+)\/(files|sync|register)$/);
  if (teamsMatch) {
    if (method === "GET" && teamsMatch[2] === "files") return sendJson(res, 200, { files: [], root: "" });
    return sendJson(res, 200, { ok: true, registered: 0, synced_desks: 0 });
  }

  if (method === "GET" && path === "/api/global/persona") {
    return sendJson(res, 200, { id: "osa-default", profile_path: "osa://global", model: "OpenClaw local agent", base_url: "", soul: "OpenClaw-local OpenSwarmAgents worker.", memory: "" });
  }
  if (method === "PUT" && path === "/api/global/persona") return sendJson(res, 200, { ok: true });
  if (method === "GET" && path === "/api/openclaw/status") return sendJson(res, 200, openClawSetupStatus());
  if (method === "POST" && path.startsWith("/api/workspace/")) return sendJson(res, 200, { ok: false });
  if (method === "GET" && path.startsWith("/api/file/")) return sendJson(res, 404, { detail: "No OSA workspace file preview for this desk yet." });

  return false;
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const path = url.pathname;

  try {
    const maintenanceChanged = runMaintenance();

    const agentGuiHandled = await maybeHandleAgentGuiApi(req, res, url, method, path);
    if (agentGuiHandled !== false) return agentGuiHandled;

    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        runtime: publicRuntime(),
        serverTime: now()
      });
    }

    if (method === "GET" && path === "/api/trust-ledger") {
      const auth = authFromReq(req);
      if (!auth && !publicTrustLedgerEnabled) {
        return unauthorized(res, "Sign in before reading the Trust Ledger");
      }
      return sendJson(res, 200, {
        node: publicNodeIdentity(),
        head: localTrustHead(),
        headsByNode: trustHeadsByNode(),
        entries: publicTrustLedger(200),
        count: (store.trustLedger || []).length
      });
    }

    if (method === "GET" && path === "/api/federation/snapshot") {
      const access = federationAccessFromReq(req);
      if (!access.ok) return sendJson(res, access.status, { error: access.status === 404 ? "not_found" : "forbidden", message: access.message });
      if (!enforceRateLimit(req, res, "federation-snapshot", `peer:${clientIdentity(req)}`, { limit: 120, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      return sendJson(res, 200, publicFederationSnapshot());
    }

    if (method === "POST" && path === "/api/federation/import") {
      const access = federationAccessFromReq(req);
      if (!access.ok) return sendJson(res, access.status, { error: access.status === 404 ? "not_found" : "forbidden", message: access.message });
      if (!enforceRateLimit(req, res, "federation-import", `peer:${clientIdentity(req)}`, { limit: 120, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const body = await readJson(req, maxJsonBytes * 4);
      const changed = importFederationSnapshot(body.snapshot || body);
      const totalChanged = Object.values(changed).reduce((total, count) => total + Number(count || 0), 0);
      if (totalChanged) {
        event("federation_imported", `Imported ${totalChanged} federated changes`, {
          changed,
          peerNodeId: (body.snapshot || body)?.node?.nodeId || null
        });
        await saveStore();
      }
      return sendJson(res, 200, {
        ok: true,
        changed,
        changedTotal: totalChanged,
        node: publicNodeIdentity(),
        head: localTrustHead(),
        headsByNode: trustHeadsByNode()
      });
    }

    const artifactDownloadMatch = path.match(/^\/api\/artifacts\/([^/]+)\/download$/);
    if (method === "GET" && artifactDownloadMatch) {
      return serveArtifactDownload(req, res, artifactDownloadMatch[1]);
    }

    if (method === "GET" && path === "/api/events/stream") {
      return serveRealtimeStream(req, res);
    }

    if (method === "GET" && path === "/api/state") {
      const auth = authFromReq(req);
      if (maintenanceChanged || auth) await saveStore();
      return sendJson(res, 200, publicState(auth));
    }

    if (method === "GET" && path === "/api/auth/oauth/providers") {
      return sendJson(res, 200, publicOAuthProviders(req));
    }

    const oauthStartMatch = path.match(/^\/api\/auth\/oauth\/(github|google)\/start$/);
    if (method === "GET" && oauthStartMatch) {
      return startOAuth(req, res, oauthStartMatch[1], url);
    }

    const oauthCallbackMatch = path.match(/^\/api\/auth\/oauth\/(github|google)\/callback$/);
    if (method === "GET" && oauthCallbackMatch) {
      return completeOAuth(req, res, oauthCallbackMatch[1], url);
    }

    if (method === "POST" && path === "/api/auth/login") {
      if (!enforceRateLimit(req, res, "auth-login", rateIdentity(req), { limit: 10, windowMs: 10 * 60 * 1000 })) {
        return;
      }
      if (!isDevLoginEnabled()) {
        return forbidden(res, "Local node login is disabled on this OSA node.");
      }
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const name = String(body.name || email.split("@")[0] || "OSA User").trim().slice(0, 80);
      const password = String(body.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest(res, "Valid email is required");
      if (localPasswordRequired() && password.length < 12) {
        return badRequest(res, "Local node password must be at least 12 characters");
      }

      let user = store.users.find((item) => item.email === email);
      if (user?.passwordHash) {
        if (!verifyPassword(user, password)) return forbidden(res, "Invalid local node credentials");
        user.name = name || user.name;
        user.lastSeen = now();
      } else {
        user = upsertUser(email, name);
        if (password) setUserPassword(user, password);
      }
      const session = createSession(user);
      await saveStore();
      return sendJson(res, 201, { user: publicUser(user), sessionToken: session.token }, { "set-cookie": sessionCookie(session.token) });
    }

    if (method === "GET" && path === "/api/auth/me") {
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res);
      await saveStore();
      return sendJson(res, 200, { user: publicUser(auth.user) });
    }

    if (method === "POST" && path === "/api/auth/logout") {
      const auth = authFromReq(req);
      const clearCookie = sessionCookie("", 0);
      if (!auth) return sendJson(res, 200, { ok: true }, { "set-cookie": clearCookie });
      store.sessions = store.sessions.filter((session) => session.id !== auth.session.id);
      await saveStore();
      return sendJson(res, 200, { ok: true }, { "set-cookie": clearCookie });
    }

    if (method === "POST" && path === "/api/connectors/token") {
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res, "Sign in before creating connector tokens");
      if (!enforceRateLimit(req, res, "connector-token-create", rateIdentity(req, auth), { limit: 12, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const body = await readJson(req);
      try {
        const { rawToken, connector } = createConnectorToken(auth, body);
        await saveStore();
        return sendJson(res, 201, {
          token: rawToken,
          connector: publicConnectorToken(connector),
          state: publicState(auth)
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (method === "POST" && path === "/api/connectors/start") {
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res, "Sign in before starting connector workers");
      if (!enforceRateLimit(req, res, "connector-managed-start", rateIdentity(req, auth), { limit: 12, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const body = await readJson(req);
      try {
        validateManagedConnectorStart(body);
        const { rawToken, connector } = createConnectorToken(auth, body);
        startManagedConnector(req, rawToken, connector, body);
        await saveStore();
        return sendJson(res, 201, {
          connector: publicConnectorToken(connector),
          state: publicState(auth)
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (method === "POST" && path === "/api/artifacts/upload") {
      const auth = authFromReq(req);
      const connector = connectorTokenFromReq(req);
      if (!auth && !connector) return unauthorized(res, "Sign in or use a connector token before uploading artifacts");
      const actorIdentity = connector ? `connector:${connector.token.id}` : rateIdentity(req, auth);
      if (!enforceRateLimit(req, res, "artifact-upload", actorIdentity, { limit: 40, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const body = await readJson(req, Math.ceil(maxArtifactUploadBytes * 1.4) + 4096);
      const artifact = await createUploadedArtifact(auth, connector, body);
      await saveStore();
      return sendJson(res, 201, { artifact: publicArtifact(artifact), state: publicState(auth) });
    }

    const connectorRotateMatch = path.match(/^\/api\/connectors\/([^/]+)\/rotate$/);
    if (method === "POST" && connectorRotateMatch) {
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res, "Sign in before rotating connector tokens");
      if (!enforceRateLimit(req, res, "connector-token-rotate", rateIdentity(req, auth), { limit: 20, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const connector = store.connectorTokens.find((item) => item.id === connectorRotateMatch[1]);
      if (!connector || connector.userId !== auth.user.id) return notFound(res);
      try {
        const rotated = rotateConnectorToken(auth, connector);
        await saveStore();
        return sendJson(res, 201, {
          token: rotated.rawToken,
          connector: publicConnectorToken(rotated.connector),
          previousConnector: publicConnectorToken(connector),
          state: publicState(auth)
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    const connectorRevokeMatch = path.match(/^\/api\/connectors\/([^/]+)\/revoke$/);
    if (method === "POST" && connectorRevokeMatch) {
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res, "Sign in before revoking connector tokens");
      if (!enforceRateLimit(req, res, "connector-token-revoke", rateIdentity(req, auth), { limit: 30, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      const connector = store.connectorTokens.find((item) => item.id === connectorRevokeMatch[1]);
      if (!connector || connector.userId !== auth.user.id) return notFound(res);
      revokeConnectorToken(connector);
      await saveStore();
      return sendJson(res, 200, {
        connector: publicConnectorToken(connector),
        state: publicState(auth)
      });
    }

    if (method === "POST" && path === "/api/demo/reset") {
      if (!areDemoEndpointsEnabled()) return forbidden(res, "Demo endpoints are disabled");
      const seed = JSON.parse(await readFile(seedPath, "utf8"));
      store = normalizeStore({
        ...seed,
        agents: [],
        results: [],
        reviews: [],
        claims: [],
        users: [],
        sessions: [],
        connectorTokens: [],
        oauthStates: [],
        proposalVotes: [],
        events: []
      });
      event("system", "Demo state reset");
      await saveStore();
      return sendJson(res, 200, publicState());
    }

    if (method === "POST" && path === "/api/demo/cycle") {
      if (!areDemoEndpointsEnabled()) return forbidden(res, "Demo endpoints are disabled");
      runDemoCycle();
      await saveStore();
      return sendJson(res, 200, publicState());
    }

    if (method === "POST" && path === "/api/agents/register") {
      const body = await readJson(req);
      const auth = authFromReq(req);
      const connector = connectorTokenFromReq(req);
      if (!auth && !connector) return unauthorized(res, "Sign in or use a scoped connector token before registering agents");
      const actorIdentity = connector ? `connector:${connector.token.id}` : rateIdentity(req, auth);
      if (!enforceRateLimit(req, res, "agent-register", actorIdentity, { limit: 30, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      if (connector && connector.token.mode !== "worker") return forbidden(res, "Connector token is not scoped to the Worker Pool");
      const actorUser = auth?.user || connector?.user || null;
      const requestedGoalId = connector?.token.goalId || body.goalId;
      const goal = store.goals.find((item) => item.id === requestedGoalId);
      if (!goal) return badRequest(res, "Unknown goalId");
      if (goal.status === "completed") return badRequest(res, "Goal is already completed");
      if (actorUser) {
        const activeAgent = store.agents.find(
          (agent) => agent.userId === actorUser.id && agent.status === "online" && agent.goalId !== "voting-pool"
        );
        if (activeAgent && activeAgent.goalId !== goal.id) {
          return badRequest(res, "User is already connected to another worker project");
        }
        if (activeAgent && activeAgent.goalId === goal.id) {
          updateAgentProviderMetadata(activeAgent, body);
          if (connector) {
            activeAgent.connectorTokenId = connector.token.id;
            connector.token.agentId = activeAgent.id;
            connector.token.lastUsedAt = now();
          }
          activeAgent.lastSeen = now();
          await saveStore();
          return sendJson(res, 200, { agent: activeAgent, state: publicState() });
        }
      }

      const agent = {
        id: `agent-${randomUUID()}`,
        userId: actorUser?.id || null,
        connectorTokenId: connector?.token.id || null,
        name: String(body.name || connector?.token.name || "Unnamed Agent").slice(0, 80),
        goalId: goal.id,
        capabilities: ensureConsensusCapability(normalizeList(body.capabilities, connector?.token.capabilities || ["research", "review"])),
        models: normalizeList(body.models, connector?.token.models || ["unknown"]),
        provider: normalizeProvider(body.provider || connector?.token.provider),
        providers: normalizeProviders(body.providers || connector?.token.providers),
        maxConcurrentTasks: Math.max(1, Math.min(5, Number(body.maxConcurrentTasks || 1))),
        reputation: {
          research: 0,
          review: 0,
          synthesis: 0,
          accepted: 0,
          disputed: 0
        },
        status: "online",
        lastSeen: now(),
        createdAt: now()
      };

      store.agents.push(agent);
      if (connector) {
        connector.token.agentId = agent.id;
        connector.token.lastUsedAt = now();
      }
      goal.supporters += 1;
      event("agent_registered", `${agent.name} joined ${goal.title}`, {
        agentId: agent.id,
        goalId: goal.id
      });
      await saveStore();
      return sendJson(res, 201, { agent, state: publicState() });
    }

    if (method === "POST" && path === "/api/proposals") {
      const body = await readJson(req);
      const auth = authFromReq(req);
      if (!auth) return unauthorized(res, "Sign in before submitting project proposals");
      if (!enforceRateLimit(req, res, "proposal-create", rateIdentity(req, auth), { limit: 5, windowMs: 24 * 60 * 60 * 1000 })) {
        return;
      }
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      if (title.length < 6) return badRequest(res, "Proposal title is too short");
      if (description.length < 80) return badRequest(res, "Project brief must be at least 80 characters");

      const proposal = {
        id: `proposal-${randomUUID()}`,
        title: title.slice(0, 120),
        description: description.slice(0, 12000),
        createdBy: auth.user.id,
        createdByHash: hashToken(auth.user.id),
        createdByName: auth.user.name,
        status: "voting",
        score: 0,
        votes: 0,
        createdAt: now()
      };
      proposal.votingEndsAt = afterMs(proposal.createdAt, proposalVotingMs);
      proposal.signature = recordSignedContribution("proposal", {
        proposalId: proposal.id,
        title: proposal.title,
        descriptionHash: hashToken(proposal.description),
        createdByHash: proposal.createdByHash
      }, {
        objectType: "proposal",
        objectId: proposal.id
      });
      store.proposals.unshift(proposal);
      event("proposal_created", `New proposal: ${proposal.title}`, { proposalId: proposal.id });
      await saveStore();
      return sendJson(res, 201, { proposal, state: publicState() });
    }

    if (method === "POST" && path === "/api/voting/connect") {
      const body = await readJson(req);
      const auth = authFromReq(req);
      const connector = connectorTokenFromReq(req);
      if (!auth && !connector) return unauthorized(res, "Sign in or use a scoped Voting Pool connector token before connecting a voting agent");
      const actorIdentity = connector ? `connector:${connector.token.id}` : rateIdentity(req, auth);
      if (!enforceRateLimit(req, res, "voting-connect", actorIdentity, { limit: 20, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      if (connector && connector.token.mode !== "voting") return forbidden(res, "Connector token is not scoped to the Voting Pool");
      const actorUser = auth?.user || connector?.user || null;
      let agent = body.agentId ? findAgent(body.agentId) : null;
      if (connector?.token.agentId) {
        agent = findAgent(connector.token.agentId);
      }
      if (!agent && actorUser) {
        agent = store.agents.find((item) => item.userId === actorUser.id && item.goalId === "voting-pool");
      }
      if (!agent) {
        agent = {
          id: `agent-${randomUUID()}`,
          userId: actorUser?.id || null,
          connectorTokenId: connector?.token.id || null,
          name: String(body.name || connector?.token.name || `Voting Agent ${store.agents.length + 1}`).slice(0, 80),
          goalId: "voting-pool",
          capabilities: ["vote", "review", "research"],
          models: normalizeList(body.models, ["voting-sim"]),
          provider: normalizeProvider(body.provider),
          providers: normalizeProviders(body.providers),
          maxConcurrentTasks: 1,
          reputation: {
            research: 0,
            review: 0,
            synthesis: 0,
            accepted: 0,
            disputed: 0,
            voting: 0
          },
          status: "online",
          lastSeen: now(),
          createdAt: now()
        };
        store.agents.push(agent);
      }
      if (connector) {
        agent.connectorTokenId = connector.token.id;
        connector.token.agentId = agent.id;
        connector.token.lastUsedAt = now();
      }
      agent.status = "online";
      agent.lastSeen = now();
      updateAgentProviderMetadata(agent, body);
      const existingVote = store.proposalVotes.find((vote) => vote.agentId === agent.id);
      const vote = castProposalVote(agent);
      await saveStore();
      return sendJson(res, 201, {
        agent,
        vote,
        decision: votingDecisionPayload(agent, vote, Boolean(existingVote)),
        state: publicState()
      });
    }

    const proposalVoteMatch = path.match(/^\/api\/proposals\/([^/]+)\/vote$/);
    if (method === "POST" && proposalVoteMatch) {
      const body = await readJson(req);
      const proposal = store.proposals.find((item) => item.id === proposalVoteMatch[1]);
      if (!proposal) return notFound(res);
      const agent = findAgent(body.agentId);
      if (!agent) return badRequest(res, "Unknown agentId");
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (agent.goalId !== "voting-pool") return forbidden(res, "Only Voting Pool agents can vote on proposals");
      if (!enforceRateLimit(req, res, "proposal-vote", `agent:${agent.id}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      if (proposal.status !== "voting") return badRequest(res, "Proposal is not in voting");

      const vote = addProposalVote(proposal, agent, Number(body.score || 1), String(body.reason || ""));
      await saveStore();
      return sendJson(res, 201, { vote, state: publicState() });
    }

    const heartbeatMatch = path.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (method === "POST" && heartbeatMatch) {
      const agent = findAgent(heartbeatMatch[1]);
      if (!agent) return notFound(res);
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (!enforceRateLimit(req, res, "agent-heartbeat", `agent:${agent.id}`, { limit: 240, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      agent.status = "online";
      agent.lastSeen = now();
      await saveStore();
      return sendJson(res, 200, { agent });
    }

    const disconnectMatch = path.match(/^\/api\/agents\/([^/]+)\/disconnect$/);
    if (method === "POST" && disconnectMatch) {
      const agent = findAgent(disconnectMatch[1]);
      if (!agent) return notFound(res);
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (!enforceRateLimit(req, res, "agent-disconnect", `agent:${agent.id}`, { limit: 30, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      agent.status = "offline";
      agent.lastSeen = now();
      releaseAgentLeases(agent.id);
      reconcileConsensusAfterAgentDisconnect(agent.id);
      event("agent_disconnected", `${agent.name} disconnected from worker pool`, {
        agentId: agent.id,
        goalId: agent.goalId
      });
      await saveStore();
      return sendJson(res, 200, { agent, state: publicState() });
    }

    if (method === "POST" && path === "/api/tasks/claim") {
      const body = await readJson(req);
      const agent = findAgent(body.agentId);
      if (!agent) return badRequest(res, "Unknown agentId");
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (!enforceRateLimit(req, res, "task-claim", `agent:${agent.id}`, { limit: 120, windowMs: 60 * 60 * 1000 })) {
        return;
      }

      recoverExpiredLeases();
      agent.status = "online";
      agent.lastSeen = now();

      const activeLeases = store.tasks.filter(
        (task) => task.status === "leased" && task.assignedAgentId === agent.id
      ).length;
      if (activeLeases >= agent.maxConcurrentTasks) {
        return sendJson(res, 200, { task: null, reason: "max_concurrent_tasks_reached" });
      }

      const goalId = agent.goalId;
      const task = store.tasks
        .filter((item) => item.status === "open")
        .filter((item) => item.goalId === goalId)
        .filter((item) => store.goals.some((goal) => goal.id === item.goalId && goal.status !== "completed"))
        .filter((item) => !item.assignedReviewerId || item.assignedReviewerId === agent.id)
        .filter((item) => agentCanRun(agent, item))
        .sort(taskSort)[0];

      if (!task) {
        return sendJson(res, 200, { task: null, reason: "no_matching_task" });
      }

      task.status = "leased";
      task.assignedAgentId = agent.id;
      task.leaseId = `lease-${randomUUID()}`;
      task.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      task.updatedAt = now();
      event("task_leased", `${agent.name} claimed ${task.title}`, {
        agentId: agent.id,
        taskId: task.id,
        leaseUntil: task.leaseUntil
      });
      await saveStore();
      return sendJson(res, 200, { task, context: taskCollaborationContext(task) });
    }

    const resultMatch = path.match(/^\/api\/tasks\/([^/]+)\/result$/);
    if (method === "POST" && resultMatch) {
      const task = store.tasks.find((item) => item.id === resultMatch[1]);
      if (!task) return notFound(res);
      const body = await readJson(req);
      const agent = findAgent(body.agentId);
      if (!agent) return badRequest(res, "Unknown agentId");
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (!enforceRateLimit(req, res, "result-submit", `agent:${agent.id}`, { limit: 30, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      if (task.assignedAgentId !== agent.id) return badRequest(res, "Task is not leased to this agent");
      const artifacts = normalizeResultArtifacts(body.artifacts, task, agent, access);

      const result = {
        id: `result-${randomUUID()}`,
        taskId: task.id,
        goalId: task.goalId,
        agentId: agent.id,
        summary: String(body.summary || "").slice(0, 240),
        content: String(body.content || "").slice(0, 10000),
        artifacts,
        sources: normalizeList(body.sources, []),
        confidence: clamp(Number(body.confidence || 0.5), 0, 1),
        status: "in_consensus",
        iteration: Number(task.iteration || 1),
        consensus: createConsensusSnapshot(task.goalId, agent.id),
        createdAt: now()
      };
      result.signature = recordSignedContribution("task_result", {
        resultId: result.id,
        taskId: result.taskId,
        goalId: result.goalId,
        agentId: result.agentId,
        summaryHash: hashToken(result.summary),
        contentHash: hashToken(result.content),
        artifactIds: result.artifacts.map((artifact) => artifact.id).filter(Boolean)
      }, {
        objectType: "result",
        objectId: result.id
      });

      task.status = "in_consensus";
      task.leaseUntil = null;
      task.leaseId = null;
      task.updatedAt = now();
      store.results.push(result);

      if (result.consensus.requiredAgentIds.length) {
        createConsensusReviewTasks(task, result);
      } else {
        finalizeAcceptedResult(result, null);
      }
      agent.reputation[task.type] = (agent.reputation[task.type] || 0) + 1;
      event("result_submitted", `${agent.name} submitted result for ${task.title}`, {
        resultId: result.id,
        taskId: task.id,
        consensusRequired: result.consensus.requiredAgentIds.length
      });
      await saveStore();
      return sendJson(res, 201, { result, state: publicState() });
    }

    const reviewMatch = path.match(/^\/api\/results\/([^/]+)\/review$/);
    if (method === "POST" && reviewMatch) {
      const result = store.results.find((item) => item.id === reviewMatch[1]);
      if (!result) return notFound(res);
      const body = await readJson(req);
      const agent = findAgent(body.agentId);
      if (!agent) return badRequest(res, "Unknown agentId");
      const access = authorizeAgentAccess(req, agent);
      if (!access.ok) return rejectAgentAccess(res, access);
      if (!enforceRateLimit(req, res, "review-submit", `agent:${agent.id}`, { limit: 60, windowMs: 60 * 60 * 1000 })) {
        return;
      }
      if (agent.id === result.agentId) return badRequest(res, "Result author cannot review own result");
      if (store.reviews.some((item) => item.resultId === result.id && item.agentId === agent.id)) {
        return badRequest(res, "Agent already reviewed this result");
      }
      if (result.consensus?.requiredAgentIds?.length && !result.consensus.requiredAgentIds.includes(agent.id)) {
        return badRequest(res, "Agent is not part of this result consensus group");
      }

      const decision = ["accepted", "rejected", "needs_revision"].includes(body.decision)
        ? body.decision
        : "needs_revision";
      const review = {
        id: `review-${randomUUID()}`,
        resultId: result.id,
        goalId: result.goalId,
        taskId: result.taskId,
        agentId: agent.id,
        decision,
        score: clamp(Number(body.score || 0.5), 0, 1),
        reason: String(body.reason || "").slice(0, 2000),
        createdAt: now()
      };
      review.signature = recordSignedContribution("result_review", {
        reviewId: review.id,
        resultId: review.resultId,
        taskId: review.taskId,
        agentId: review.agentId,
        decision: review.decision,
        score: review.score,
        reasonHash: hashToken(review.reason)
      }, {
        objectType: "review",
        objectId: review.id
      });

      store.reviews.push(review);
      agent.reputation.review += decision === "accepted" ? 1 : 0.5;
      applyReviewDecision(result, review);
      event("review_submitted", `${agent.name} reviewed ${result.summary || result.id}`, {
        resultId: result.id,
        decision
      });
      await saveStore();
      return sendJson(res, 201, { review, state: publicState() });
    }

    return notFound(res);
  } catch (error) {
    if (error.statusCode === 413) return payloadTooLarge(res, error.message);
    if (error.statusCode === 400) return badRequest(res, error.message);
    if (error.statusCode === 403) return forbidden(res, error.message);
    console.error(error);
    return sendJson(res, 500, { error: "internal_error", message: error.message });
  }
}

function topVotingProposal() {
  return store.proposals
    .filter((proposal) => proposal.status === "voting" && proposal.votes > 0)
    .sort((a, b) => b.score - a.score || b.votes - a.votes || a.createdAt.localeCompare(b.createdAt))[0];
}

function topExpiredVotingProposal() {
  const timestamp = Date.now();
  return store.proposals
    .filter((proposal) => proposal.status === "voting")
    .filter((proposal) => proposal.votes > 0)
    .filter((proposal) => Date.parse(proposal.votingEndsAt) <= timestamp)
    .sort((a, b) => b.votes - a.votes || b.score - a.score || a.createdAt.localeCompare(b.createdAt))[0];
}

function runMaintenance() {
  let changed = false;
  changed = recoverExpiredLeases() || changed;
  changed = recoverExpiredConnectorTokens() || changed;
  changed = autoPromoteExpiredWinner() || changed;
  return changed;
}

function autoPromoteExpiredWinner() {
  const winner = topExpiredVotingProposal();
  if (!winner) return false;
  promoteProposal(winner, "auto_72h");
  return true;
}

function normalizeProposal(proposal) {
  const createdAt = proposal.createdAt || now();
  const createdByHash = proposal.createdByHash || (proposal.createdBy ? hashToken(proposal.createdBy) : null);
  return {
    ...proposal,
    createdAt,
    createdByHash,
    score: Number(proposal.score || 0),
    votes: Number(proposal.votes || 0),
    status: proposal.status || "voting",
    votingEndsAt: proposal.votingEndsAt || afterMs(createdAt, proposalVotingMs)
  };
}

function castProposalVote(agent) {
  const existingVote = store.proposalVotes.find((vote) => vote.agentId === agent.id);
  if (existingVote) return existingVote;

  const proposal = store.proposals
    .filter((item) => item.status === "voting")
    .sort((a, b) => proposalHeuristic(b) - proposalHeuristic(a) || a.createdAt.localeCompare(b.createdAt))[0];

  if (!proposal) return null;
  return addProposalVote(
    proposal,
    agent,
    Number(proposalHeuristic(proposal).toFixed(2)),
    proposalVoteReason(proposal)
  );
}

function votingDecisionPayload(agent, vote, alreadyVoted = false) {
  if (!vote) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      proposalId: null,
      proposalTitle: null,
      reason: "No open proposal is currently available in the Voting Pool.",
      alreadyVoted
    };
  }

  const proposal = store.proposals.find((item) => item.id === vote.proposalId);
  return {
    agentId: agent.id,
    agentName: agent.name,
    proposalId: vote.proposalId,
    proposalTitle: proposal?.title || "Unknown proposal",
    reason: vote.reason || "The agent selected this proposal as the strongest option in the Voting Pool.",
    alreadyVoted
  };
}

function proposalHeuristic(proposal) {
  const text = `${proposal.title} ${proposal.description}`.toLowerCase();
  let score = 1;
  for (const word of ["agent", "connector", "security", "safe", "trust", "open", "verified", "knowledge"]) {
    if (text.includes(word)) score += 0.35;
  }
  if (text.length > 180) score += 0.2;
  return score;
}

function proposalVoteReason(proposal) {
  const text = `${proposal.title} ${proposal.description}`.toLowerCase();
  const signals = [];
  if (text.includes("agent") || text.includes("connector")) signals.push("it improves the agent network itself");
  if (text.includes("security") || text.includes("safe") || text.includes("trust")) signals.push("it reduces platform risk");
  if (text.includes("open") || text.includes("verified") || text.includes("knowledge")) signals.push("it can produce reusable verified knowledge");
  if (!signals.length) signals.push("it appears feasible and useful based on the project brief");
  return `The agent selected this proposal because ${signals.slice(0, 2).join(" and ")}.`;
}

function addProposalVote(proposal, agent, score, reason) {
  const existing = store.proposalVotes.find((vote) => vote.agentId === agent.id);
  if (existing) return existing;
  const vote = {
    id: `vote-${randomUUID()}`,
    proposalId: proposal.id,
    agentId: agent.id,
    score: clamp(score, 0, 5),
    reason: reason.slice(0, 1000),
    createdAt: now()
  };
  vote.signature = recordSignedContribution("proposal_vote", {
    voteId: vote.id,
    proposalId: proposal.id,
    agentId: agent.id,
    score: vote.score,
    reasonHash: hashToken(vote.reason)
  }, {
    objectType: "proposal_vote",
    objectId: vote.id
  });
  store.proposalVotes.push(vote);
  proposal.votes += 1;
  proposal.score = Number((proposal.score + vote.score).toFixed(2));
  agent.lastSeen = now();
  agent.reputation.voting = 1;
  event("proposal_voted", `${agent.name} voted for ${proposal.title}`, {
    proposalId: proposal.id,
    agentId: agent.id
  });
  return vote;
}

function promoteProposal(proposal, mode = "manual") {
  proposal.status = "promoted";
  proposal.promotedAt = now();
  proposal.promotionMode = mode;
  const goal = {
    id: `goal-${slugify(proposal.title)}-${randomUUID().slice(0, 8)}`,
    title: proposal.title,
    description: proposal.description,
    status: "active",
    supporters: 0,
    sourceProposalId: proposal.id,
    createdAt: now()
  };
  store.goals.unshift(goal);
  store.tasks.push(
    {
      id: `task-${randomUUID()}`,
      goalId: goal.id,
      type: "research",
      title: `Baseline research for ${proposal.title}`,
      description: `Collect the strongest available evidence, prior art, constraints, and open questions for: ${proposal.description}`,
      requiredCapabilities: ["research"],
      priority: 85,
      status: "open",
      createdAt: now()
    },
    {
      id: `task-${randomUUID()}`,
      goalId: goal.id,
      type: "synthesis",
      title: `Create initial plan for ${proposal.title}`,
      description: "Turn accepted research into a practical first execution roadmap with milestones and validation steps.",
      requiredCapabilities: ["synthesis"],
      priority: 72,
      status: "open",
      createdAt: now()
    }
  );
  event("proposal_promoted", `Promoted proposal into worker pool: ${proposal.title}`, {
    proposalId: proposal.id,
    goalId: goal.id,
    mode
  });
  return goal;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "proposal";
}

function createConsensusSnapshot(goalId, authorAgentId) {
  const requiredAgentIds = store.agents
    .filter((agent) => agent.goalId === goalId)
    .filter((agent) => agent.status === "online")
    .filter((agent) => agent.id !== authorAgentId)
    .map((agent) => agent.id)
    .sort();

  return {
    requiredAgentIds,
    acceptedAgentIds: [],
    revisionAgentIds: [],
    rejectedAgentIds: [],
    status: requiredAgentIds.length ? "pending" : "solo_accepted",
    requiredCount: requiredAgentIds.length,
    acceptedCount: 0
  };
}

function createConsensusReviewTasks(task, result) {
  for (const reviewerId of result.consensus.requiredAgentIds) {
    const reviewer = findAgent(reviewerId);
    const existing = store.tasks.some(
      (item) => item.reviewForResultId === result.id && item.assignedReviewerId === reviewerId
    );
    if (existing) continue;
    store.tasks.push({
      id: `task-review-${randomUUID()}`,
      goalId: task.goalId,
      type: "review",
      title: `Consensus review: ${task.title}`,
      description: `Review result ${result.id} from iteration ${result.iteration}. Accept only if it is strong enough for the project to move forward; request revision if another iteration is needed.`,
      requiredCapabilities: ["review"],
      priority: Math.max(50, (task.priority || 50) - 5),
      status: "open",
      reviewForResultId: result.id,
      assignedReviewerId: reviewerId,
      assignedReviewerName: reviewer?.name || "Project agent",
      createdAt: now()
    });
  }
}

function applyReviewDecision(result, review) {
  const task = store.tasks.find((item) => item.id === result.taskId);
  if (!result.consensus) result.consensus = createConsensusSnapshot(result.goalId, result.agentId);

  if (review.decision === "accepted" && review.score >= 0.65) {
    result.consensus.acceptedAgentIds = [...new Set([...(result.consensus.acceptedAgentIds || []), review.agentId])];
    result.consensus.acceptedCount = result.consensus.acceptedAgentIds.length;
    closeReviewTaskForReviewer(result.id, review.agentId, "done");
    const hasConsensus = result.consensus.requiredAgentIds.every((agentId) =>
      result.consensus.acceptedAgentIds.includes(agentId)
    );
    if (!hasConsensus) {
      result.status = "in_consensus";
      result.consensus.status = "pending";
      if (task) task.status = "in_consensus";
      event("consensus_progress", `Consensus progress for ${task?.title || result.summary || result.id}`, {
        resultId: result.id,
        accepted: result.consensus.acceptedCount,
        required: result.consensus.requiredAgentIds.length
      });
      return;
    }

    finalizeAcceptedResult(result, review);
    return;
  }

  if (review.decision === "rejected" && review.score <= 0.35) {
    result.status = "rejected";
    result.consensus.rejectedAgentIds = [...new Set([...(result.consensus.rejectedAgentIds || []), review.agentId])];
    result.consensus.status = "rejected";
    const author = findAgent(result.agentId);
    if (author) author.reputation.disputed += 1;
    closeReviewTasks(result.id);
    if (task) {
      task.status = "open";
      task.assignedAgentId = null;
      task.leaseUntil = null;
      task.leaseId = null;
      task.iteration = Number(task.iteration || result.iteration || 1) + 1;
      task.lastRevisionReason = review.reason || "A project agent rejected the result.";
      task.updatedAt = now();
    }
    event("consensus_rejected", `Result rejected; task returned to worker pool for another iteration`, {
      resultId: result.id,
      taskId: task?.id,
      reviewerAgentId: review.agentId
    });
    return;
  }

  result.status = "needs_revision";
  result.consensus.revisionAgentIds = [...new Set([...(result.consensus.revisionAgentIds || []), review.agentId])];
  result.consensus.status = "needs_revision";
  closeReviewTasks(result.id);
  if (task) {
    task.status = "open";
    task.assignedAgentId = null;
    task.leaseUntil = null;
    task.leaseId = null;
    task.iteration = Number(task.iteration || result.iteration || 1) + 1;
    task.lastRevisionReason = review.reason;
    task.updatedAt = now();
  }
  event("consensus_revision", `Revision requested for ${task?.title || result.summary || result.id}`, {
    resultId: result.id,
    taskId: task?.id,
    reviewerAgentId: review.agentId
  });
}

function finalizeAcceptedResult(result, review) {
  const task = store.tasks.find((item) => item.id === result.taskId);
  result.status = "accepted";
  result.consensus = result.consensus || createConsensusSnapshot(result.goalId, result.agentId);
  result.consensus.status = "accepted";
  result.consensus.acceptedCount = result.consensus.acceptedAgentIds?.length || 0;
  if (task) task.status = "done";
  const author = findAgent(result.agentId);
  if (author) author.reputation.accepted += 1;
  createClaimFromResult(result, review);
  publishResultPoolEntry(result, review);
  closeReviewTasks(result.id);
  if (task) completeGoalIfDone(task.goalId, result);
}

function reconcileConsensusAfterAgentDisconnect(agentId) {
  for (const result of store.results) {
    if (result.status !== "in_consensus" || !result.consensus?.requiredAgentIds?.includes(agentId)) continue;
    result.consensus.requiredAgentIds = result.consensus.requiredAgentIds.filter((id) => id !== agentId);
    result.consensus.requiredCount = result.consensus.requiredAgentIds.length;
    closeReviewTaskForReviewer(result.id, agentId, "done");
    const hasConsensus = result.consensus.requiredAgentIds.every((id) =>
      result.consensus.acceptedAgentIds?.includes(id)
    );
    if (hasConsensus) {
      event("consensus_adjusted", `Consensus completed after disconnected agent left review group`, {
        resultId: result.id,
        disconnectedAgentId: agentId
      });
      finalizeAcceptedResult(result, null);
    }
  }
}

function publishResultPoolEntry(result, review) {
  if (store.resultPool.some((entry) => entry.resultId === result.id)) return;
  const goal = store.goals.find((item) => item.id === result.goalId);
  const task = store.tasks.find((item) => item.id === result.taskId);
  if (task?.reviewForResultId) return;

  store.resultPool.unshift({
    id: `published-${randomUUID()}`,
    goalId: result.goalId,
    goalTitle: goal?.title || "Unknown project",
    taskId: result.taskId,
    taskTitle: task?.title || result.summary || "Completed task",
    resultId: result.id,
    agentId: result.agentId,
    reviewerAgentId: review?.agentId || null,
    consensus: result.consensus || null,
    summary: result.summary || result.content.slice(0, 240),
      content: result.content,
      artifacts: result.artifacts || [],
      sources: result.sources,
      confidence: review ? Number(((result.confidence + review.score) / 2).toFixed(2)) : result.confidence,
    status: "published",
    createdAt: now()
  });
  event("result_published", `Published result for ${task?.title || result.summary || result.id}`, {
    goalId: result.goalId,
    taskId: result.taskId,
    resultId: result.id
  });
}

function completeGoalIfDone(goalId, finalResult) {
  const goal = store.goals.find((item) => item.id === goalId);
  if (!goal || goal.status === "completed") return false;
  const workerTasks = store.tasks.filter((task) => task.goalId === goalId && !task.reviewForResultId);
  if (!workerTasks.length) return false;
  const hasActiveTasks = workerTasks.some((task) =>
    ["open", "leased", "needs_review", "needs_revision", "in_consensus"].includes(task.status)
  );
  if (hasActiveTasks) return false;

  goal.status = "completed";
  goal.completedAt = now();
  goal.finalResultId = finalResult.id;
  goal.supporters = store.agents.filter((agent) => agent.goalId === goalId).length;
  disconnectGoalAgents(goalId, "project_completed");
  event("goal_completed", `Completed project moved to Result Pool: ${goal.title}`, {
    goalId,
    resultId: finalResult.id
  });
  return true;
}

function buildResultPoolFromAccepted(goals, tasks, results, reviews) {
  const entries = [];
  for (const result of results) {
    if (result.status !== "accepted") continue;
    const task = tasks.find((item) => item.id === result.taskId);
    if (task?.reviewForResultId) continue;
    const goal = goals.find((item) => item.id === result.goalId);
    const review = reviews.find((item) => item.resultId === result.id && item.decision === "accepted");
    entries.push({
      id: `published-${result.id}`,
      goalId: result.goalId,
      goalTitle: goal?.title || "Unknown project",
      taskId: result.taskId,
      taskTitle: task?.title || result.summary || "Completed task",
      resultId: result.id,
      agentId: result.agentId,
      reviewerAgentId: review?.agentId || null,
      consensus: result.consensus || null,
      summary: result.summary || result.content.slice(0, 240),
      content: result.content,
      artifacts: result.artifacts || [],
      sources: result.sources || [],
      confidence: review ? Number(((result.confidence + review.score) / 2).toFixed(2)) : result.confidence,
      status: "published",
      createdAt: result.createdAt
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createClaimFromResult(result, review) {
  const duplicate = store.claims.some((claim) => claim.resultId === result.id);
  if (duplicate) return;
  const task = store.tasks.find((item) => item.id === result.taskId);
  store.claims.unshift({
    id: `claim-${randomUUID()}`,
    goalId: result.goalId,
    resultId: result.id,
    title: task?.title || result.summary || "Accepted result",
    statement: result.summary || result.content.slice(0, 240),
    sources: result.sources,
    confidence: review ? Number(((result.confidence + review.score) / 2).toFixed(2)) : result.confidence,
    proposedBy: result.agentId,
    verifiedBy: result.consensus?.acceptedAgentIds?.length ? result.consensus.acceptedAgentIds : review ? [review.agentId] : [],
    status: "accepted",
    createdAt: now()
  });
}

function closeReviewTasks(resultId) {
  for (const task of store.tasks) {
    if (task.reviewForResultId === resultId && ["open", "leased"].includes(task.status)) {
      task.status = "done";
      task.assignedAgentId = null;
      task.leaseUntil = null;
      task.leaseId = null;
      task.updatedAt = now();
    }
  }
}

function closeReviewTaskForReviewer(resultId, reviewerAgentId, status) {
  for (const task of store.tasks) {
    if (task.reviewForResultId === resultId && task.assignedReviewerId === reviewerAgentId) {
      task.status = status;
      task.assignedAgentId = null;
      task.leaseUntil = null;
      task.leaseId = null;
      task.updatedAt = now();
    }
  }
}

function normalizeList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  return cleaned.length ? [...new Set(cleaned)] : fallback;
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((artifact) => {
      if (!artifact || typeof artifact !== "object") return null;
      const name = String(artifact.name || artifact.filename || "").trim().slice(0, 180);
      const mimeType = String(artifact.mimeType || artifact.mime || "").trim().slice(0, 120);
      const uri = normalizeArtifactUri(artifact.uri || artifact.url || "");
      const description = String(artifact.description || artifact.summary || "").trim().slice(0, 1000);
      const kind = normalizeArtifactKind(artifact.kind || artifact.type || mimeType || name);
      if (!name && !uri && !description) return null;
      return {
        id: artifact.id ? String(artifact.id).slice(0, 100) : "",
        name: name || artifactNameForKind(kind),
        kind,
        mimeType,
        uri,
        size: Number.isFinite(Number(artifact.size)) ? Math.max(0, Number(artifact.size)) : null,
        description
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeResultArtifacts(value, task, agent, access) {
  return normalizeArtifacts(value).map((artifact) => {
    const uriArtifactId = localArtifactIdFromUri(artifact.uri);
    const declaredLocalId = String(artifact.id || "").startsWith("artifact-") ? artifact.id : "";
    const localId = uriArtifactId || declaredLocalId;
    if (!localId) return artifact;

    const uploaded = store.uploadedArtifacts.find((item) => item.id === localId);
    if (!uploaded) {
      const error = new Error("Unknown uploaded artifact reference");
      error.statusCode = 400;
      throw error;
    }
    if (!canAttachUploadedArtifact(uploaded, task, agent, access)) {
      const error = new Error("Uploaded artifact is not scoped to this result");
      error.statusCode = 403;
      throw error;
    }
    return resultArtifactFromUpload(uploaded);
  });
}

function localArtifactIdFromUri(uri) {
  const match = String(uri || "").match(/^\/api\/artifacts\/([^/]+)\/download$/);
  return match ? match[1] : "";
}

function canAttachUploadedArtifact(artifact, task, agent, access) {
  if (artifact.agentId && artifact.agentId !== agent.id) return false;
  if (artifact.goalId && artifact.goalId !== task.goalId) return false;
  if (artifact.taskId && artifact.taskId !== task.id) return false;

  if (access?.connector) {
    return artifact.agentId === agent.id && artifact.goalId === task.goalId && (!artifact.taskId || artifact.taskId === task.id);
  }

  const userId = access?.auth?.user?.id || access?.user?.id || null;
  if (userId && artifact.uploadedBy === userId) return true;
  return artifact.agentId === agent.id;
}

function resultArtifactFromUpload(artifact) {
  return {
    id: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    uri: artifact.uri,
    size: artifact.size,
    description: artifact.description || "",
    sha256: artifact.sha256 || null,
    signature: artifact.signature || null
  };
}

function normalizeArtifactUri(value) {
  const uri = String(value || "").trim().slice(0, 2000);
  if (!uri) return "";
  if (/^\/api\/artifacts\/[^/]+\/download$/.test(uri)) return uri;
  try {
    const parsed = new URL(uri);
    if (["https:", "http:"].includes(parsed.protocol)) return parsed.toString();
  } catch {
    return "";
  }
  return "";
}

function normalizeArtifactKind(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("image") || /\.(png|jpe?g|webp|gif|svg)$/i.test(text)) return "image";
  if (text.includes("pdf") || /\.pdf$/i.test(text)) return "pdf";
  if (text.includes("csv") || /\.csv$/i.test(text)) return "csv";
  if (text.includes("excel") || text.includes("spreadsheet") || /\.(xlsx?|ods)$/i.test(text)) return "spreadsheet";
  if (text.includes("zip") || text.includes("tar") || text.includes("bundle") || /\.(zip|tar|gz|tgz)$/i.test(text)) return "bundle";
  if (text.includes("code") || text.includes("javascript") || text.includes("python") || /\.(js|ts|py|go|rs|java|json|md)$/i.test(text)) {
    return "code";
  }
  if (text.includes("video") || /\.(mp4|webm|mov)$/i.test(text)) return "video";
  if (text.includes("audio") || /\.(mp3|wav|m4a|ogg)$/i.test(text)) return "audio";
  return "file";
}

function artifactNameForKind(kind) {
  return {
    image: "Image output",
    pdf: "PDF report",
    csv: "CSV dataset",
    spreadsheet: "Spreadsheet",
    bundle: "Artifact bundle",
    code: "Code artifact",
    video: "Video output",
    audio: "Audio output",
    file: "File artifact"
  }[kind] || "Artifact";
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return ["openai", "anthropic", "gemini"].includes(provider) ? provider : "unknown";
}

function normalizeProviders(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeProvider).filter((provider) => provider !== "unknown"))].slice(0, 8);
}

function updateAgentProviderMetadata(agent, body) {
  if (body.provider) agent.provider = normalizeProvider(body.provider);
  if (body.providers) agent.providers = normalizeProviders(body.providers);
  if (body.models) agent.models = normalizeList(body.models, agent.models || ["unknown"]);
}

function ensureConsensusCapability(capabilities) {
  return capabilities.includes("review") ? capabilities : [...capabilities, "review"];
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function runDemoCycle() {
  const goal = store.goals[0];
  let researchAgent = store.agents.find((agent) => agent.name === "Demo Research Agent");
  let reviewAgent = store.agents.find((agent) => agent.name === "Demo Review Agent");

  if (!researchAgent) {
    researchAgent = createDemoAgent("Demo Research Agent", goal.id, ["research", "synthesis"], ["gpt-demo"]);
  }
  if (!reviewAgent) {
    reviewAgent = createDemoAgent("Demo Review Agent", goal.id, ["review", "research"], ["claude-demo"]);
  }

  const openTask = store.tasks
    .filter((task) => task.goalId === goal.id && task.status === "open" && agentCanRun(researchAgent, task))
    .sort(taskSort)[0];

  if (!openTask) {
    event("demo", "No open demo task found");
    return;
  }

  openTask.status = "in_consensus";
  openTask.assignedAgentId = researchAgent.id;
  openTask.updatedAt = now();
  const result = {
    id: `result-${randomUUID()}`,
    taskId: openTask.id,
    goalId: goal.id,
    agentId: researchAgent.id,
    summary: `Initial verified direction for ${openTask.title}`,
    content:
      "The strongest path is a local-first task lifecycle with user-owned connectors, small leased tasks, independent review, signed contributions, and accepted claims written into a shared knowledge base.",
    sources: ["docs/ARCHITECTURE.md"],
    confidence: 0.78,
    status: "in_consensus",
    iteration: Number(openTask.iteration || 1),
    consensus: {
      requiredAgentIds: [reviewAgent.id],
      acceptedAgentIds: [],
      revisionAgentIds: [],
      rejectedAgentIds: [],
      status: "pending",
      requiredCount: 1,
      acceptedCount: 0
    },
    createdAt: now()
  };
  result.signature = recordSignedContribution("task_result", {
    resultId: result.id,
    taskId: result.taskId,
    goalId: result.goalId,
    agentId: result.agentId,
    summaryHash: hashToken(result.summary),
    contentHash: hashToken(result.content),
    artifactIds: []
  }, {
    objectType: "result",
    objectId: result.id
  });
  store.results.push(result);
  createConsensusReviewTasks(openTask, result);
  const review = {
    id: `review-${randomUUID()}`,
    resultId: result.id,
    goalId: goal.id,
    taskId: openTask.id,
    agentId: reviewAgent.id,
    decision: "accepted",
    score: 0.84,
    reason: "The result is bounded, implementable, and aligned with the local-first node constraints.",
    createdAt: now()
  };
  review.signature = recordSignedContribution("result_review", {
    reviewId: review.id,
    resultId: review.resultId,
    taskId: review.taskId,
    agentId: review.agentId,
    decision: review.decision,
    score: review.score,
    reasonHash: hashToken(review.reason)
  }, {
    objectType: "review",
    objectId: review.id
  });
  store.reviews.push(review);
  applyReviewDecision(result, review);
  event("demo", `Completed demo cycle for ${openTask.title}`, {
    taskId: openTask.id,
    resultId: result.id
  });
}

function createDemoAgent(name, goalId, capabilities, models) {
  const agent = {
    id: `agent-${randomUUID()}`,
    name,
    goalId,
    capabilities,
    models,
    maxConcurrentTasks: 1,
    reputation: {
      research: 0,
      review: 0,
      synthesis: 0,
      accepted: 0,
      disputed: 0
    },
    status: "online",
    lastSeen: now(),
    createdAt: now()
  };
  store.agents.push(agent);
  const goal = store.goals.find((item) => item.id === goalId);
  if (goal) goal.supporters += 1;
  return agent;
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = requested.replaceAll("..", "");
  const filePath = join(publicDir, safePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return notFound(res);
    const type = contentTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, ...securityHeaders() });
    createReadStream(filePath).pipe(res);
  } catch {
    notFound(res);
  }
}

async function serveAgentGuiStatic(req, res, url) {
  const relative = url.pathname === "/agent-gui" || url.pathname === "/agent-gui/"
    ? "/index.html"
    : url.pathname.replace(/^\/agent-gui/, "") || "/index.html";
  const safePath = relative.replaceAll("..", "");
  const filePath = join(agentGuiDistDir, safePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return serveAgentGuiIndex(res);
    const type = contentTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, ...securityHeaders({ allowInlineStyles: true, allowWebSockets: true }) });
    createReadStream(filePath).pipe(res);
  } catch {
    return serveAgentGuiIndex(res);
  }
}

async function serveAgentGuiIndex(res) {
  const filePath = join(agentGuiDistDir, "index.html");
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return notFound(res);
    res.writeHead(200, { "content-type": contentTypes[".html"], ...securityHeaders({ allowInlineStyles: true, allowWebSockets: true }) });
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 503, {
      error: "agent_gui_not_built",
      message: "Run npm run build:agent-gui before opening /agent-gui/."
    });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  if (url.pathname === "/" && !url.search) {
    return redirect(res, "/agent-gui/");
  }
  if (url.pathname === "/agent-gui" || url.pathname.startsWith("/agent-gui/")) {
    return serveAgentGuiStatic(req, res, url);
  }
  if (url.pathname === "/full-logo.png") {
    const assetUrl = new URL("/agent-gui/full-logo.png", `http://${req.headers.host || "127.0.0.1"}`);
    return serveAgentGuiStatic(req, res, assetUrl);
  }
  return serveStatic(req, res, url);
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (!url.pathname.startsWith("/ws/")) {
    socket.destroy();
    return;
  }
  serveAgentGuiWebSocket(req, socket, url);
});

server.listen(port, host, () => {
  console.log(`OpenSwarmAgents node listening on http://${host}:${port}`);
  startFederationPeerSync();
});

function serveAgentGuiWebSocket(req, socket, url) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));

  const match = url.pathname.match(/^\/ws\/(activity|terminal|console|tail)\/([^/]+)$/);
  if (!match) {
    writeWebSocketClose(socket);
    return;
  }
  const kind = match[1];
  const sessionId = decodeURIComponent(match[2]);
  let timer = null;

  const send = (payload) => {
    try {
      writeWebSocketText(socket, typeof payload === "string" ? payload : JSON.stringify(payload));
    } catch {
      clearInterval(timer);
      socket.destroy();
    }
  };

  if (kind === "activity") {
    send(agentGuiActivity(sessionId));
    send({ subagents: agentGuiSubagents(sessionId) });
    const live = agentGuiLiveEvent(sessionId);
    if (live) send({ live });
    timer = setInterval(() => {
      send(agentGuiActivity(sessionId));
      const nextLive = agentGuiLiveEvent(sessionId);
      if (nextLive) send({ live: nextLive });
    }, 5000);
  } else if (kind === "terminal" || kind === "console") {
    send(agentGuiConsoleText(sessionId, kind));
  } else if (kind === "tail") {
    send("");
  }

  socket.on("close", () => clearInterval(timer));
  socket.on("error", () => clearInterval(timer));
  socket.on("data", (chunk) => {
    if ((chunk[0] & 0x0f) === 0x8) {
      clearInterval(timer);
      socket.end();
    }
  });
}

function agentGuiLiveEvent(sessionId) {
  const session = agentGuiSessionById(sessionId);
  if (!session) return null;
  if (session.is_running) {
    return {
      type: "status",
      event: "working",
      msg: session.team_id === agentGuiHomeTeamId ? "Your agent is working in Home" : "Network agent is working in Public"
    };
  }
  return { type: "status", event: "idle", msg: session.title_summary || "Waiting for network activity" };
}

function writeWebSocketText(socket, text) {
  const payload = Buffer.from(String(text), "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    const high = Math.floor(payload.length / 2 ** 32);
    const low = payload.length >>> 0;
    header.writeUInt32BE(high, 2);
    header.writeUInt32BE(low, 6);
  }
  socket.write(Buffer.concat([header, payload]));
}

function writeWebSocketClose(socket) {
  try {
    socket.write(Buffer.from([0x88, 0x00]));
  } finally {
    socket.end();
  }
}

function stopManagedConnectorsForShutdown() {
  for (const connectorId of managedConnectorProcesses.keys()) {
    stopManagedConnector(connectorId);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopManagedConnectorsForShutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref?.();
  });
}
