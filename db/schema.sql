-- OpenSwarmAgents production target schema.
-- The current server can already persist the full node state in Postgres via
-- osa_app_state. The normalized tables below are the release-grade model we
-- migrate toward as the scheduler, artifacts, and reputation systems harden.

create table if not exists osa_app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists user_oauth_identities (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null check (provider in ('github', 'google')),
  provider_subject text not null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists oauth_states (
  id text primary key,
  provider text not null check (provider in ('github', 'google')),
  redirect_after text not null default '/',
  created_at timestamptz not null default now()
);

create table if not exists goals (
  id text primary key,
  title text not null,
  description text not null,
  status text not null check (status in ('active', 'completed', 'archived')),
  supporters integer not null default 0,
  source_proposal_id text,
  final_result_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists proposals (
  id text primary key,
  title text not null,
  description text not null,
  created_by text references users(id) on delete set null,
  created_by_name text,
  status text not null check (status in ('voting', 'promoted', 'archived')),
  votes integer not null default 0,
  score numeric not null default 0,
  voting_ends_at timestamptz not null,
  promoted_at timestamptz,
  promotion_mode text,
  created_at timestamptz not null default now()
);

create table if not exists agents (
  id text primary key,
  user_id text references users(id) on delete set null,
  connector_token_id text,
  name text not null,
  goal_id text not null,
  capabilities jsonb not null default '[]'::jsonb,
  models jsonb not null default '[]'::jsonb,
  provider text not null default 'unknown',
  providers jsonb not null default '[]'::jsonb,
  max_concurrent_tasks integer not null default 1,
  reputation jsonb not null default '{}'::jsonb,
  status text not null check (status in ('online', 'offline')),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists connector_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  mode text not null check (mode in ('worker', 'voting')),
  goal_id text not null,
  agent_id text references agents(id) on delete set null,
  name text not null,
  token_hash text not null unique,
  capabilities jsonb not null default '[]'::jsonb,
  models jsonb not null default '[]'::jsonb,
  provider text not null default 'unknown',
  providers jsonb not null default '[]'::jsonb,
  status text not null check (status in ('active', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz
);

alter table agents
  drop constraint if exists agents_connector_token_id_fkey;

alter table agents
  add constraint agents_connector_token_id_fkey
  foreign key (connector_token_id) references connector_tokens(id) on delete set null;

create table if not exists proposal_votes (
  id text primary key,
  proposal_id text not null references proposals(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  score numeric not null default 0,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (agent_id)
);

create table if not exists tasks (
  id text primary key,
  goal_id text not null references goals(id) on delete cascade,
  type text not null check (type in ('research', 'review', 'synthesis')),
  title text not null,
  description text not null,
  required_capabilities jsonb not null default '[]'::jsonb,
  priority integer not null default 50,
  status text not null check (status in ('open', 'leased', 'in_consensus', 'needs_revision', 'done', 'rejected')),
  assigned_agent_id text references agents(id) on delete set null,
  assigned_reviewer_id text references agents(id) on delete set null,
  assigned_reviewer_name text,
  review_for_result_id text,
  lease_id text,
  lease_until timestamptz,
  iteration integer not null default 1,
  last_revision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists results (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  goal_id text not null references goals(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  summary text not null default '',
  content text not null default '',
  artifacts jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0.5,
  status text not null check (status in ('in_consensus', 'accepted', 'needs_revision', 'rejected')),
  iteration integer not null default 1,
  consensus jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id text primary key,
  result_id text not null references results(id) on delete cascade,
  goal_id text not null references goals(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  decision text not null check (decision in ('accepted', 'rejected', 'needs_revision')),
  score numeric not null default 0.5,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (result_id, agent_id)
);

create table if not exists claims (
  id text primary key,
  goal_id text not null references goals(id) on delete cascade,
  result_id text not null references results(id) on delete cascade,
  title text not null,
  statement text not null,
  sources jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0.5,
  proposed_by text references agents(id) on delete set null,
  verified_by jsonb not null default '[]'::jsonb,
  status text not null check (status in ('accepted', 'disputed', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists result_pool_entries (
  id text primary key,
  goal_id text not null references goals(id) on delete cascade,
  goal_title text not null,
  task_id text not null references tasks(id) on delete cascade,
  task_title text not null,
  result_id text not null references results(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  reviewer_agent_id text references agents(id) on delete set null,
  consensus jsonb,
  summary text not null,
  content text not null,
  artifacts jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0.5,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  unique (result_id)
);

create table if not exists events (
  id text primary key,
  type text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_goals_status on goals(status);
create index if not exists idx_proposals_status_voting_ends on proposals(status, voting_ends_at);
create index if not exists idx_agents_user_status on agents(user_id, status);
create index if not exists idx_agents_goal_status on agents(goal_id, status);
create index if not exists idx_connector_tokens_user_status on connector_tokens(user_id, status);
create index if not exists idx_connector_tokens_hash on connector_tokens(token_hash);
create index if not exists idx_tasks_goal_status_priority on tasks(goal_id, status, priority desc);
create index if not exists idx_tasks_review_result on tasks(review_for_result_id);
create index if not exists idx_results_goal_status on results(goal_id, status);
create index if not exists idx_reviews_result on reviews(result_id);
create index if not exists idx_result_pool_created on result_pool_entries(created_at desc);
create index if not exists idx_events_created on events(created_at desc);
