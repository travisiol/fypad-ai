/**
 * What the pages show: our tables + stored coin stats (refreshed by the tick, or inline with a short
 * timeout for the one coin of a profile). Plain serialisable objects for client components.
 */
import { CADENCE, costPerPostLamports } from "../config/fypad.ts";
import { cadence } from "./cadence.ts";
import type { Db, Q } from "./db.ts";
import { budgetOf, distributionsOf } from "./fees.ts";
import type { InfluencerRow, PostRow } from "./influencers.ts";
import { getInfluencer, getPost, liveByHandle, postsOf, toInfluencer, toPost } from "./influencers.ts";
import type { LaunchRow } from "./launch.ts";
import { activeLaunchFor, confirmedLaunches } from "./launch.ts";
import type { CoinStats } from "./market.ts";
import { STATS_TTL_MS, readStats, refreshStats, sparkline } from "./market.ts";
import { mediaUrl } from "./media.ts";
import { commentsOf, influencerStats, postStats } from "./social.ts";

export interface CoinView {
  mint: string;
  ticker: string;
  name: string;
  cluster: string;
  sharingStatus: LaunchRow["sharingStatus"];
  createSig: string | null;
  confirmedAt: number | null;
  links: LaunchRow["links"];
  stats: CoinStats | null;
  /** Market-cap snapshots of the last 24 h, oldest first (sparkline). */
  spark: number[];
}

export interface InfluencerView {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  bio: string;
  owner: string;
  niches: string[];
  publishedAt: number | null;
  coin: CoinView | null;
  followers: number;
  posts: number;
  following: boolean;
  storyAt: number | null;
}

export interface PostView {
  id: string;
  caption: string;
  hashtags: string[];
  image: string | null;
  publishedAt: number;
  kind: PostRow["kind"];
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
  influencer: InfluencerView;
}

const DAY = 86_400_000;

function coinView(l: LaunchRow | undefined, stats: Map<string, CoinStats>, sparks: Map<string, number[]>): CoinView | null {
  if (!l) return null;
  return {
    spark: sparks.get(l.mint) ?? [], mint: l.mint, ticker: l.ticker, name: l.name, cluster: l.cluster, sharingStatus: l.sharingStatus, createSig: l.createSig, confirmedAt: l.confirmedAt, links: l.links, stats: stats.get(l.mint) ?? null };
}

/** Influencer views for a set of rows (coin, stats, counts, story ring). */
export async function influencerViews(q: Q, rows: InfluencerRow[], me: string | null, now = Date.now()): Promise<InfluencerView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const launches = await confirmedLaunches(q, ids);
  const mints = [...launches.values()].map((l) => l.mint);
  const stats = await readStats(q, mints);
  const sparks = new Map<string, number[]>();
  if (mints.length)
    for (const r of await q.query("SELECT mint, mcap_usd FROM market_snapshots WHERE mint = ANY($1::text[]) AND at > $2 ORDER BY at ASC", [mints, now - DAY])) {
      const k = String(r.mint);
      if (!sparks.has(k)) sparks.set(k, []);
      sparks.get(k)!.push(Number(r.mcap_usd));
    }
  const counts = await influencerStats(q, ids, me);
  const stories = new Map<string, number>();
  for (const r of await q.query("SELECT influencer_id, MAX(published_at) AS at FROM posts WHERE status = 'live' AND published_at > $2 AND influencer_id = ANY($1::text[]) GROUP BY influencer_id", [ids, now - DAY]))
    stories.set(String(r.influencer_id), Number(r.at));
  return rows.map((i) => ({
    id: i.id,
    handle: i.handle,
    displayName: i.displayName,
    avatar: mediaUrl(i.portraitMediaId),
    bio: i.bio,
    owner: i.owner,
    niches: i.niches,
    publishedAt: i.publishedAt,
    coin: coinView(launches.get(i.id), stats, sparks),
    followers: counts.get(i.id)?.followers ?? 0,
    posts: counts.get(i.id)?.posts ?? 0,
    following: counts.get(i.id)?.following ?? false,
    storyAt: stories.get(i.id) ?? null,
  }));
}

export async function postViews(q: Q, posts: PostRow[], me: string | null, now = Date.now()): Promise<PostView[]> {
  if (!posts.length) return [];
  const ids = [...new Set(posts.map((p) => p.influencerId))];
  const rows = (await q.query("SELECT * FROM influencers WHERE id = ANY($1::text[])", [ids])).map(toInfluencer);
  const views = new Map((await influencerViews(q, rows, me, now)).map((v) => [v.id, v]));
  const stats = await postStats(q, posts.map((p) => p.id), me);
  return posts
    .filter((p) => views.has(p.influencerId))
    .map((p) => {
      const s = stats.get(p.id)!;
      return { id: p.id, caption: p.caption, hashtags: p.hashtags, image: mediaUrl(p.imageMediaId), publishedAt: p.publishedAt ?? p.createdAt, kind: p.kind, likes: s.likes, comments: s.comments, liked: s.liked, saved: s.saved, influencer: views.get(p.influencerId)! };
    });
}

