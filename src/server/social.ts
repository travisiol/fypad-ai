/**
 * The social layer (signed-in wallets, off-chain): follow, like, save, comment. Every toggle is
 * idempotent (primary keys), counts are COUNT(*) of real rows, and the influencer's owner gets a
 * notification for new followers, likes and comments.
 */
import { randomUUID } from "node:crypto";
import { COMMENT_MAX } from "../config/fypad.ts";
import type { Db, Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { getInfluencer, getPost } from "./influencers.ts";
import { notify } from "./notifications.ts";

function need(me: string | null): string {
  if (!me) throw new HttpError(401, "Sign in with your wallet first.");
  return me;
}

async function livePost(q: Q, postId: string) {
  const p = await getPost(q, String(postId ?? ""));
  if (!p || p.status !== "live") throw new HttpError(404, "Post not found.");
  const i = await getInfluencer(q, p.influencerId);
  if (!i || i.status !== "live") throw new HttpError(404, "Post not found.");
  return { p, i };
}

export async function setLike(db: Db, me: string | null, postId: string, on: boolean, now = Date.now()): Promise<{ liked: boolean; likes: number }> {
  const w = need(me);
  const { p, i } = await livePost(db, postId);
  if (on) {
    const ins = await db.query("INSERT INTO likes (post_id, wallet, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING post_id", [p.id, w, now]);
    if (ins.length) await notify(db, { recipient: i.owner, kind: "like", influencerId: i.id, postId: p.id, actor: w, key: `like:${p.id}:${w}` }, now);
  } else await db.query("DELETE FROM likes WHERE post_id = $1 AND wallet = $2", [p.id, w]);
  return { liked: on, likes: await count(db, "likes", "post_id", p.id) };
}

export async function setSave(db: Db, me: string | null, postId: string, on: boolean, now = Date.now()): Promise<{ saved: boolean }> {
  const w = need(me);
  const { p } = await livePost(db, postId);
  if (on) await db.query("INSERT INTO saves (post_id, wallet, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, w, now]);
  else await db.query("DELETE FROM saves WHERE post_id = $1 AND wallet = $2", [p.id, w]);
  return { saved: on };
}

export async function setFollow(db: Db, me: string | null, influencerId: string, on: boolean, now = Date.now()): Promise<{ following: boolean; followers: number }> {
  const w = need(me);
  const i = await getInfluencer(db, String(influencerId ?? ""));
  if (!i || i.status !== "live") throw new HttpError(404, "Influencer not found.");
  if (on) {
    const ins = await db.query("INSERT INTO follows (influencer_id, wallet, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING wallet", [i.id, w, now]);
    if (ins.length) await notify(db, { recipient: i.owner, kind: "follow", influencerId: i.id, actor: w, key: `follow:${i.id}:${w}:${now}` }, now);
  } else await db.query("DELETE FROM follows WHERE influencer_id = $1 AND wallet = $2", [i.id, w]);
  return { following: on, followers: await count(db, "follows", "influencer_id", i.id) };
}

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  wallet: string | null;
  influencerId: string | null;
  body: string;
  createdAt: number;
}

const toComment = (r: Record<string, unknown>): CommentView => ({
  id: String(r.id),
  postId: String(r.post_id),
  parentId: (r.parent_id as string) ?? null,
  wallet: (r.wallet as string) ?? null,
  influencerId: (r.influencer_id as string) ?? null,
  body: String(r.body),
  createdAt: num(r.created_at),
});

export async function addComment(db: Db, me: string | null, postId: string, body: unknown, now = Date.now()): Promise<CommentView> {
  const w = need(me);
  const text = String(body ?? "").replace(/\s+/g, " ").trim().slice(0, COMMENT_MAX);
  if (!text) throw new HttpError(400, "Write a comment first.");
  const { p, i } = await livePost(db, postId);
  const recent = num((await db.query("SELECT COUNT(*) AS n FROM comments WHERE wallet = $1 AND created_at > $2", [w, now - 60_000]))[0]?.n);
  if (recent >= 10) throw new HttpError(429, "You're commenting too fast. Try again in a minute.");
  const id = `c_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.query("INSERT INTO comments (id, post_id, parent_id, wallet, influencer_id, body, created_at) VALUES ($1,$2,NULL,$3,NULL,$4,$5)", [id, p.id, w, text, now]);
  await notify(db, { recipient: i.owner, kind: "comment", influencerId: i.id, postId: p.id, actor: w, text, key: `comment:${id}` }, now);
  return toComment((await db.query("SELECT * FROM comments WHERE id = $1", [id]))[0]);
}

export async function deleteComment(db: Db, me: string | null, commentId: string): Promise<void> {
  const w = need(me);
  const r = (await db.query("SELECT * FROM comments WHERE id = $1", [String(commentId ?? "")]))[0];
  if (!r) throw new HttpError(404, "Comment not found.");
  const c = toComment(r);
  const p = await getPost(db, c.postId);
  const i = p ? await getInfluencer(db, p.influencerId) : null;
  if (c.wallet !== w && i?.owner !== w) throw new HttpError(403, "You can only delete your own comments.");
  await db.query("UPDATE comments SET deleted = 1 WHERE id = $1 OR parent_id = $1", [c.id]);
}

export async function commentsOf(q: Q, postId: string, limit = 200): Promise<CommentView[]> {
  return (await q.query("SELECT * FROM comments WHERE post_id = $1 AND deleted = 0 ORDER BY created_at ASC LIMIT $2", [postId, limit])).map(toComment);
}

async function count(q: Q, table: "likes" | "follows" | "saves", col: string, id: string): Promise<number> {
  return num((await q.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = $1`, [id]))[0]?.n);
}

