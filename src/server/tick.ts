/**
 * The tick: what makes influencers live on their own. Nothing loops — runTick() is called by the
 * cron (/api/cron/tick), and by page visits through GET /api/tick (after(), at most every 5 minutes).
 * One tick, under a lease so two callers never overlap:
 *  1. refreshes stale coin stats (market cap, 24 h, holders) and notifies owners of new milestones;
 *  2. queues the auto-posts that are due (cadence.ts) — one open post job per influencer;
 *  3. advances a few job stages (each one model call);
 *  4. answers up to 3 new top comments per influencer, in character.
 */
import { randomUUID } from "node:crypto";
import { CADENCE, TICK, costPerPostLamports } from "../config/fypad.ts";
import type { Providers } from "./ai.ts";
import { cadence } from "./cadence.ts";
import type { Db } from "./db.ts";
import { num } from "./db.ts";
import { budgetOf } from "./fees.ts";
import { compactUsd, stripInventedFigures } from "./figures.ts";
import { getInfluencer, liveInfluencers, personaOf } from "./influencers.ts";
import { openJobFor, submitJob, tickJobs } from "./jobs.ts";
import { confirmedLaunches } from "./launch.ts";
import type { MarketSource } from "./market.ts";
import { STATS_TTL_MS, liveSource, readStats, refreshStats } from "./market.ts";
import { notify } from "./notifications.ts";
import { REPLIES_SCHEMA, repliesPrompt, validateReplies } from "./personas.ts";

export interface TickDeps {
  prov: Providers;
  market?: MarketSource;
  now?: number;
  /** Skip the lease (tests). */
  force?: boolean;
}

export interface TickResult {
  skipped?: string;
  stats: number;
  milestones: number;
  scheduled: number;
  steps: number;
  replies: number;
}

