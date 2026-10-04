// Generated from the canonical schema definition. Keep in sync with DATA_MODEL.md.
export const SCHEMA_VERSION = 1;
export const SCHEMA_SQL = `
-- Selequo schema (PostgreSQL 15+ / PGlite). schemaVersion is tracked in schema_meta.
-- Every tenant-owned row carries workspace_id; all service queries filter by it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,               -- sha256(token)
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  ai_enabled boolean NOT NULL DEFAULT true,
  sharing_enabled boolean NOT NULL DEFAULT false,
  external_search_enabled boolean NOT NULL DEFAULT false,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','editor','reviewer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{read}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text,
  purpose text,
  deadline date,
  status text NOT NULL DEFAULT 'active',
  currency text NOT NULL DEFAULT 'JPY',
  locale text NOT NULL DEFAULT 'ja-JP',
  ai_enabled boolean NOT NULL DEFAULT true,
  fact_policy text NOT NULL DEFAULT 'confirmed_only',
  default_params jsonb NOT NULL DEFAULT '{}',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_ws ON projects(workspace_id);

CREATE TABLE IF NOT EXISTS candidates (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text,
  url text,
  status text NOT NULL DEFAULT 'considering' CHECK (status IN ('considering','shortlisted','rejected','chosen')),
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidates_project ON candidates(workspace_id, project_id);

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id text REFERENCES candidates(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('web','pdf','screenshot','image','manual','csv','text')),
  url text,
  file_key text,
  file_name text,
  mime text,
  size_bytes int,
  title text,
  publisher text,
  quality text NOT NULL DEFAULT 'unknown',
  captured_at timestamptz,
  published_at timestamptz,
  retrieved_at timestamptz,
  hash text,
  status text NOT NULL DEFAULT 'pending',
  ai_enabled boolean NOT NULL DEFAULT true,
  extracted_text text,
  pages jsonb,
  error text,
  injection_flags jsonb NOT NULL DEFAULT '[]',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS sources_project ON sources(workspace_id, project_id);

CREATE TABLE IF NOT EXISTS attributes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  display_name text NOT NULL,
  type text NOT NULL DEFAULT 'text',
  unit text,
  category text NOT NULL DEFAULT 'general',
  aliases text[] NOT NULL DEFAULT '{}',
  group_name text,
  sort_order int NOT NULL DEFAULT 0,
  origin text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS normalization_rules (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'alias',
  pattern text NOT NULL,
  attribute_key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  attribute_key text,
  raw_label text NOT NULL,
  raw_value text NOT NULL,
  normalized_value jsonb,
  unit text,
  issue text,
  kind text NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact','opinion')),
  source_range jsonb NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  review_state text NOT NULL DEFAULT 'candidate' CHECK (review_state IN ('candidate','confirmed','rejected','superseded')),
  extracted_by text NOT NULL,
  created_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  superseded_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facts_project ON facts(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS facts_cand_attr ON facts(candidate_id, attribute_key);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source_id text REFERENCES sources(id) ON DELETE CASCADE,
  fact_id text REFERENCES facts(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text NOT NULL,
  tax text NOT NULL DEFAULT 'unknown',
  shipping numeric,
  billing_period text NOT NULL DEFAULT 'one_time',
  contract_months int,
  per_seat boolean NOT NULL DEFAULT false,
  seats int,
  captured_at timestamptz NOT NULL,
  fx_rate numeric,
  fx_base text,
  fx_source text,
  fx_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criteria (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  weight numeric NOT NULL DEFAULT 1,
  direction text NOT NULL DEFAULT 'higher_better',
  must_have boolean NOT NULL DEFAULT false,
  target jsonb,
  linked_attributes text[] NOT NULL DEFAULT '{}',
  origin text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  weights jsonb NOT NULL DEFAULT '{}',
  must_haves jsonb NOT NULL DEFAULT '{}',
  params jsonb NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id text REFERENCES candidates(id) ON DELETE SET NULL,
  attribute_key text,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  answer text,
  answer_source_id text REFERENCES sources(id) ON DELETE SET NULL,
  answer_fact_id text REFERENCES facts(id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);

CREATE TABLE IF NOT EXISTS decisions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chosen_candidate_id text REFERENCES candidates(id) ON DELETE SET NULL,
  scenario_id text REFERENCES scenarios(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  assumptions text,
  expected_outcome text,
  review_date date,
  actual_result text,
  lessons text,
  status text NOT NULL DEFAULT 'draft',
  decided_by text,
  decided_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS briefs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version int NOT NULL,
  content jsonb NOT NULL,
  review_state text NOT NULL DEFAULT 'draft',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  body text NOT NULL,
  author_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_notes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id text REFERENCES candidates(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_index (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS search_ws ON search_index(workspace_id);
CREATE INDEX IF NOT EXISTS search_trgm ON search_index USING gin ((title || ' ' || body) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS embeddings (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model text NOT NULL,
  vector jsonb NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  project_id text,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_ws ON audit_log(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS ai_calls (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  project_id text,
  provider text NOT NULL,
  purpose text NOT NULL,
  input_chars int NOT NULL DEFAULT 0,
  output_chars int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
