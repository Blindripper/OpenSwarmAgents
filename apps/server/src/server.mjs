import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHash,
  generateKeyPairSync,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  sign as signPayload,
  timingSafeEqual
} from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../../..");
const publicDir = join(rootDir, "apps/web/public");
const dataDir = process.env.OSA_DATA_DIR || join(rootDir, "data");
const uploadDir = process.env.OSA_UPLOAD_DIR || join(dataDir, "uploads");
const identityPath = process.env.OSA_IDENTITY_PATH || join(dataDir, "node-identity.json");
const seedPath = join(rootDir, "data/seed.json");
const storePath = join(dataDir, "agentswarm.json");
const port = Number(process.env.PORT || 8788);
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
const federationSyncMs = Math.max(1000, Number(process.env.OSA_FEDERATION_SYNC_MS || 5000));
const federationCollectionLimit = Math.max(100, Math.min(5000, Number(process.env.OSA_FEDERATION_COLLECTION_LIMIT || 2000)));
const federationSnapshotMaxBytes = Math.max(maxJsonBytes, Number(process.env.OSA_FEDERATION_SNAPSHOT_MAX_BYTES || maxJsonBytes * 4));
const federationPeerSyncs = new Set();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
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
    if (!loaded.proposals.length) {
      const seed = JSON.parse(await readFile(seedPath, "utf8"));
      loaded.proposals = seed.proposals || [];
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
  const tasks = input.tasks || [];
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
    connectorTokens: input.connectorTokens || [],
    uploadedArtifacts: input.uploadedArtifacts || [],
    trustLedger: normalizeTrustLedger(input.trustLedger || []),
    resultPool: input.resultPool || buildResultPoolFromAccepted(goals, tasks, results, reviews),
    proposals: (input.proposals || []).map(normalizeProposal),
    proposalVotes: input.proposalVotes || [],
    oauthStates: input.oauthStates || [],
    events: input.events || []
  };
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
  const previousHash = store.trustLedger[0]?.eventHash || null;
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
    if (!loaded.proposals.length) {
      const seed = JSON.parse(await readFile(seedPath, "utf8"));
      loaded.proposals = seed.proposals || [];
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

function securityHeaders() {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
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
    connector.status = "expired";
    connector.expiredAt = now();
    return null;
  }
  const user = store.users.find((item) => item.id === connector.userId);
  if (!user) return null;
  connector.lastUsedAt = now();
  user.lastSeen = now();
  return { token: connector, user };
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
      trustHead: store.trustLedger?.[0]?.eventHash || null
    },
    viewer: publicUser(auth?.user),
    viewerConnectors: auth ? publicConnectorTokensForUser(auth.user.id) : [],
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
    runtime: publicRuntime(),
    serverTime: now()
  };
}

function publicTrustLedger(limit = 50) {
  return (store.trustLedger || []).slice(0, limit).map(publicTrustLedgerEntry);
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
    head: store.trustLedger?.[0]?.eventHash || null,
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
  const collections = snapshot.collections;
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
    expiresAt: token.expiresAt || null,
    revokedAt: token.revokedAt || null
  };
}

function publicRuntime() {
  return {
    storageMode,
    nodeEnv: process.env.NODE_ENV || "development",
    authMode,
    devLoginEnabled: isDevLoginEnabled(),
    localPasswordRequired: localPasswordRequired(),
    demoEndpointsEnabled: areDemoEndpointsEnabled(),
    publicTrustLedgerEnabled,
    rateLimitsEnabled: rateLimitMultiplier > 0,
    maxArtifactUploadBytes,
    federationEnabled,
    federationPeerCount: federationPeers.length,
    node: publicNodeIdentity(),
    oauthConfigured: Object.fromEntries(
      Object.keys(oauthProviderConfig).map((provider) => [provider, Boolean(providerCredentials(provider))])
    ),
    productionReady: runtimeReadiness().ok
  };
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

function isDevLoginEnabled() {
  if (authMode === "oauth") return false;
  if (authMode === "local" || authMode === "hybrid") return true;
  return process.env.NODE_ENV !== "production";
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
  return redirect(res, authorizeUrl.toString());
}

async function completeOAuth(req, res, provider, url) {
  const code = String(url.searchParams.get("code") || "");
  const stateId = String(url.searchParams.get("state") || "");
  const stateEntry = store.oauthStates.find((item) => item.id === stateId && item.provider === provider);
  store.oauthStates = store.oauthStates.filter((item) => item.id !== stateId);
  const credentials = providerCredentials(provider);
  if (!code || !stateEntry || !credentials) {
    await saveStore();
    return redirect(res, `/?oauth=${provider}&error=invalid_callback#account`);
  }

  try {
    const callbackUrl = `${originFromReq(req)}/api/auth/oauth/${provider}/callback`;
    const token = await exchangeOAuthCode(provider, credentials, code, callbackUrl);
    const profile = await fetchOAuthProfile(provider, token);
    const user = upsertUser(profile.email, profile.name);
    const session = createSession(user);
    event("user_signed_in", `${user.name} signed in with ${credentials.config.label}`, { userId: user.id, provider });
    await saveStore();
    return redirect(res, stateEntry.redirectAfter || "/", { "set-cookie": sessionCookie(session.token) });
  } catch (error) {
    event("oauth_error", `${credentials.config.label} OAuth failed: ${error.message}`, { provider });
    await saveStore();
    return redirect(res, `/?oauth=${provider}&error=provider_failed#account`);
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
      activeToken.status = "revoked";
      activeToken.revokedAt = now();
    }
  }

  if (mode === "voting") {
    for (const token of store.connectorTokens) {
      if (token.userId === auth.user.id && token.mode === "voting" && token.status === "active") {
        token.status = "revoked";
        token.revokedAt = now();
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
    expiresAt: body.expiresAt || afterMs(now(), 30 * 24 * 60 * 60 * 1000)
  };
  store.connectorTokens.push(connector);
  event("connector_token_created", `${auth.user.name} created a ${mode} connector token`, {
    connectorId: connector.id,
    mode,
    goalId
  });
  return { rawToken, connector };
}

function revokeConnectorToken(connector, reason = "user_disconnect") {
  connector.status = "revoked";
  connector.revokedAt = now();
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

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const path = url.pathname;

  try {
    const maintenanceChanged = runMaintenance();

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
        head: store.trustLedger?.[0]?.eventHash || null,
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
        head: store.trustLedger?.[0]?.eventHash || null
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
        createdBy: proposal.createdBy
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

      const result = {
        id: `result-${randomUUID()}`,
        taskId: task.id,
        goalId: task.goalId,
        agentId: agent.id,
        summary: String(body.summary || "").slice(0, 240),
        content: String(body.content || "").slice(0, 10000),
        artifacts: normalizeArtifacts(body.artifacts),
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
  return {
    ...proposal,
    createdAt,
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
        id: String(artifact.id || `artifact-${randomUUID()}`).slice(0, 100),
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url);
});

server.listen(port, host, () => {
  console.log(`OpenSwarmAgents node listening on http://${host}:${port}`);
  startFederationPeerSync();
});
