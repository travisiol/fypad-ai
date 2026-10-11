/**
 * FYPAD product configuration: the fee split, posting cadence, costs, limits and the env names the
 * server reads. Imported by server modules, pages and node tests (relative imports only).
 *
 * Every number a visitor sees on /docs comes from here.
 */

// ───────────────────────────── fee split (pump.fun native creator fee sharing)

/**
 * Basis points of every coin's creator fees, registered on chain by the creator's second signature
 * (update_fee_shares_v2). Sum = 10 000. pump.fun pays each share directly at distribute time.
 */
export const FEE_SPLIT_BPS = { creator: 8000, treasury: 2000 } as const;

/** Splits an amount by FEE_SPLIT_BPS; rounding dust goes to the creator. */
export function splitFees(lamports: bigint): { creator: bigint; treasury: bigint } {
  const treasury = (lamports * BigInt(FEE_SPLIT_BPS.treasury)) / BigInt(10_000);
  return { creator: lamports - treasury, treasury };
}

// ───────────────────────────── posting cadence

const envInt = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
};
const envBig = (name: string, fallback: bigint) => {
  const raw = process.env[name]?.trim();
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : fallback;
};

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const CADENCE = {
  /** Free baseline: one auto-post per day during an influencer's first days. */
  baselineDays: 14,
  baselineIntervalMs: DAY_MS,
  /** After the baseline period, without budget: one post every three days. */
  idleIntervalMs: 3 * DAY_MS,
  /** With budget: up to three posts per day. */
  fundedPerDay: 3,
  fundedIntervalMs: 8 * HOUR_MS,
  /** Owner's "Post now": three per day. */
  manualPerDay: 3,
  /** Replies: up to three new top comments answered per influencer per tick. */
  repliesPerTick: 3,
} as const;

/** What one AI post (caption + image) costs the influencer's budget, in lamports. Default 0.003 SOL. */
export function costPerPostLamports(): bigint {
  const v = envBig("FYPAD_COST_PER_POST_LAMPORTS", BigInt(3_000_000));
  return v > BigInt(0) ? v : BigInt(3_000_000);
}

/**
 * An influencer's budget holds at most this many posts; treasury income above it is set aside for
 * the $FYPAD buyback (held until the mint exists).
 */
export function budgetCapPosts(): number {
  return Math.max(1, envInt("FYPAD_BUDGET_CAP_POSTS", 90));
}

/** Coin milestones (USD market cap) the influencer celebrates and the owner is notified of. */
export const MILESTONES_USD = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

// ───────────────────────────── tick (serverless: after() on visits + cron, never a loop)

export const TICK = {
  /** A page visit kicks a tick in after() when the last one is older than this. */
  everyMs: 5 * 60_000,
  /** Lease of one tick (a second caller skips while it runs). */
  leaseMs: 4 * 60_000,
  /** Job steps advanced per tick. */
  jobSteps: 3,
  /** New auto-posts queued per tick. */
  schedulePerTick: 6,
  /** Influencers whose comments are answered per tick. */
  replyInfluencers: 3,
} as const;

export const JOB_LEASE_MS = 4 * 60_000;
export const MAX_JOB_ATTEMPTS = 3;
/** Generations per wallet per hour (describe → generate, regenerate). */
export const GENERATIONS_PER_HOUR = 8;

// ───────────────────────────── creation

export const NICHES = ["Fashion", "Fitness", "Travel", "Gaming", "Crypto", "Food", "Music", "Art", "Comedy", "Tech"] as const;
export type Niche = (typeof NICHES)[number];

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._]{1,22})[a-z0-9]$/;
/** Paths that can never be a handle (top-level routes). */
export const RESERVED_HANDLES = new Set(["api", "p", "me", "explore", "rising", "create", "earnings", "notifications", "docs", "ledger", "search", "settings", "admin", "fypad", "about", "help", "login", "_next", "static", "favicon.ico", "icon.svg", "robots.txt", "sitemap.xml"]);

export const INTRO_POSTS = 3;
export const BIO_MAX = 150;
export const CAPTION_MAX = 600;
export const COMMENT_MAX = 300;

/** Token limits from pump.fun's create_v2 docs (name ≤ 32, symbol ≤ 13, uri ≤ 200). */
export const TOKEN_LIMITS = { name: 32, symbol: 13, uri: 200, description: 500 } as const;
/** Our ticker rule inside pump.fun's limit: 2–10 letters/digits, stored uppercase. */
export const TICKER_RE = /^[A-Z0-9]{2,10}$/;
/** Optional first buy, capped so a typo cannot drain a wallet. */
export const MAX_INITIAL_BUY_LAMPORTS = BigInt(5_000_000_000);

export function tickerFromHandle(handle: string): string {
  const t = handle.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return t.length >= 2 ? t : `${t}AI`.slice(0, 10);
}

// ───────────────────────────── env

export const ENV = {
  openaiKey: () => process.env["OPENAI_API_KEY"]?.trim() || null,
  openaiBase: () => (process.env["OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
  textModel: () => process.env["OPENAI_TEXT_MODEL"]?.trim() || "gpt-5.5",
  imageModel: () => process.env["OPENAI_IMAGE_MODEL"]?.trim() || "gpt-image-2",
  imageQuality: () => process.env["OPENAI_IMAGE_QUALITY"]?.trim() || "medium",
  treasuryWallet: () => process.env["FYPAD_TREASURY_WALLET"]?.trim() || null,
  cronSecret: () => process.env["CRON_SECRET"]?.trim() || null,
  blobToken: () => process.env["BLOB_READ_WRITE_TOKEN"]?.trim() || null,
  databaseUrl: () => process.env["DATABASE_URL"]?.trim() || null,
  siteUrl: () => process.env["NEXT_PUBLIC_SITE_URL"]?.trim() || null,
};

/** Public: the $FYPAD mint, never invented. Null until the owner sets it. */
export const FYPAD_MINT: string | null = process.env.NEXT_PUBLIC_MINT?.trim() || null;
export function serverFypadMint(): string | null {
  return process.env["NEXT_PUBLIC_MINT"]?.trim() || null;
}