export const likeCount = (q: Q, postId: string) => count(q, "likes", "post_id", postId);
export const followerCount = (q: Q, influencerId: string) => count(q, "follows", "influencer_id", influencerId);

/** Like / comment counts and the viewer's own like / save state for a set of posts. */
export async function postStats(q: Q, postIds: string[], me: string | null) {
  const out = new Map<string, { likes: number; comments: number; liked: boolean; saved: boolean }>();
  if (!postIds.length) return out;
  for (const id of postIds) out.set(id, { likes: 0, comments: 0, liked: false, saved: false });
  for (const r of await q.query("SELECT post_id, COUNT(*) AS n FROM likes WHERE post_id = ANY($1::text[]) GROUP BY post_id", [postIds])) out.get(String(r.post_id))!.likes = num(r.n);
  for (const r of await q.query("SELECT post_id, COUNT(*) AS n FROM comments WHERE deleted = 0 AND post_id = ANY($1::text[]) GROUP BY post_id", [postIds])) out.get(String(r.post_id))!.comments = num(r.n);
  if (me) {
    for (const r of await q.query("SELECT post_id FROM likes WHERE wallet = $2 AND post_id = ANY($1::text[])", [postIds, me])) out.get(String(r.post_id))!.liked = true;
    for (const r of await q.query("SELECT post_id FROM saves WHERE wallet = $2 AND post_id = ANY($1::text[])", [postIds, me])) out.get(String(r.post_id))!.saved = true;
  }
  return out;
}

/** Followers, live post count and whether the viewer follows, for a set of influencers. */
export async function influencerStats(q: Q, ids: string[], me: string | null) {
  const out = new Map<string, { followers: number; posts: number; following: boolean }>();
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { followers: 0, posts: 0, following: false });
  for (const r of await q.query("SELECT influencer_id, COUNT(*) AS n FROM follows WHERE influencer_id = ANY($1::text[]) GROUP BY influencer_id", [ids])) out.get(String(r.influencer_id))!.followers = num(r.n);
  for (const r of await q.query("SELECT influencer_id, COUNT(*) AS n FROM posts WHERE status = 'live' AND influencer_id = ANY($1::text[]) GROUP BY influencer_id", [ids])) out.get(String(r.influencer_id))!.posts = num(r.n);
  if (me) for (const r of await q.query("SELECT influencer_id FROM follows WHERE wallet = $2 AND influencer_id = ANY($1::text[])", [ids, me])) out.get(String(r.influencer_id))!.following = true;
  return out;
}