/** Home feed: posts from followed influencers first, then everyone, newest first. */
export async function homeFeed(q: Q, me: string | null, limit = 30, now = Date.now()): Promise<PostView[]> {
  let followed: PostRow[] = [];
  if (me) {
    followed = (
      await q.query(
        "SELECT p.* FROM posts p JOIN influencers i ON i.id = p.influencer_id JOIN follows f ON f.influencer_id = i.id AND f.wallet = $1 WHERE p.status = 'live' AND i.status = 'live' ORDER BY p.published_at DESC LIMIT $2",
        [me, limit],
      )
    ).map(toPost);
  }
  const seen = new Set(followed.map((p) => p.id));
  const rest = (await q.query("SELECT p.* FROM posts p JOIN influencers i ON i.id = p.influencer_id WHERE p.status = 'live' AND i.status = 'live' ORDER BY p.published_at DESC LIMIT $1", [limit + followed.length])).map(toPost).filter((p) => !seen.has(p.id));
  return postViews(q, [...followed, ...rest].slice(0, limit), me, now);
}

export interface StoryView {
  influencer: InfluencerView;
  items: { id: string; image: string | null; caption: string; at: number }[];
}

export async function stories(q: Q, me: string | null, now = Date.now()): Promise<StoryView[]> {
  const posts = (await q.query("SELECT p.* FROM posts p JOIN influencers i ON i.id = p.influencer_id WHERE p.status = 'live' AND i.status = 'live' AND p.published_at > $1 ORDER BY p.published_at ASC LIMIT 200", [now - DAY])).map(toPost);
  if (!posts.length) return [];
  const ids = [...new Set(posts.map((p) => p.influencerId))];
  const rows = (await q.query("SELECT * FROM influencers WHERE id = ANY($1::text[])", [ids])).map(toInfluencer);
  const views = await influencerViews(q, rows, me, now);
  return views
    .map((v) => ({ influencer: v, items: posts.filter((p) => p.influencerId === v.id).map((p) => ({ id: p.id, image: mediaUrl(p.imageMediaId), caption: p.caption, at: p.publishedAt ?? p.createdAt })) }))
    .sort((a, b) => Number(b.influencer.following) - Number(a.influencer.following) || (b.influencer.storyAt ?? 0) - (a.influencer.storyAt ?? 0));
}

/** Rising: every influencer with a coin, by market cap (then newest). */
export async function risingRows(q: Q, me: string | null, now = Date.now()): Promise<InfluencerView[]> {
  const launches = await confirmedLaunches(q);
  if (!launches.size) return [];
  const rows = (await q.query("SELECT * FROM influencers WHERE status = 'live' AND id = ANY($1::text[])", [[...launches.keys()]])).map(toInfluencer);
  const views = await influencerViews(q, rows, me, now);
  return views.sort((a, b) => (b.coin?.stats?.mcapUsd ?? -1) - (a.coin?.stats?.mcapUsd ?? -1) || (b.coin?.confirmedAt ?? 0) - (a.coin?.confirmedAt ?? 0));
}

export async function explore(q: Q, me: string | null, query: string, now = Date.now()): Promise<{ posts: PostView[]; people: InfluencerView[] }> {
  const term = query.trim().replace(/^[@$]/, "").toLowerCase();
  let people: InfluencerView[] = [];
  if (term) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const rows = (
      await q.query(
        `SELECT DISTINCT i.* FROM influencers i LEFT JOIN launches l ON l.influencer_id = i.id AND l.status = 'confirmed'
         WHERE i.status = 'live' AND (i.handle LIKE $1 OR LOWER(i.display_name) LIKE $1 OR LOWER(l.ticker) LIKE $1 OR l.mint = $2) LIMIT 30`,
        [like, query.trim()],
      )
    ).map(toInfluencer);
    people = await influencerViews(q, rows, me, now);
  }
  const posts = (
    await q.query(
      term
        ? "SELECT p.* FROM posts p JOIN influencers i ON i.id = p.influencer_id WHERE p.status = 'live' AND i.status = 'live' AND i.id = ANY($2::text[]) ORDER BY p.published_at DESC LIMIT $1"
        : "SELECT p.* FROM posts p JOIN influencers i ON i.id = p.influencer_id WHERE p.status = 'live' AND i.status = 'live' ORDER BY p.published_at DESC LIMIT $1",
      term ? [60, people.map((p) => p.id)] : [60],
    )
  ).map(toPost);
  return { posts: await postViews(q, posts, me, now), people };
}

