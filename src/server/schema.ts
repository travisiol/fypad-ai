/**
 * SQL migrations, applied in order and recorded in `schema_migrations`. One schema for Postgres
 * (DATABASE_URL: Neon / Vercel Postgres) and PGlite (local and tests). Never edit an applied
 * migration: append a new one.
 *
 * Conventions: timestamps are epoch milliseconds (BIGINT), SOL amounts are lamports (BIGINT),
 * USD figures read from markets are DOUBLE PRECISION. Invariants enforced by the schema:
 *  - a live handle is unique (partial UNIQUE), a like / save / follow exists once per wallet;
 *  - an influencer has at most one active launch, and a mint is used once;
 *  - a fee distribution is keyed on its signature + mint (ingestion is idempotent);
 *  - every budget entry and notification carries a UNIQUE idempotency key;
 *  - a job's idempotency key is unique per owner (a double click creates one job).
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created_at BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  storage TEXT NOT NULL CHECK (storage IN ('blob','local')),
  location TEXT NOT NULL,
  character_id TEXT,
  job_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS influencers (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','live','discarded')),
  handle TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  idea TEXT NOT NULL,
  niches TEXT NOT NULL DEFAULT '[]',
  vibe TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  themes TEXT NOT NULL DEFAULT '[]',
  look TEXT NOT NULL DEFAULT '',
  portrait_media_id TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  next_idea TEXT NOT NULL DEFAULT '',
  last_auto_post_at BIGINT,
  last_free_post_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS influencers_live_handle ON influencers(handle) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS influencers_owner ON influencers(owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS influencers_live ON influencers(status, published_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  influencer_id TEXT NOT NULL REFERENCES influencers(id),
  status TEXT NOT NULL CHECK (status IN ('draft','live','deleted')),
  kind TEXT NOT NULL CHECK (kind IN ('intro','auto','manual')),
  slot INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',
  scene TEXT NOT NULL DEFAULT '',
  image_media_id TEXT,
  mcap_at DOUBLE PRECISION,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  published_at BIGINT
);
CREATE INDEX IF NOT EXISTS posts_feed ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_influencer ON posts(influencer_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL REFERENCES posts(id), wallet TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (post_id, wallet));
CREATE TABLE IF NOT EXISTS saves (post_id TEXT NOT NULL REFERENCES posts(id), wallet TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (post_id, wallet));
CREATE INDEX IF NOT EXISTS saves_wallet ON saves(wallet, created_at DESC);
CREATE TABLE IF NOT EXISTS follows (influencer_id TEXT NOT NULL REFERENCES influencers(id), wallet TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (influencer_id, wallet));
CREATE INDEX IF NOT EXISTS follows_wallet ON follows(wallet);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  parent_id TEXT,
  wallet TEXT,
  influencer_id TEXT,
  body TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CHECK ((wallet IS NULL) <> (influencer_id IS NULL))
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS comments_one_reply ON comments(parent_id) WHERE influencer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('follow','comment','like','distribution','milestone','reply','post')),
  influencer_id TEXT,
  post_id TEXT,
  actor TEXT,
  lamports BIGINT,
  text TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  influencer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create','portrait','posts','post')),
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  idempotency_key TEXT NOT NULL,
  lease_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT,
  UNIQUE (owner, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS jobs_influencer ON jobs(influencer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  influencer_id TEXT NOT NULL REFERENCES influencers(id),
  owner TEXT NOT NULL,
  mint TEXT NOT NULL UNIQUE,
  cluster TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','submitted','confirmed','failed','rejected','expired')),
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '{}',
  uri TEXT NOT NULL,
  initial_buy_lamports BIGINT NOT NULL DEFAULT 0,
  last_valid_block_height BIGINT,
  create_sig TEXT,
  sharing_status TEXT NOT NULL DEFAULT 'none' CHECK (sharing_status IN ('none','prepared','submitted','active','failed','declined')),
  sharing_sig TEXT,
  sharing_last_valid_block_height BIGINT,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  confirmed_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS launches_one_active ON launches(influencer_id) WHERE status IN ('prepared','submitted','confirmed');

CREATE TABLE IF NOT EXISTS distributions (
  signature TEXT NOT NULL,
  mint TEXT NOT NULL,
  influencer_id TEXT NOT NULL,
  total_lamports BIGINT NOT NULL,
  creator_lamports BIGINT NOT NULL,
  treasury_lamports BIGINT NOT NULL,
  slot BIGINT,
  block_time BIGINT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (signature, mint)
);
CREATE INDEX IF NOT EXISTS distributions_influencer ON distributions(influencer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS budget_entries (
  id BIGSERIAL PRIMARY KEY,
  influencer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','spend','buyback')),
  lamports BIGINT NOT NULL CHECK (lamports > 0),
  ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS budget_influencer ON budget_entries(influencer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coin_stats (
  mint TEXT PRIMARY KEY,
  mcap_usd DOUBLE PRECISION,
  price_usd DOUBLE PRECISION,
  change_24h DOUBLE PRECISION,
  volume_24h_usd DOUBLE PRECISION,
  holders INTEGER,
  curve_progress DOUBLE PRECISION,
  graduated INTEGER,
  buys_24h INTEGER,
  sells_24h INTEGER,
  source TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  mint TEXT NOT NULL,
  at BIGINT NOT NULL,
  mcap_usd DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (mint, at)
);

CREATE TABLE IF NOT EXISTS milestones (
  mint TEXT NOT NULL,
  level BIGINT NOT NULL,
  reached_at BIGINT NOT NULL,
  announced INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mint, level)
);
`,
  },
];