async function kvGet(db: Db, key: string): Promise<string | null> {
  return ((await db.query("SELECT value FROM kv WHERE key = $1", [key]))[0]?.value as string) ?? null;
}
async function kvSet(db: Db, key: string, value: string) {
  await db.query("INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
}

/** True when the last tick started more than TICK.everyMs ago (page visits use it before kicking). */
export async function tickDue(db: Db, now = Date.now()): Promise<boolean> {
  return now - Number((await kvGet(db, "tick_last")) ?? 0) > TICK.everyMs;
}

export async function runTick(db: Db, deps: TickDeps): Promise<TickResult> {
  const now = deps.now ?? Date.now();
  const out: TickResult = { stats: 0, milestones: 0, scheduled: 0, steps: 0, replies: 0 };
  if (!deps.force) {
    // lease: an atomic compare-and-set on kv so two instances never run the same tick
    const lease = await db.query(
      `INSERT INTO kv (key, value) VALUES ('tick_lease', $1) ON CONFLICT (key) DO UPDATE SET value = $1 WHERE CAST(kv.value AS BIGINT) < $2 RETURNING key`,
      [String(now + TICK.leaseMs), now],
    );
    if (!lease.length) return { ...out, skipped: "a tick is already running" };
  }
  await kvSet(db, "tick_last", String(now));
  try {
    await refresh(db, deps, now, out);
    await schedule(db, deps, now, out);
    out.steps = await tickJobs(db, deps.prov, TICK.jobSteps, now).catch(() => 0);
    out.replies = await replyAll(db, deps, now).catch(() => 0);
  } finally {
    if (!deps.force) await kvSet(db, "tick_lease", "0");
  }
  return out;
}

async function refresh(db: Db, deps: TickDeps, now: number, out: TickResult) {
  const coins = [...(await confirmedLaunches(db)).values()];
  if (!coins.length) return;
  const stats = await readStats(db, coins.map((l) => l.mint));
  const stale = coins.filter((l) => now - (stats.get(l.mint)?.updatedAt ?? 0) > STATS_TTL_MS).slice(0, 30);
  if (!stale.length) return;
  try {
    const r = await refreshStats(db, stale.map((l) => l.mint), deps.market ?? liveSource(), { now, holdersFor: 5 });
    out.stats = r.updated;
    for (const m of r.milestones) {
      const l = coins.find((c) => c.mint === m.mint)!;
      const i = await getInfluencer(db, l.influencerId);
      if (!i) continue;
      out.milestones++;
      await notify(db, { recipient: i.owner, kind: "milestone", influencerId: i.id, text: `$${l.ticker} passed ${compactUsd(m.level)} market cap`, key: `milestone:${m.mint}:${m.level}` }, now);
    }
  } catch {
    // markets unreachable: next tick
  }
}

async function schedule(db: Db, deps: TickDeps, now: number, out: TickResult) {
  if (!deps.prov.available) return;
  const cost = costPerPostLamports();
  for (const i of await liveInfluencers(db)) {
    if (out.scheduled >= TICK.schedulePerTick) break;
    if (i.paused || i.publishedAt === null) continue;
    const budget = await budgetOf(db, i.id);
    const d = cadence({ now, publishedAt: i.publishedAt, lastAutoPostAt: i.lastAutoPostAt, lastFreePostAt: i.lastFreePostAt, budgetLamports: budget.balance, costLamports: cost, paused: i.paused });
    if (!d.due) continue;
    if (await openJobFor(db, i.id, ["post"])) continue;
    // claim the slot first (so a second tick cannot queue the same post), then queue
    const claimed = await db.query(
      "UPDATE influencers SET last_auto_post_at = $2, last_free_post_at = CASE WHEN $3 = 1 THEN last_free_post_at ELSE $2 END WHERE id = $1 AND COALESCE(last_auto_post_at, 0) = $4 RETURNING id",
      [i.id, now, d.paid ? 1 : 0, i.lastAutoPostAt ?? 0],
    );
    if (!claimed.length) continue;
    try {
      await submitJob(db, i.owner, { influencerId: i.id, kind: "post", idempotencyKey: `auto:${i.id}:${now}`, payload: { mode: "auto", paid: d.paid } }, now);
      out.scheduled++;
    } catch {
      // a post job appeared meanwhile
    }
  }
}

/** Replies in character to up to CADENCE.repliesPerTick new top comments, for a few influencers. */
export async function replyAll(db: Db, deps: TickDeps, now: number): Promise<number> {
  if (!deps.prov.available) return 0;
  const rows = await db.query(
    `SELECT c.id, c.body, c.wallet, c.post_id, p.influencer_id, p.caption FROM comments c
     JOIN posts p ON p.id = c.post_id
     JOIN influencers i ON i.id = p.influencer_id
     WHERE c.parent_id IS NULL AND c.wallet IS NOT NULL AND c.deleted = 0 AND p.status = 'live' AND i.status = 'live'
       AND c.created_at > $1 AND c.wallet <> i.owner
       AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.influencer_id IS NOT NULL)
     ORDER BY c.created_at ASC LIMIT 60`,
    [now - 7 * 86_400_000],
  );
  const byInfluencer = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = String(r.influencer_id);
    if (!byInfluencer.has(k)) byInfluencer.set(k, []);
    const list = byInfluencer.get(k)!;
    if (list.length < CADENCE.repliesPerTick) list.push(r);
  }
  let replied = 0;
  for (const [influencerId, list] of [...byInfluencer.entries()].slice(0, TICK.replyInfluencers)) {
    const i = await getInfluencer(db, influencerId);
    if (!i) continue;
    const caption = String(list[0].caption ?? "");
    const { system, user } = repliesPrompt(personaOf(i), caption, list.map((r) => String(r.body)));
    let replies: { index: number; text: string }[] = [];
    try {
      replies = validateReplies(await deps.prov.json(system, user, "replies", REPLIES_SCHEMA), list.length);
    } catch {
      continue;
    }
    for (const r of replies) {
      const c = list[r.index];
      const text = stripInventedFigures(r.text, { mcapUsd: null, milestoneUsd: null, change24h: null });
      if (!text) continue;
      const ins = await db.query("INSERT INTO comments (id, post_id, parent_id, wallet, influencer_id, body, created_at) VALUES ($1,$2,$3,NULL,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id", [
        `c_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        String(c.post_id),
        String(c.id),
        i.id,
        text,
        now,
      ]);
      if (!ins.length) continue;
      replied++;
      await notify(db, { recipient: String(c.wallet), kind: "reply", influencerId: i.id, postId: String(c.post_id), text, key: `reply:${c.id}` }, now);
    }
  }
  return replied;
}

/** How many auto-posts an influencer made in the last 24 h (for the Manage panel). */
export async function postsLastDay(db: Db, influencerId: string, now = Date.now()): Promise<number> {
  return num((await db.query("SELECT COUNT(*) AS n FROM posts WHERE influencer_id = $1 AND status = 'live' AND kind <> 'intro' AND published_at > $2", [influencerId, now - 86_400_000]))[0]?.n);
}