/** Refreshes a coin's stats inline when missing or stale, bounded by `timeoutMs`. */
export async function freshStats(db: Db, mint: string, timeoutMs = 4000): Promise<void> {
  const s = (await readStats(db, [mint])).get(mint);
  if (s && Date.now() - s.updatedAt < STATS_TTL_MS) return;
  await Promise.race([refreshStats(db, [mint], undefined, { holdersFor: 1 }).catch(() => null), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export interface ProfileData {
  influencer: InfluencerView;
  posts: PostView[];
  spark: number[];
  isOwner: boolean;
  owner: null | {
    paused: boolean;
    nextIdea: string;
    budgetLamports: string;
    cadence: { mode: string; nextAt: number | null; perDay: number };
    earnedLamports: string;
    sharingStatus: LaunchRow["sharingStatus"] | null;
  };
  launchStatus: LaunchRow["status"] | null;
}

export async function profile(db: Db, handle: string, me: string | null, now = Date.now()): Promise<ProfileData | null> {
  const row = await liveByHandle(db, handle);
  if (!row) return null;
  const l = await activeLaunchFor(db, row.id);
  if (l?.status === "confirmed") await freshStats(db, l.mint);
  const [view] = await influencerViews(db, [row], me, now);
  const posts = await postViews(db, await postsOf(db, row.id, "live", 60), me, now);
  const spark = l?.status === "confirmed" ? await sparkline(db, l.mint, now) : [];
  const isOwner = me === row.owner;
  let owner: ProfileData["owner"] = null;
  if (isOwner) {
    const b = await budgetOf(db, row.id);
    const d = cadence({ now, publishedAt: row.publishedAt ?? now, lastAutoPostAt: row.lastAutoPostAt, lastFreePostAt: row.lastFreePostAt, budgetLamports: b.balance, costLamports: costPerPostLamports(), paused: row.paused });
    const earned = (await distributionsOf(db, row.id, 500)).reduce((s, x) => s + x.creatorLamports, BigInt(0));
    owner = {
      paused: row.paused,
      nextIdea: row.nextIdea,
      budgetLamports: b.balance.toString(),
      cadence: { mode: d.mode, nextAt: d.nextAt, perDay: d.mode === "funded" ? CADENCE.fundedPerDay : d.mode === "baseline" ? 1 : d.mode === "idle" ? 1 / 3 : 0 },
      earnedLamports: earned.toString(),
      sharingStatus: l?.status === "confirmed" ? l.sharingStatus : null,
    };
  }
  return { influencer: view, posts, spark, isOwner, owner, launchStatus: l?.status ?? null };
}

export interface CommentItem {
  id: string;
  parentId: string | null;
  wallet: string | null;
  influencer: { handle: string; avatar: string | null } | null;
  body: string;
  createdAt: number;
}

export async function postPage(db: Db, id: string, me: string | null, now = Date.now()): Promise<{ post: PostView; comments: CommentItem[]; more: PostView[]; isOwner: boolean } | null> {
  const p = await getPost(db, id);
  if (!p || p.status !== "live") return null;
  const i = await getInfluencer(db, p.influencerId);
  if (!i || i.status !== "live") return null;
  const [post] = await postViews(db, [p], me, now);
  const comments = (await commentsOf(db, p.id)).map((c) => ({
    id: c.id,
    parentId: c.parentId,
    wallet: c.wallet,
    influencer: c.influencerId ? { handle: i.handle, avatar: mediaUrl(i.portraitMediaId) } : null,
    body: c.body,
    createdAt: c.createdAt,
  }));
  const more = await postViews(db, (await postsOf(db, i.id, "live", 7)).filter((x) => x.id !== p.id).slice(0, 6), me, now);
  return { post, comments, more, isOwner: me === i.owner };
}

export interface HomeData {
  counters: { influencers: number; coins: number; creatorFeesLamports: string };
  risingNow: InfluencerView[];
  movers: InfluencerView[];
}

/** Home: real counters, the "Rising now" row (coins by market cap, then the newest influencers) and top movers. */
export async function homeData(q: Q, me: string | null, now = Date.now()): Promise<HomeData> {
  const [inf, coins, fees] = await Promise.all([
    q.query("SELECT COUNT(*) AS n FROM influencers WHERE status = 'live'"),
    q.query("SELECT COUNT(*) AS n FROM launches l JOIN influencers i ON i.id = l.influencer_id WHERE l.status = 'confirmed' AND i.status = 'live'"),
    q.query("SELECT COALESCE(SUM(creator_lamports), 0) AS s FROM distributions"),
  ]);
  const rows = (await q.query("SELECT * FROM influencers WHERE status = 'live' ORDER BY published_at DESC LIMIT 60")).map(toInfluencer);
  const views = await influencerViews(q, rows, me, now);
  const risingNow = [...views].sort((a, b) => (b.coin?.stats?.mcapUsd ?? -1) - (a.coin?.stats?.mcapUsd ?? -1) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 12);
  const movers = views
    .filter((v) => v.coin)
    .sort((a, b) => (b.coin?.stats?.change24h ?? -1e9) - (a.coin?.stats?.change24h ?? -1e9) || (b.coin?.stats?.mcapUsd ?? -1) - (a.coin?.stats?.mcapUsd ?? -1))
    .slice(0, 8);
  return { counters: { influencers: Number(inf[0]?.n ?? 0), coins: Number(coins[0]?.n ?? 0), creatorFeesLamports: String(fees[0]?.s ?? "0") }, risingNow, movers };
}
